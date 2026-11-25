import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installedSnapshot, latestRelease, runSnapshotScript, withReleaseSnapshot } from './release-snapshot.js';

// `npx github:timschoch/skilly` without `#<release>` installs the Hub's main,
// which can hold changes no Release has yet. The verbs that read this package
// as a Release snapshot hand off to the newest Release instead, so the decide
// phase and Setup read the same Bundles (ADR-0008 decision 13).

// Returns the exit code of the run at the newest Release, or null to run this
// package. These cases run this package:
// - A git checkout runs its own code. The snapshot is a clone with .git, so it
//   never hands off again.
// - An installed package at another version than the newest Release was pinned
//   on purpose.
// - The newest Release is unknown or its clone fails (gh missing, logged out,
//   offline). It warns first.
// An installed package at the newest version hands off. Main and a pin at the
// newest tag both have that version: the pin costs one extra clone, same result.
export function runAtNewestRelease(
  args,
  {
    packageDir,
    latestRelease: newest = latestRelease,
    withSnapshot = withReleaseSnapshot,
    runScript = runSnapshotScript,
    warn = (message) => console.error(message),
  },
) {
  if (existsSync(join(packageDir, '.git'))) return null;
  const installed = installedSnapshot(packageDir);
  let release;
  try {
    release = newest();
  } catch (error) {
    warn(`skilly: cannot find the newest Release, so this runs the installed package ${installed.release}: ${error.message}`);
    return null;
  }
  if (release !== installed.release) return null;
  try {
    return withSnapshot(release, (snapshot) => runScript(snapshot, 'bin/skilly.js', args));
  } catch (error) {
    warn(`skilly: cannot fetch Release ${release}, so this runs the installed package: ${error.message}`);
    return null;
  }
}
