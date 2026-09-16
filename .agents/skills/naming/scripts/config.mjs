#!/usr/bin/env node
// The naming config: defaults from `../references/naming.json`, overridden by
// `.skilly/naming.json` in the consumer repo. The naming skill and the
// naming gate both read every word list from here, so a consumer changes a
// rule once, in one file.
//
// Merge rules: objects merge by key, `null` drops a key, arrays append and
// dedupe, a leading `-` on an override string drops that entry, arrays of
// objects append unchanged, scalars are replaced, `$comment` keys disappear.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULTS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'references', 'naming.json');
const DEFAULT_OVERRIDE_PATH = join('.skilly', 'naming.json');
// Consumers set up before the .skilly/ move still keep their overrides here.
const LEGACY_OVERRIDE_PATH = join('docs', 'agents', 'naming.json');
const COMMENT_KEY = '$comment';

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// Drops every `$comment` key, at any depth, from a value taken as-is.
function removeComments(value) {
  if (Array.isArray(value)) return value.map(removeComments);
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== COMMENT_KEY) result[key] = removeComments(entry);
  }
  return result;
}

// Base entries then override entries, deduped by value. A string starting with
// `-` removes the entry it names and is itself dropped. Objects (examples)
// append unchanged — two examples are never "the same entry".
function mergeArrays(baseEntries, overrideEntries) {
  const removals = new Set();
  const additions = [];
  for (const entry of overrideEntries) {
    if (typeof entry === 'string' && entry.startsWith('-')) removals.add(entry.slice(1));
    else additions.push(entry);
  }
  const result = [];
  for (const entry of [...baseEntries, ...additions]) {
    if (typeof entry !== 'string') {
      result.push(removeComments(entry));
      continue;
    }
    if (removals.has(entry) || result.includes(entry)) continue;
    result.push(entry);
  }
  return result;
}

function mergeValues(baseValue, overrideValue) {
  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) return mergeNamingConfig(baseValue, overrideValue);
  if (Array.isArray(baseValue) && Array.isArray(overrideValue)) return mergeArrays(baseValue, overrideValue);
  return removeComments(overrideValue);
}

// Deep merge of one override object onto one base object.
export function mergeNamingConfig(base, override) {
  const result = removeComments(base ?? {});
  for (const [key, value] of Object.entries(override ?? {})) {
    if (key === COMMENT_KEY) continue;
    if (value === null) {
      delete result[key];
      continue;
    }
    result[key] = mergeValues(result[key], value);
  }
  return result;
}

function parseJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (failure) {
    throw new Error(`${path} is not valid JSON: ${failure.message}`);
  }
}

// The merged config for one repo root. A missing override is the normal case.
export function loadNamingConfig(root = process.cwd(), { overridePath = DEFAULT_OVERRIDE_PATH } = {}) {
  const defaults = parseJsonFile(DEFAULTS_PATH);
  const candidates = overridePath === DEFAULT_OVERRIDE_PATH ? [overridePath, LEGACY_OVERRIDE_PATH] : [overridePath];
  const overrideFile = candidates.map((path) => join(root, path)).find(existsSync);
  if (!overrideFile) return mergeNamingConfig(defaults, {});
  const override = parseJsonFile(overrideFile);
  if (!isPlainObject(override)) throw new Error(`${overrideFile} is not valid JSON: expected an object`);
  return mergeNamingConfig(defaults, override);
}

function main(argv) {
  const config = argv.includes('--defaults')
    ? mergeNamingConfig(parseJsonFile(DEFAULTS_PATH), {})
    : loadNamingConfig(process.cwd());
  console.log(JSON.stringify(config, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (failure) {
    console.error(failure.message);
    process.exit(1);
  }
}
