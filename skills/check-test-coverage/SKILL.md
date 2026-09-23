---
name: check-test-coverage
description: "Use when checking whether new or changed code has meaningful tests: tests exist, were updated with the change, and exercise the new behavior. Advisory; reports gaps, edits nothing."
version: 0.2.0
argument-hint: "[--base=BRANCH]"
---

# check-test-coverage

Say whether the code changed on this branch is tested, and tested well. A test file with a matching name that never calls the new function is a gap, not coverage. The result is advisory: it feeds the review loop and the user, it does not block delivery.

`<plugin>` is this plugin's root, two directories up from this skill.

## Scope

Arguments: `$ARGUMENTS` (`--base=BRANCH`).

Run `node <plugin>/scripts/delivery.js context [--base=BRANCH]` for the changed files (`base...HEAD` against the remote base) and, when repo-intel is installed, `testGaps` (hot files that never change with a test) and `bugspots` (files with a high bug-fix rate). If the caller already passed those, use them.

Split the changed files into source and tests by this repo's conventions: find where its tests live and how they are named before matching (`tests/`, `__tests__/`, `*_test.go`, `test_*.py`, `*.spec.ts`, Rust `#[cfg(test)]` modules in the same file). Docs, configs and generated files need no tests.

## What to check

For each changed source file:

- **Found**: is there a test for it, in the repo's convention?
- **Updated**: if its behavior changed, did a test change or get added in this branch?
- **Exercised**: read the diff for new or changed exports and branches, then read the test. Does it import the module and call the new code, including error and edge paths the diff added? Trivial assertions (`expect(true)`, only `toBeDefined`) do not count.
- **Risk**: a file in both `testGaps` and `bugspots` with no test change is the top finding (`high-risk-untested`). A file with a bug-fix rate over 0.3 whose test is shallow is `weak-test-for-risky-file`.

Use judgment on what "changed behavior" means: a rename or a log line does not need a new test; a new branch in a parser does.

## Constraints

- Read only. Do not edit files or spawn agents; the caller decides what to do with gaps.
- Missing tests never fail the run. Report them with a clear recommendation.

## Output

End with this block. Keep the field names: the review loop and `/next-task` read them.

```
=== TEST_COVERAGE_RESULT ===
{
  "scope": "new-work-only",
  "coverage": { "filesAnalyzed": 5, "filesWithTests": 3, "filesMissingTests": 2, "coveragePercent": 60 },
  "gaps": [{ "file": "src/parse.js", "reason": "new branch for empty input is not tested", "testFile": "tests/parse.test.js" }],
  "qualityIssues": [{ "file": "tests/auth.test.js", "type": "untested-export|trivial-assertion|no-source-import|missing-edge-cases", "message": "..." }],
  "covered": [{ "file": "src/auth.js", "testFile": "tests/auth.test.js" }],
  "riskIssues": [{ "file": "src/core.js", "type": "high-risk-untested|weak-test-for-risky-file", "bugFixRate": 0.42, "message": "..." }],
  "summary": { "status": "good|gaps|poor", "recommendation": "...", "riskSummary": "..." }
}
=== END_RESULT ===
```
