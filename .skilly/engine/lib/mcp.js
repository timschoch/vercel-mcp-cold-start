import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, toJson, writeChanged } from './json-file.js';

// The MCP merger. A Bundle declares its MCP servers in config.json under `mcp`,
// in the shape of `mcpServers` in .mcp.json. The Sync writes them into .mcp.json
// and records them in .skilly/mcp.json, so the next Sync removes a server no
// Bundle declares any more. Every server the Consumer added itself stays. On a
// name clash the Consumer's server wins, and the record leaves it out.
const MCP_FILE = '.mcp.json';
const SKILLY_MCP_FILE = join('.skilly', 'mcp.json');
// Every path writeMcpServers may change, for the Sync report.
export const MCP_PATHS = [MCP_FILE];

/** The MCP servers of `bundles`, already resolved with their includes: name -> server. */
export function listMcpServers(bundles, bundlesDir) {
  const servers = {};
  for (const bundle of bundles) Object.assign(servers, readJson(join(bundlesDir, bundle, 'config.json'), {}).mcp);
  return servers;
}

/**
 * `config`, a parsed .mcp.json, with the servers of `previous` replaced by `servers`. Every other key stays.
 * Returns the new config and the record: the servers skilly wrote, so without the own ones a clash skipped.
 */
export function mergeMcpConfig(config, previous, servers) {
  const own = Object.fromEntries(
    Object.entries(config.mcpServers ?? {}).filter(([name]) => !Object.hasOwn(previous, name)),
  );
  const record = Object.fromEntries(Object.entries(servers).filter(([name]) => !Object.hasOwn(own, name)));
  const mcpServers = { ...own, ...record };
  if (Object.keys(mcpServers).length) return { config: { ...config, mcpServers }, record };
  const withoutServers = { ...config };
  delete withoutServers.mcpServers;
  return { config: withoutServers, record };
}

/** Writes the MCP servers of `bundles` into .mcp.json. A file left empty goes. */
export function writeMcpServers(cwd, { bundles, bundlesDir }) {
  const servers = listMcpServers(bundles, bundlesDir);
  const recordPath = join(cwd, SKILLY_MCP_FILE);
  const hasServers = Object.keys(servers).length > 0;
  if (!hasServers && !existsSync(recordPath)) return;

  const configPath = join(cwd, MCP_FILE);
  const { config, record } = mergeMcpConfig(readJson(configPath, {}), readJson(recordPath, {}), servers);
  if (Object.keys(config).length) writeChanged(configPath, toJson(config));
  else rmSync(configPath, { force: true });
  if (Object.keys(record).length) writeChanged(recordPath, toJson(record));
  else rmSync(recordPath, { force: true });
}
