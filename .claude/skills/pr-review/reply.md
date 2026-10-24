# Reply on a review thread

A person replied, without mentioning `@claude`, on a thread this review opened. `--reply` gives the id of their comment. Answer only when the reply needs one, in a few sentences at most. This mode never changes code: fixes are what an `@claude` mention is for.

Without `--comment`, print what you would post and stop.

## Gather

1. `gh pr view --json title,body,headRefOid`.
2. The thread holding the comment: run the review-thread query from [re-review.md](re-review.md) and pick the thread with a comment whose `databaseId` is the `--reply` id.
3. The code the thread is about, as it stands in the working tree.

## Respond

Pick by what the reply says:

- **It says the issue is fixed** → check the current code. Fixed → reply `Confirmed, resolving.` and resolve. Not fixed → one reply naming exactly what is still wrong.
- **It disputes the finding or says the code is intentional** → re-check the finding with their explanation. They are right → a one-line acknowledgement, then resolve. You still hold it is a real bug → one reply with the concrete input or code path that fails, and leave the thread open. If the thread already has such a reply from you, post nothing: the people on the PR decide from there.
- **It asks a question** → answer it from the code.
- **Anything else** (thanks, a note to the author, people discussing among themselves) → post nothing.

Reply and resolve with the commands in [re-review.md](re-review.md). When you resolve a thread, also drop it from the open-issue list in the summary comment (edit in place, as in re-review.md) and leave its `reviewed-sha` marker unchanged.
