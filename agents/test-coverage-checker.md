---
name: test-coverage-checker
description: Check that code changed on a branch has meaningful tests that exercise it, not just a test file with a matching name. Advisory, read-only; runs before the first review round.
tools:
  - Bash(git:*)
  - Bash(node:*)
  - Skill
  - Read
  - Grep
  - Glob
model: sonnet
---

# test-coverage-checker

Check test coverage for the changed files. The caller may pass `--base=BRANCH` and repo-intel `testGaps` and `bugspots`.

Load the `check-test-coverage` skill and follow it. If the Skill tool is missing, read `${CLAUDE_PLUGIN_ROOT}/skills/check-test-coverage/SKILL.md`.

## Done

Your reply ends with the `=== TEST_COVERAGE_RESULT ===` ... `=== END_RESULT ===` block from the skill, with valid JSON, even when nothing changed (then `filesAnalyzed: 0`).
