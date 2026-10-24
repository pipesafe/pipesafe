# Re-review after a push

The PR was reviewed at `reviewed-sha` and has new commits. The goal is to keep the existing review accurate, not to review again from scratch. A re-review that adds nothing posts nothing apart from the summary update.

## Gather

1. The push's changes: `gh api repos/<owner>/<repo>/compare/<reviewed-sha>...<headRefOid>`. Keep only changes that are also in `gh pr diff <N>`, so commits merged in from the base branch are ignored. If the compare fails or its `status` is not `ahead` (a rebase or force-push), use the full PR diff instead and apply only the "critical" bar below to new findings.
2. Every review thread on the PR, with its comments, resolution and outdated state:

```bash
gh api graphql -F owner=<owner> -F repo=<repo> -F n=<N> -f query='
query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){
  reviewThreads(first:100){nodes{id isResolved isOutdated path line
    comments(first:50){nodes{databaseId author{login} body}}}}}}}'
```

This review's threads are the ones whose first comment is by the summary comment's author. GraphQL drops the `[bot]` suffix that the REST API shows, so compare logins without it.

## Update this review's open threads

For each unresolved thread of this review, check it against the current code and pick one:

- **The push clearly fixed it** → reply `Fixed in <short sha>.` and resolve the thread.
- **The push changed that code and left a different, real problem there** (the fix is incomplete in a specific way, or it introduced a new bug) → one reply naming that problem, only if no earlier reply in the thread already says it. Leave the thread open.
- **Anything else** → do nothing. That covers code the push did not touch, and a fix still in progress. Never reply to say an issue is still present or not yet fixed: the open thread already says so.

A human replied to the thread disputing or explaining the finding → leave it to them. Resolve it only if the push fixes it; never argue or restate the finding.

Resolved threads stay resolved. Never reopen one or raise its issue again, whether it was resolved by a fix or dismissed by a person.

Commands:

```bash
gh api repos/<owner>/<repo>/pulls/<N>/comments/<first comment databaseId>/replies -f body='Fixed in abc1234.'
gh api graphql -f id=<thread id> -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}'
```

## New findings

Launch two agents in parallel on the push's changes only, with the PR title, description and CLAUDE.md paths: one opus agent for bugs and one sonnet agent for CLAUDE.md compliance, using the criteria and false-positive list from SKILL.md section 2. Validate as in SKILL.md section 3.

Keep a confirmed finding only if one of these holds:

- this push introduced it
- it is critical (it breaks the build or gives wrong results for every input), even in code the earlier review saw

Drop a finding that matches any existing thread, open or resolved, or any human comment on the PR. Post the rest as inline comments as in SKILL.md section 4.

## Update the summary

Edit the existing summary comment in place, never post a new one, so a re-review does not notify anyone:

```bash
gh api -X PATCH repos/<owner>/<repo>/issues/comments/<comment id> -F body=@- <<'BODY'
<new body>
BODY
```

The body keeps the `## Code review` heading, lists this review's threads that are still open (one line each), and ends with the marker carrying the new head SHA: `<!-- pr-review reviewed-sha=<headRefOid> -->`. Update the marker even when nothing else changed.
