# CLAUDE.md

`@timschoch/vercel-mcp-cold-start`: a Vercel Function in front of an MCP server
on a scale-to-zero container. It forwards JSON-RPC verbatim. It intercepts only
a `tools/call` that arrives cold. It imports nothing but
[hono](https://hono.dev). Scope, options and the cold-call contract live in
[README.md](README.md).

## Commands

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npx lint-staged     # what the pre-commit hook runs first
```

`.husky/pre-commit` runs all three. A commit that fails one does not land.

## Layout

| Path                                       | What it holds                                        |
| ------------------------------------------ | ---------------------------------------------------- |
| [index.ts](index.ts)                       | `createFront`: the Hono app, the probe, the routing. |
| [server.ts](server.ts)                     | The ready Function. Reads `UPSTREAM_URL`.            |
| [lib/cold-start.ts](lib/cold-start.ts)     | The one intercepted case: notices, news, the stream. |
| [lib/forward.ts](lib/forward.ts)           | One hop, nothing changed: headers in and out.        |
| [tests/front.test.ts](tests/front.test.ts) | The front over a fake upstream. No socket opens.     |

## Rules

- The package knows no tool. A change that names one tool is wrong here.
- `hono` stays the only runtime dependency. A second one needs a reason in the
  PR body.
- No name of a consuming product in this repo. The notices take
  `coldStart.name`.
- Conventional commits, enforced by `.husky/commit-msg`.
- No direct push to `main`. `.husky/pre-push` refuses it. Work on a branch and
  open a PR.
- Skilly owns `.skilly.json`, `skills-lock.json`, `.claude/rules/`,
  `.claude/skills/` and `.agents/`. Never edit them by hand. Use
  `npx github:timschoch/skilly add|remove|update`.

## Open

npm publishing is not wired yet. The `publish-npm-package` skill has the flow.
The first publish needs a token bootstrap on npmjs.com before OIDC works.

## Which skill, in which order

Rules and skills sync from [skilly](https://github.com/timschoch/skilly). The
bundles in [.skilly.json](.skilly.json) decide what lands here. Read a skill's
own `SKILL.md` before you follow it.
