import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './run.js';

// The Package manager (ADR-0009 decision 9). The Managed workflows install with it, and verify,
// the audit and the lockfile refresh run it, so the local gate and CI run the same tool.
// `refresh` updates only the lockfile, no scripts. Yarn 1 has no lockfile-only flag, so it also
// fills node_modules.
const PACKAGE_MANAGERS = {
  npm: {
    lockfile: 'package-lock.json',
    install: 'npm ci',
    exec: 'npx',
    refresh: ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
  },
  pnpm: {
    lockfile: 'pnpm-lock.yaml',
    install: 'pnpm install --frozen-lockfile',
    exec: 'pnpm exec',
    refresh: ['install', '--lockfile-only', '--ignore-scripts'],
  },
  yarn: {
    lockfile: 'yarn.lock',
    install: 'yarn install --frozen-lockfile',
    exec: 'yarn',
    refresh: ['install', '--ignore-scripts'],
  },
};
export const LOCKFILES = Object.values(PACKAGE_MANAGERS).map(({ lockfile }) => lockfile);
// Each lockfile and its package manager. Bun has no Managed workflow, so detection names it.
const LOCKFILE_OWNERS = {
  ...Object.fromEntries(Object.entries(PACKAGE_MANAGERS).map(([name, { lockfile }]) => [lockfile, name])),
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
};

/** The package.json of `cwd`, or undefined without one. */
export const readPackageJson = (cwd) => {
  const path = join(cwd, 'package.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
};

const findLockfile = (cwd) => Object.keys(LOCKFILE_OWNERS).find((lockfile) => existsSync(join(cwd, lockfile)));

/** True when package.json names no package manager and no lockfile names one: a new Consumer. */
export const namesNoPackageManager = (cwd, packageJson = readPackageJson(cwd) ?? {}) =>
  !packageJson.packageManager && !findLockfile(cwd);

/**
 * The package manager of `cwd`: `packageManager` in package.json names it, else the lockfile, else
 * pnpm. Throws for one with no Managed workflow. `scriptCommand(script)` is the command that runs
 * a package.json script, with no flag: pnpm hands a flag after the script name on to the script.
 */
export function detectPackageManager(cwd, packageJson = readPackageJson(cwd) ?? {}) {
  const [named, version] = packageJson.packageManager?.split('@') ?? [];
  const name = named ?? LOCKFILE_OWNERS[findLockfile(cwd)] ?? 'pnpm';
  if (!PACKAGE_MANAGERS[name]) throw new Error(`no Managed workflow for ${name}: the Engine knows npm, pnpm and yarn`);
  // Yarn 2 and higher have other install flags and no `yarn audit`, and CI runners ship yarn 1.
  if (name === 'yarn' && (parseInt(version) >= 2 || existsSync(join(cwd, '.yarnrc.yml')))) {
    throw new Error('no Managed workflow for yarn 2 or higher: the Engine knows yarn 1');
  }
  return { name, ...PACKAGE_MANAGERS[name], scriptCommand: (script) => `${name} run ${script}` };
}

/**
 * Refreshes the lockfile of the package manager in `cwd`, and creates it when it is missing. A
 * Sync that changes package.json calls it, or the frozen install fails on the Sync PR. Returns
 * the lockfile, or null without a package.json.
 */
export function refreshLock(cwd) {
  const packageJson = readPackageJson(cwd);
  if (!packageJson) return null;
  const { name, lockfile, refresh } = detectPackageManager(cwd, packageJson);
  run(name, refresh, { cwd });
  return lockfile;
}
