// The naming config: every word list the naming check reads, from `naming.json` next to this file.
// A rule changes in that one file.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "naming.json"
);

// Every finding rule the check reports. An `allow` entry names some of them, or "*".
export const RULE_IDS = [
  "file-case",
  "short-word",
  "noise-word",
  "enum",
  "type-prefix",
  "verb-synonym",
  "discriminant",
  "env-shape",
];

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Drops every `$comment` key, at any depth, so a comment never reads as a word-list entry.
function removeComments(value) {
  if (Array.isArray(value)) return value.map(removeComments);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$comment")
      .map(([key, entry]) => [key, removeComments(entry)])
  );
}

export function loadNamingConfig() {
  return removeComments(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
}

// `allow` entries turned into one test per finding. Throws on a malformed
// entry and names its key, so a typo fails the check instead of silencing it.
export function compileAllow(allow = {}) {
  if (!isPlainObject(allow))
    throw new Error('"allow" must be an object of named entries');
  return Object.entries(allow).map(([key, entry]) => {
    const fail = (problem) => new Error(`allow "${key}": ${problem}`);
    if (!isPlainObject(entry)) throw fail("must be an object");
    const toPatterns = (field) => {
      if (entry[field] === undefined) return null;
      if (!Array.isArray(entry[field]) || !entry[field].length)
        throw fail(`"${field}" must be a non-empty list`);
      return entry[field].map((source) => {
        try {
          // The patterns come from scripts/naming/naming.json in this repo, never from user input.
          // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
          return new RegExp(source);
        } catch (failure) {
          throw fail(`"${field}" has a bad regex: ${failure.message}`);
        }
      });
    };
    const paths = toPatterns("paths");
    const names = toPatterns("names");
    if (!paths && !names) throw fail('needs "paths", "names" or both');
    const { rules } = entry;
    if (rules !== "*" && (!Array.isArray(rules) || !rules.length))
      throw fail('"rules" must be "*" or a non-empty list');
    for (const rule of rules === "*" ? [] : rules) {
      if (!RULE_IDS.includes(rule))
        throw fail(`unknown rule "${rule}", one of ${RULE_IDS.join(", ")}`);
    }
    if (typeof entry.why !== "string" || !entry.why.trim())
      throw fail('"why" must say why the entry exists');
    return { paths, names, rules };
  });
}
