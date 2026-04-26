# Contributing

Short guide for the Sendero monorepo. Most repo conventions live in `CLAUDE.md`
(durable, terse) and the per-package READMEs. This file collects the bits that
need a paper trail external contributors can read.

## Filing regressions

Every production issue that is traceable to a specific commit should be filed
as a GitHub issue with the `regression` label. The weekly **defect-escape
report** (`scripts/defect-escape-report.ts`) joins these issues against
`git log` to surface what fraction of our commits cause production incidents —
inspired by Vercel's note on tracking _defect-commit vs. defect-escape ratios
to surface when risk is increasing across the platform_.

### When to file

- Anything users feel that bisects to a specific commit. Crashes, broken UI,
  wrong data, charge mismatches, broken webhooks — file it.
- If the bug exists from day one (was never working), it is **not** a
  regression. File a normal issue.
- Hot-fix and file the regression issue in the same hour. Small team; we
  forget by tomorrow.

### How to file

The fastest path:

```sh
gh issue create --template regression.yml
```

The form (`.github/ISSUE_TEMPLATE/regression.yml`) auto-applies the
`regression` label, prefixes the title with `[regression]`, and stamps the
`Caused-By: <sha>` trailer into the body. Replace `<REPLACE_WITH_SHA>` with
the offending commit SHA (7+ hex chars, prefix is fine — get it from
`git log --oneline` or the commit URL on GitHub).

Required fields: what broke, the SHA, severity (critical / major / minor),
steps to reproduce.

### Why bother

The trailer is the single load-bearing convention. The report parses
`Caused-By:\s*([0-9a-f]{7,40})` (case-insensitive) from each issue body and
joins on `git log`. A commit shows up as a "defect-escape" if any regression
issue's `Caused-By` SHA matches it (full or 7+ char prefix).

The report runs:

- Locally: `bun run scripts/defect-escape-report.ts` (default 30-day window).
  Writes to `~/.gstack/projects/<slug>/defect-escape-<YYYY-MM-DD>.md` and
  prints to stdout.
- Weekly in CI: `.github/workflows/defect-escape.yml` runs Mondays 09:00 UTC
  (and on manual dispatch) and comments on the sticky issue
  `📊 Defect-escape weekly report`.

If the ratio creeps up, that is the signal to slow down — add tests, raise
the review bar, or split the offending area into smaller commits.

### Conventions in one screen

- Title: `[regression] <symptom>` (the template prefixes this for you)
- Label: `regression` (auto-applied by the template)
- Body must contain: `Caused-By: <sha>` somewhere (the template inserts it)
- Severity dropdown: `critical` / `major` / `minor`

That is the entire convention. If you do not use the template, just include
the trailer somewhere in the body and apply the `regression` label — the
report does not care about the rest.
