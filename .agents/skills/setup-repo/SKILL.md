---
name: setup-repo
description: >
  Harden a repo: GitHub settings (protected trunk), conventional-commit and
  protected-branch git hooks, a Claude Code guard against work-destroying git
  commands, CLAUDE.md scaffold. Use when the user wants repo hardening, branch
  protection, or commit-message enforcement set up.
---

# Setup repo

Four parts, each idempotent — skip what already holds. Pattern source: Habits-Family/habits (v2-rebuild). Run after the pre-commit stack is chosen (`/setup-pre-commit` or the repo's own) — part 2 wires into it.

## 1. GitHub settings

Give the default branch (`git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|^origin/||'`, fallback `main`) a ruleset refusing force pushes and deletions. Skip when `gh api repos/{owner}/{repo}/rulesets --jq '.[].name'` already lists `protect-trunk`:

```sh
gh api repos/{owner}/{repo}/rulesets --input - <<'JSON'
{
  "name": "protect-trunk",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [{ "type": "deletion" }, { "type": "non_fast_forward" }]
}
JSON
```

Merge-method settings (squash, delete-branch-on-merge) live in `/setup-release-please`, not here. Free private repos cannot *require* checks — the gate stays a red check, not a hard block.

A **403** on the rulesets call means rulesets are unavailable for this repo. Fall back without fuss: tell the user trunk protection stays local — the `pre-push` hook from part 2 — and continue with the next part. Never suggest a paid plan or making the repo public.

## 2. Commit and branch rules

This skill is disposable — it gets removed after use, and `.claude/skills/` is wiped on every sync. **Copy** the rule scripts into the repo; never reference them inside the skill folder:

- `scripts/check-commit-msg.mjs` → `.claude/hooks/check-commit-msg.mjs` — conventional-commit gate (the why: the `writing-rules` skill, group 7)
- `scripts/check-push-branch.mjs` → `.claude/hooks/check-push-branch.mjs` — refuses a direct push to `main` or the detected trunk
- `scripts/block-destructive-git.sh` → `.claude/hooks/block-destructive-git.sh` (`chmod +x`) — Claude Code guard, wired in part 3

The copies are repo-owned; re-run this skill to refresh them. Wire the first two into the hook manager the repo chose:

- **Husky** (`.husky/` exists): write `.husky/commit-msg` with `node .claude/hooks/check-commit-msg.mjs "$1"` and `.husky/pre-push` with `node .claude/hooks/check-push-branch.mjs`.
- **Own stack / none**: hand the two `node` invocations above to the user for their manager's `commit-msg` and `pre-push` hooks; do not install a manager for them.

## 3. Claude Code hooks

Merge each entry into `.claude/settings.json` `hooks.PreToolUse`; skip an entry whose command is already there. Never overwrite other settings.

**Destructive-git guard** — blocks `reset --hard`, `clean -f`, `checkout .` / `restore .`, `branch -D`, bare `push --force`. Plain pushes and `--force-with-lease` pass; trunk safety is part 1 and the `pre-push` hook. Needs `jq`.

```json
{
  "matcher": "Bash|mcp__lean-ctx__ctx_shell",
  "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block-destructive-git.sh" }]
}
```

Verify: `echo '{"tool_input":{"command":"git reset --hard"}}' | .claude/hooks/block-destructive-git.sh` exits 2.

**Writing-rules injection** — the `writing-rules` skill (workflow bundle) injects its rule sidecars on every file-writing tool call. The workflow bundle must be added first — the script lives in the installed skill. Not installed? Skip this entry and say so.

```json
{
  "matcher": "Write|Edit|NotebookEdit|mcp__lean-ctx__ctx_patch|mcp__lean-ctx__ctx_call",
  "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/writing-rules/scripts/inject-writing-rules.mjs\"" }]
}
```

## 4. CLAUDE.md

Missing → scaffold the constitution pattern: the file is an index plus the few rules that stop real damage, no rule that has a home elsewhere. Sections: **Commands** (what to run), **Which skill, in which order**, pointers to `CONTEXT.md` / docs. Present → leave it; suggest gaps at most.
