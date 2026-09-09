# Model selection

Good defaults, not law — the developer's word overrides anything here.

Applies every time an agent spawns a subagent or teammate. Set `model` and
`effort` explicitly in the agent definition. Never inherit by accident.

## Task -> model + effort

| Task | `model` | `effort` |
|---|---|---|
| Default model | `opus` | `high` |
| Orchestrating work larger than one context window | `fable` | `low` — confirm with user first |
| Visual work — UI, design systems components, frontend polish, visual prototypes | `fable` | `high` |
| Hard coding, architecture, deep reasoning, writing | `fable` | `high` |
| Normal coding, refactor, multi-file edit, review | `opus` | `high` |
| Scoped coding, research, test writing | `sonnet` | `medium` |
| Bulk workers under an orchestrator | `sonnet` | `low` |
| Single-fact code or web lookup, classification | `haiku` | omit — no effort support |

Relative token cost: Haiku 1x · Sonnet 2x · Opus 5x · Fable 10x.
Same multiplier for input, output and cache. Add ~30% token inflation for
Sonnet 5 / Opus 5 / Fable 5 vs Haiku 4.5 (newer tokenizer).

## Hard rules

1. **Effort before model.** Move effort up or down on the current model before
   paying for a larger one. Fable at `low` still beats older models at `xhigh`.
2. **Fable for the hard and the visual, Opus for the routine.** Fable's output
   quality on visual work and hard problems beats its benchmark numbers — use it
   there despite the 2x cost over Opus. Routine coding stays on Opus: within
   0.5% of Fable's peak on CursorBench 3.2 at half the cost per task. Confirm
   with the user before a Fable *orchestration* spawn.
3. **One dependent chain -> no orchestrator.** An orchestrator pays for a plan, a
   handoff and a merge. On serial work a single model at lower effort wins.
   Orchestrate only to fan out independent pieces or to cap a cost tail.
4. **Hold effort constant inside one agent's run.** Changing effort mid-session
   invalidates the prompt cache. Vary effort across agents, never within one.
5. **Fable can refuse.** Its safety classifiers return `stop_reason: "refusal"`
   as HTTP 200. Name a fallback model for any unattended Fable job.

## Frontmatter

```yaml
---
name: bulk-worker
description: Executes one scoped subtask handed down by an orchestrator.
model: sonnet     # sonnet | opus | haiku | fable | full ID | inherit
effort: low       # low | medium | high | xhigh | max — omit for haiku
---
```
