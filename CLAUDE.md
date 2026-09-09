# CLAUDE.md

`@timschoch/vercel-mcp-cold-start`: a Vercel Function in front of an MCP server
on a scale-to-zero container. It forwards JSON-RPC verbatim. It intercepts only
a `tools/call` that arrives cold. It has no runtime dependency. Scope, options
and the cold-call contract live in [README.md](README.md).

## Commands

```sh
npm install
npm run build       # tsup, entries index.ts and server.ts, to dist/
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npx lint-staged     # what the pre-commit hook runs first
```

`.husky/pre-commit` runs lint-staged, typecheck and test. A commit that fails
one does not land. `dist/` is built, never committed.
[.github/workflows/ci.yml](.github/workflows/ci.yml) runs build, typecheck and
test on every pull request and on `main`.

## Layout

| Path                                       | What it holds                                                  |
| ------------------------------------------ | -------------------------------------------------------------- |
| [index.ts](index.ts)                       | `createFront`: the probe, the hop, the cold case.              |
| [server.ts](server.ts)                     | The ready Function. Joins `UPSTREAM_URL`, `UPSTREAM_MCP_PATH`. |
| [lib/cold-start.ts](lib/cold-start.ts)     | The one intercepted case: notices, news, the stream.           |
| [lib/forward.ts](lib/forward.ts)           | One hop, nothing changed: headers in and out.                  |
| [tests/front.test.ts](tests/front.test.ts) | The front over a fake upstream. No socket opens.               |

## Rules

- The package knows no tool. A change that names one tool is wrong here.
- No runtime dependency. `hono` is a devDependency for the test fake only. A
  first runtime one needs a reason in the PR body.
- No name of a consuming product in this repo. The notices take
  `coldStart.name`.
- Conventional commits, enforced by `.husky/commit-msg`.
- No direct push to `main`. `.husky/pre-push` refuses it. Work on a branch and
  open a PR.
- Skilly owns `.skilly.json`, `skills-lock.json`, `.claude/rules/`,
  `.claude/skills/` and `.agents/`. Never edit them by hand. Use
  `npx github:timschoch/skilly add|remove|update`.

## Release

Conventional commits on `main` drive
[release-please](https://github.com/googleapis/release-please). Merging its
Release PR tags the version and
[.github/workflows/release.yml](.github/workflows/release.yml) publishes to npm.
Version lives in three files that must agree: [package.json](package.json),
[.release-please-manifest.json](.release-please-manifest.json) and the git tag.

## Open

The package is not on npm yet. Trusted publishing needs the package to exist
there first, so a human publishes version 0.1.0 once with a granular token. The
`publish-npm-package` skill holds that flow.

## Which skill, in which order

Rules and skills sync from [skilly](https://github.com/timschoch/skilly). The
bundles in [.skilly.json](.skilly.json) decide what lands here. Read a skill's
own `SKILL.md` before you follow it.
