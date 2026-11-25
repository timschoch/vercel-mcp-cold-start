# Done

When a user-invoked task is done, how to show it, and what to clean up.

## Who holds the work

1. Git state says who holds the work:
   - uncommitted = you are still working on it
   - committed on its branch = you consider it done
   - pushed = the user signed it off

## Finish

2. Finish in this order:
   1. Name the branch `<type>/<description>` before the first commit (`workflow-hazards.md` item 4).
   2. Commit the work.
   3. Run the `verify` push stage: `node .agents/skills/verify/scripts/verify.mjs push`. Red: fix, commit, rerun.
   4. The commits hold a code file: run [code-review](.agents/skills/code-review/SKILL.md) against the base branch, with the user's request as the spec. Docs, rules or config only: skip the review.
   5. A blocking finding: a fresh subagent fixes it and commits. You do not fix it yourself. Rerun step 3. No second review.
   6. Small findings in the diff (nits, format, typos, stale docs or tests): fix them yourself in one pass, then rerun step 3. No new review.
   7. Findings outside the diff: list them as follow-ups. Do not fix them.
   8. Clean up, then present, then stop.

3. Push, PR, and ticket resolution need the user's approval. Ask only when no in-scope work is open.
   - Bad: "Done. Two nits left. Push?"
   - Good: fix the nits, then "Done. Push?"

## Clean up

4. Close the Chrome tabs you opened during the task.

## Present

5. Show the commits, the verify result, the review findings and the follow-ups. Then stop.
