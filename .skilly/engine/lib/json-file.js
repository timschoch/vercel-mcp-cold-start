import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// The JSON file helpers of the Sync's mergers: hooks.js and mcp.js.
export const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
export const toJson = (value) => JSON.stringify(value, null, 2) + '\n';

// Writes `content` when it differs. Returns true when it wrote.
export function writeChanged(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}
