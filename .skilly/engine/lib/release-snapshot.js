import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HUB_REPO } from './constants.js';
import { run } from './run.js';
import * as skillyFile from './skilly-file.js';

// A Release snapshot (ADR-0008 decision 18): the files of one Release in a
// folder. Two kinds: a shallow clone of the tag, made here and removed after
// use, and the installed npx package, which is a Release snapshot already.

export function latestRelease() {
  return run('gh', ['release', 'view', '--repo', HUB_REPO, '--json', 'tagName', '--jq', '.tagName']);
}

function cloneRelease(release) {
  const dir = mkdtempSync(join(tmpdir(), 'skilly-release-'));
  try {
    run('gh', ['repo', 'clone', HUB_REPO, dir, '--', '--quiet', '--depth', '1', '--branch', release]);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return { dir, release, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Runs useSnapshot with a clone of `release`, or of the newest Release when
// `release` is missing, and returns what it returns. The clone is removed
// after it, also when it throws or its promise rejects. A failed gh call throws.
export function withReleaseSnapshot(
  release,
  useSnapshot,
  { latestRelease: newest = latestRelease, clone = cloneRelease } = {},
) {
  const snapshot = clone(release ?? newest());
  let result;
  try {
    result = useSnapshot(snapshot);
  } catch (error) {
    snapshot.cleanup();
    throw error;
  }
  if (result instanceof Promise) return result.finally(() => snapshot.cleanup());
  snapshot.cleanup();
  return result;
}

// The installed npx package as a Release snapshot. Its Release is the
// version in its package.json.
export function installedSnapshot(packageDir) {
  const { version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  return { dir: packageDir, release: `v${version}` };
}

// When .skilly/config.json pins an older Release than the snapshot's, the
// person runs the Sync before new Bundles reach the repo. Else null.
// Release tags are vX.Y.Z, so a numeric compare orders them.
export function findUpdateHint({ cwd, release }) {
  const hub = skillyFile.exists(cwd) ? skillyFile.read(cwd).hub : undefined;
  if (!hub || hub.localeCompare(release, 'en', { numeric: true }) >= 0) return null;
  return `this repo runs ${hub}, Release ${release} is out: run node .skilly/engine/bin/skilly.js sync`;
}

// Runs a script of the snapshot with this Node, in this terminal. Returns
// its exit code.
export const runSnapshotScript = (snapshot, path, args, { cwd, env } = {}) =>
  spawnSync(process.execPath, [join(snapshot.dir, path), ...args], { cwd, env, stdio: 'inherit' }).status ?? 1;
