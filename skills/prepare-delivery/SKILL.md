---
name: prepare-delivery
description: "Use when the user asks to prepare delivery, run quality gates, deslop and review, or validate before shipping. Runs local gates on the branch and reports readiness. Does not push."
version: 0.2.0
argument-hint: "[--base=BRANCH] [--skip-review] [--skip-docs]"
---

# prepare-delivery

Take a finished feature branch through the local quality gates and say whether it is ready to ship: slop cleaned, configs linted, review findings fixed, tests and build green, docs in step with the code. Pushing, PRs and merging belong to `/ship`.

Arguments: `$ARGUMENTS` (`--base=BRANCH`, `--skip-review`, `--skip-docs`).

`<plugin>` below is this plugin's root, two directories up from this skill (`${CLAUDE_PLUGIN_ROOT}` in Claude Code).

## Start

```bash
node <plugin>/scripts/delivery.js context [--base=BRANCH]
```

It prints the branch, the base and the ref it diffs against (the remote branch when there is one), `changedFiles` (`base...HEAD`, files that still exist), `deletedFiles`, uncommitted paths, any existing flow state, and repo-intel signals for the changed files (`diffRisk`, `testGaps`, `bugspots`) when a map and the analyzer are installed. Stop with an error if `onBase` is true or `changedFiles` is empty: there is nothing to deliver.

## Gates

Run them in this order; each later gate checks the output of the earlier ones.

1. **Pre-review gates**, in parallel:
   - `deslop:deslop-agent` with `Mode: apply`, `Scope: diff`, `Thoroughness: normal`. It only reports. Apply its `fixes` yourself: read each line, make the edit, and skip any fix that no longer matches the file.
   - `prepare-delivery:test-coverage-checker`, passing `testGaps` and `bugspots` from the context. Advisory: its gaps feed the review loop, they do not stop delivery.
   - The `simplify` skill, when the harness has it. It is optional; if it is missing or fails, note that and go on.
2. **Config lint**, only when changed files include agent configuration (`agents/`, `skills/`, `commands/` markdown, `SKILL.md`, `CLAUDE.md`, `AGENTS.md`, `plugin.json`, `components.json`, hook files). Run `agnix .` if it is installed and fix errors it reports in files this branch changed; errors elsewhere are reported, not fixed. Run the `enhance` skill with `--apply` when it is installed. Missing tools are skipped, not failures.
3. **Review loop**, unless `--skip-review`: follow the `orchestrate-review` skill over the changed files, with the risk order from `diffRisk`. It ends approved, blocked (user chose to stop), or overridden.
4. **Delivery validation**: spawn `prepare-delivery:delivery-validator` with the base ref, the changed and deleted files, the review outcome (`approved`, `skipped`, or `overridden`) and the task description if the flow state has one. If it does not approve, stop here and return its `fixInstructions`: docs sync on a failing branch is wasted work.
5. **Docs sync**, unless `--skip-docs`: spawn `sync-docs:sync-docs-agent` with `Mode: apply`, `Scope: before-pr`. It returns `fixes` in a `=== SYNC_DOCS_RESULT ===` block and does not edit; apply them yourself.

A gate whose plugin is not installed (deslop, sync-docs) is skipped with a `[WARN]` line in the report, not failed. When Task is not available, run each agent's skill inline instead (`deslop`, `check-test-coverage`, `validate-delivery`, `sync-docs`).

## Commits

Each gate that changed files gets its own commit: `fix: clean up AI slop`, `fix: apply config lint fixes`, `fix: review feedback (iteration N)`, `docs: sync documentation with code changes`. Stage only the paths the gate edited (`git add -- <paths>`). The user may have uncommitted work in the tree, and `git add .`, `git add -A`, `git stash` or `git checkout -- .` would sweep it into a commit or throw it away. Run git hooks; do not pass `--no-verify`.

## Constraints

- Do not push, open a PR, or run `/ship`. This skill is local; `/gate-and-ship` chains `/ship` after it.
- Skip a gate only when its flag is set or its tool is missing, and say which in the result.
- Reviewer and deslop suggestions are proposals. Read the code before applying one, most of all in auth, crypto and input handling, where a plausible wrong fix is worse than the finding.

## Flow state

`/ship --state-file` reads the flow state to skip a second internal review. Record the outcome before returning:

```bash
node <plugin>/scripts/delivery.js flow --json '{"git":{"baseBranch":"<base>"},"phase":"docs-update","status":"in_progress","preReviewResult":{...},"reviewResult":{"approved":true,"iterations":2},"deliveryResult":{"approved":true},"docsResult":{"docsUpdated":true}}'
```

It creates a standalone flow when none exists, updates one owned by this branch, replaces a standalone flow left by another branch, and leaves a `/next-task` flow owned by another branch untouched (it reports `written: false`). Write `reviewResult.approved: true` only when the review loop approved, or was skipped by flag with `skipped: true`.

## Done

Every gate ran or was skipped with a reason, fixes are committed gate by gate, the flow state is recorded, and the result block below is the last thing in the reply.

## Output

```
=== PREPARE_DELIVERY_RESULT ===
{
  "approved": true,
  "branch": "feature/x",
  "baseBranch": "main",
  "phases": {
    "preReviewGates": { "passed": true, "deslopFixes": 0, "coverageGaps": 1, "simplify": "ran|skipped" },
    "configLint": { "ran": true, "agnix": true, "enhance": false },
    "reviewLoop": { "approved": true, "iterations": 2, "skipped": false, "blocked": false, "overridden": false },
    "deliveryValidation": { "approved": true, "riskSummary": "..." },
    "docsSync": { "updated": true, "fixesApplied": 1, "skipped": false }
  },
  "warnings": ["sync-docs not installed: docs sync skipped"],
  "fixInstructions": [],
  "readyToShip": true
}
=== END_RESULT ===
```

`readyToShip` is true only when delivery validation approved and the review loop approved, was skipped by flag, or was overridden by the user in this run. Carry `overridden: true` so `/ship` and the reader can see an override.
