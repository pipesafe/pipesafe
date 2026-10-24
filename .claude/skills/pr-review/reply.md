# Reply on a review thread

A person replied, without mentioning `@claude`, on a thread this review opened. `--reply` gives the id of their comment. Answer only when the reply needs one, in a few sentences at most.

## Gather

1. `gh pr view --json title,body,headRefOid`.
2. The thread holding the comment: run the review-thread query from [re-review.md](re-review.md) and pick the thread with a comment whose `databaseId` is the `--reply` id.
3. The code the thread is about, as it stands in the working tree.

## Respond

Pick by what the reply says:

- **It says the issue is fixed** → check the current code. Fixed → reply `Confirmed, resolving.` and resolve. Not fixed → one reply naming exactly what is still wrong.
- **It disputes the finding or says the code is intentional** → re-check the finding with their explanation, proving type or runtime claims as in SKILL.md section 3. They are right → a one-line acknowledgement, then resolve. You still hold it is a real bug → one reply with the concrete input or code path that fails, and leave the thread open. If the thread already has such a reply from you, post nothing: the people on the PR decide from there.
- **It asks for a change** → make exactly that change and nothing else. Check only the files you touched: `bunx oxlint <files>`, `bunx oxfmt --check <files>`, `bunx vitest run <test files>` for affected tests, and for type changes `bun run build` then `bun run typecheck:packages`. Fix what they report, then `git add` those files, `git commit`, and `git push`. Reply `Done in <short sha>.` with one line on what changed, and resolve the thread if the change fixes its finding. If a check still fails, or the request is too unclear to act on, push nothing and say so in one reply.
- **It asks a question** → answer it from the code.
- **Anything else** (thanks, a note to the author, people discussing among themselves) → post nothing.

Reply and resolve with the commands in [re-review.md](re-review.md). Leave the summary comment alone; the next re-review refreshes it.
