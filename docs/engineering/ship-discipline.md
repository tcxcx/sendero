# Ship Discipline

These rules convert the retro notes into a repeatable platform-week habit.

## Test LOC Ratio

Target platform weeks at 10-15% test LOC against product source LOC.

Run the advisory report:

```bash
bun run scripts/report-test-loc-ratio.ts --target=0.10
```

For every XL commit, add or update at least one smoke/e2e test. If the change is not browser-facing, add the closest smoke script or route-level test that proves the critical path still works.

Current lightweight e2e entrypoint:

```bash
bun run --cwd apps/app test:e2e:smoke
```

## Config And Dependency Churn

Keep dependency, lockfile, toolchain, and config edits in dedicated commits unless the source change cannot work without them.

Examples of dedicated commit subjects:

- `build(deps): add resend mcp dependency`
- `chore(config): isolate sendero dev ports`
- `ci: add public smoke route`

If a mixed commit is unavoidable, explain it with:

```text
Config-Churn: mixed because <reason>
```

## Structured Metadata

Add these trailers to deep-session commits and PR bodies:

```text
PR-ID: pending
Change-Size: S|M|L|XL
Test: bun run --cwd apps/app test:e2e:smoke
QA-Route: /sign-up -> pass, Clerk waitlist visible
Config-Churn: isolated|mixed because <reason>
```

Use `PR-ID: pending` before the PR exists, then update the PR body or merge commit with the final `#123`. This gives retros enough metadata to track ship size, QA route, and test coverage without reverse-engineering the diff.
