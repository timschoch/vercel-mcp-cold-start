# CLAUDE.md

`@timschoch/vercel-mcp-cold-start` — a Vercel Function in front of an MCP server
on a scale-to-zero container. Forwards JSON-RPC verbatim; intercepts only a
`tools/call` that arrives cold. Imports nothing but [hono](https://hono.dev).
Scope and the cold-call contract live in [README.md](README.md).

Extraction in progress: the code moves here from `timschoch/meco`
(`packages/front`).

## Commands

```sh
npm install
npx lint-staged   # what the pre-commit hook runs
```

No `typecheck` or `test` script yet — add both to `package.json` with the source,
then add them to `.husky/pre-commit`.

## Rules

- Conventional commits, enforced by `.husky/commit-msg`.
- No direct push to `main`; `.husky/pre-push` refuses it. Work on a branch, open
  a PR.
- Keep the runtime dependency-free apart from hono. A new dependency needs a
  reason in the PR body.
- Skilly owns `.skilly.json`, `skills-lock.json`, `.claude/rules/`,
  `.claude/skills/` and `.agents/`. Never edit them by hand — use
  `npx github:timschoch/skilly add|remove|update`.

## Which skill, in which order

Rules and skills sync from [skilly](https://github.com/timschoch/skilly); the
bundles in `.skilly.json` decide what lands here. Read a skill's own `SKILL.md`
before you follow it.
