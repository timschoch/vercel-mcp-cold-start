#!/usr/bin/env node
// What a Managed workflow runs: the stage, and the toolchains its steps need. The Engine picks
// both, so ci.yml and nightly.yml hold no stage logic (ADR-0009 decision 7, ADR-0004 decision 6).
//
// Usage, each prints `stage=` and `toolchains=` lines for $GITHUB_OUTPUT:
//   node .skilly/engine/verify/plan.mjs ci        stage ci or pr
//   node .skilly/engine/verify/plan.mjs nightly   stage nightly, nightly-scan or stop. On stop it
//                                                 opens one nightly-stuck issue, unless one is open.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The toolchains the Managed workflows know how to install and cache.
export const TOOLCHAINS = ['playwright'];
const DAY_MS = 86_400_000;
// A change on main older than this, with no finished night since, means the nightly is stuck.
const STUCK_AFTER_DAYS = 2;
const RELEASE_BRANCH_PREFIX = 'release-please--';

/**
 * `pr` leaves the full suites to the release PR and the nightly, so it needs both, and the
 * nightly runs on the product tier only. Without that net, on the release PR itself, and on a
 * manual run, `ci`: a manual run is the full check of one commit.
 */
export function pickCiStage({ tier, branch, hasNightly, hasReleasePlease, event }) {
  const isNetThere = tier === 'product' && hasNightly && hasReleasePlease;
  const isFullRun = event === 'workflow_dispatch' || branch.startsWith(RELEASE_BRANCH_PREFIX);
  return isNetThere && !isFullRun ? 'pr' : 'ci';
}

/**
 * ADR-0004 decision 1. `lastCommitAt` is the last commit on the default branch, `lastFinishedAt`
 * the start of the last night that finished, green or red, or null before the first one.
 */
export function pickNightlyStage({ event, lastCommitAt, lastFinishedAt, now }) {
  if (event === 'workflow_dispatch' || lastFinishedAt === null) return 'nightly';
  if (lastFinishedAt > lastCommitAt) return 'nightly-scan';
  return now - lastCommitAt <= STUCK_AFTER_DAYS * DAY_MS ? 'nightly' : 'stop';
}

/** The toolchains of `steps`, each once, sorted. Throws on one the Managed workflows lack. */
export function listToolchains(steps) {
  const toolchains = new Set();
  for (const { name, toolchain = [] } of steps) {
    for (const needed of toolchain) {
      if (!TOOLCHAINS.includes(needed)) {
        throw new Error(`step ${name} needs toolchain ${needed}, the Engine installs ${TOOLCHAINS.join(', ')}`);
      }
      toolchains.add(needed);
    }
  }
  return [...toolchains].sort();
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });

const resolvedSteps = (stage) => {
  const verify = join(dirname(fileURLToPath(import.meta.url)), 'verify.mjs');
  return JSON.parse(execFileSync(process.execPath, [verify, stage, '--steps'], { encoding: 'utf8' })).steps;
};

const readTier = () => {
  const path = join('.skilly', 'config.json');
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')).tier ?? 'sandbox') : 'sandbox';
};

const hasReleasePlease = () => {
  const workflows = join('.github', 'workflows');
  if (!existsSync(workflows)) return false;
  return readdirSync(workflows)
    .filter((name) => /\.ya?ml$/.test(name))
    .some((name) => readFileSync(join(workflows, name), 'utf8').includes('release-please-action'));
};

// A cancelled or timed-out night did not finish (ADR-0004 decision 2), and neither did this run.
const findLastFinishedAt = () => {
  const { workflow_runs: runs } = JSON.parse(
    gh('api', `repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/nightly.yml/runs?status=completed&per_page=50`),
  );
  const finished = runs.find(
    ({ id, conclusion }) => String(id) !== process.env.GITHUB_RUN_ID && ['success', 'failure'].includes(conclusion),
  );
  return finished ? Date.parse(finished.run_started_at) : null;
};

const openStuckIssue = () => {
  gh('label', 'create', 'nightly-stuck', '--color', 'B60205', '--force');
  if (JSON.parse(gh('issue', 'list', '--label', 'nightly-stuck', '--state', 'open', '--json', 'number')).length) return;
  gh(
    'issue',
    'create',
    '--title',
    'Nightly stuck: no night finished since the last change on the default branch',
    '--body',
    `The nightly skips its tests until one finishes. Start one by hand: gh workflow run nightly.yml. Stopped run: ${process.env.RUN_URL ?? 'unknown'}`,
    '--label',
    'nightly-stuck',
  );
};

const plan = (kind) => {
  if (kind === 'ci') {
    const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || '';
    const hasNightly = existsSync(join('.github', 'workflows', 'nightly.yml'));
    return pickCiStage({
      tier: readTier(),
      branch,
      hasNightly,
      hasReleasePlease: hasReleasePlease(),
      event: process.env.GITHUB_EVENT_NAME,
    });
  }
  if (kind === 'nightly') {
    const lastCommitAt = Date.parse(execFileSync('git', ['log', '-1', '--format=%cI'], { encoding: 'utf8' }).trim());
    const event = process.env.GITHUB_EVENT_NAME;
    const lastFinishedAt = event === 'workflow_dispatch' ? null : findLastFinishedAt();
    const stage = pickNightlyStage({ event, lastCommitAt, lastFinishedAt, now: Date.now() });
    if (stage === 'stop') openStuckIssue();
    return stage;
  }
  throw new Error(`usage: plan.mjs ci|nightly, got ${JSON.stringify(kind ?? null)}`);
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const stage = plan(process.argv[2]);
    const toolchains = stage === 'stop' ? [] : listToolchains(resolvedSteps(stage));
    process.stdout.write(`stage=${stage}\ntoolchains=${JSON.stringify(toolchains)}\n`);
  } catch (error) {
    console.error(`plan: ${error.message}`);
    process.exit(1);
  }
}
