---
name: prepare-delivery
description: "Use when user asks to \"prepare delivery\", \"run quality gates\", \"review code\", \"run pre-gates\", \"deslop and review\", \"validate before shipping\", or has finished implementation and wants quality checks before shipping."
version: 0.1.0
argument-hint: "[--base=BRANCH] [--skip-review] [--skip-docs]"
---

# prepare-delivery

Pre-ship quality gate pipeline. Runs all checks needed before a PR can be created.

## Pipeline Overview

```
Phase 1: Pre-review gates (parallel)
  - deslop:deslop-agent     (AI slop cleanup)
  - /simplify               (code simplification, optional - skipped if not installed)
  - test-coverage-checker    (test coverage validation)

Phase 2: Config lint (conditional)
  - agnix                   (agent config validation - if changes touch skills/agents/CLAUDE.md)
  - /enhance                (best-practice analysis - if changes touch plugin files)

Phase 3: Review loop
  - 4 core reviewers in parallel (code-quality, security, performance, test-coverage)
  - Conditional specialists based on changed file signals
  - Max 5 iterations, stall detection

Phase 4: Delivery validation
  - delivery-validator      (tests pass, build passes, requirements met)

Phase 5: Docs sync
  - sync-docs:sync-docs-agent (documentation matches code)
```

## Arguments

- `--base=BRANCH`: Base branch (default: auto-detect or `main`)
- `--skip-review`: Skip Phase 3 (review loop)
- `--skip-docs`: Skip Phase 5 (docs sync)

## Pre-flight

```javascript
const args = '$ARGUMENTS'.split(' ').filter(Boolean);

const baseArg = args.find(a => a.startsWith('--base='));
let BASE_BRANCH = 'main';
if (baseArg) {
  BASE_BRANCH = baseArg.split('=')[1];
} else {
  const ref = await run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD']).catch(() => '');
  BASE_BRANCH = ref.trim().replace('refs/remotes/origin/', '') || 'main';
}

const skipReview = args.includes('--skip-review');
const skipDocs = args.includes('--skip-docs');

const currentBranch = (await run('git', ['branch', '--show-current'])).trim();
if (currentBranch === BASE_BRANCH) {
  return { error: `Cannot deliver from ${BASE_BRANCH}. Switch to a feature branch first.` };
}

const changedFiles = (await run('git', ['diff', '--name-only', `${BASE_BRANCH}...HEAD`])).trim().split('\n').filter(Boolean);
if (changedFiles.length === 0) {
  return { error: `No changes found between ${BASE_BRANCH} and HEAD.` };
}
```

## State Management

```javascript
let workflowState = null;
try {
  const { getPluginRoot } = require('./lib/cross-platform');
  const path = require('path');
  const pluginRoot = getPluginRoot('next-task');
  if (pluginRoot) {
    workflowState = require(path.join(pluginRoot, 'lib/state/workflow-state.js'));
  }
} catch (e) { /* next-task not installed */ }

let flow = workflowState?.readFlow();
if (!flow && workflowState) {
  flow = {
    task: { id: 'standalone', title: `Deliver ${currentBranch}`, source: 'manual' },
    policy: { stoppingPoint: 'merged' },
    phase: 'pre-review-gates',
    status: 'in_progress',
    git: { branch: currentBranch, baseBranch: BASE_BRANCH }
  };
  workflowState.writeFlow(flow);
} else if (flow && workflowState) {
  workflowState.updateFlow({ git: { branch: currentBranch, baseBranch: BASE_BRANCH } });
}
```

---

<phase-1>
## Phase 1: Pre-Review Gates

**Parallel execution**: deslop + test-coverage + simplify

```javascript
workflowState?.startPhase('pre-review-gates');

// Pre-fetch repo-intel for test gaps
let testGapsContext = '';
try {
  const { binary } = require('@agentsys/lib');
  const { getStateDirPath } = require('@agentsys/lib/platform/state-dir');
  const fs = require('fs');
  const path = require('path');
  const cwd = process.cwd();
  const mapFile = path.join(getStateDirPath(cwd), 'repo-intel.json');

  if (fs.existsSync(mapFile)) {
    try {
      const testGaps = JSON.parse(binary.runAnalyzer([
        'repo-intel', 'query', 'test-gaps', '--top', '20', '--map-file', mapFile, cwd
      ]));
      if (testGaps?.length) {
        testGapsContext = '\n\nRepo intel test-gaps (hot files with no co-changing test file):\n' + JSON.stringify(testGaps, null, 2);
      }
    } catch (e) { /* unavailable */ }
  }
} catch (e) { /* repo-intel unavailable */ }

function parseDeslop(output) {
  const match = output.match(/=== DESLOP_RESULT ===[\s\S]*?({[\s\S]*?})[\s\S]*?=== END_RESULT ===/);
  return match ? JSON.parse(match[1]) : { fixes: [] };
}

// Run pre-review gates in parallel.
// /simplify is third-party (not bundled with agentsys); invoke only when installed,
// swallow errors so a missing skill never blocks delivery.
const simplifyCall = Skill({ name: "simplify" }).catch(err => {
  console.log(`[INFO] /simplify skipped (not installed or failed): ${err.message}`);
  return null;
});

const [deslopResult, coverageResult] = await Promise.all([
  Task({
    subagent_type: "deslop:deslop-agent",
    prompt: `Scan for AI slop patterns.
Mode: apply
Scope: diff
Thoroughness: normal

Return structured results between === DESLOP_RESULT === markers.`
  }),
  Task({ subagent_type: "prepare-delivery:test-coverage-checker", prompt: `Validate test coverage.${testGapsContext}` }),
  simplifyCall
]);

// Apply deslop fixes if found
const deslop = parseDeslop(deslopResult);
if (deslop.fixes && deslop.fixes.length > 0) {
  await Task({
    subagent_type: "next-task:simple-fixer",
    model: "haiku",
    prompt: `Apply these slop fixes:
${JSON.stringify(deslop.fixes, null, 2)}

For each fix:
- remove-line: Delete the line at the specified line number
- add-comment: Add "// Error intentionally ignored" to empty catch

Use Edit tool to apply. Commit message: "fix: clean up AI slop"`
  });
}

workflowState?.completePhase({
  passed: (deslop.fixes?.length || 0) === 0,
  deslopFixes: deslop.fixes?.length || 0,
  coverageResult
});
```
</phase-1>

<phase-2>
## Phase 2: Config Lint (Conditional)

Run agnix and enhance when changes touch agent/skill/plugin configuration files.

### Signal Detection

```javascript
const configSignals = {
  hasAgentConfigs: changedFiles.some(f => /(agents?|skills?|commands?)\/.*\.md$/i.test(f)),
  hasClaudeMd: changedFiles.some(f => /(CLAUDE|AGENTS)\.md$/i.test(f)),
  hasPluginJson: changedFiles.some(f => /plugin\.json|components\.json/i.test(f)),
  hasHooks: changedFiles.some(f => /hooks?\.(json|js|ts)$/i.test(f)),
  hasSkillMd: changedFiles.some(f => /SKILL\.md$/i.test(f))
};

const needsAgnix = configSignals.hasAgentConfigs || configSignals.hasClaudeMd ||
                   configSignals.hasPluginJson || configSignals.hasHooks || configSignals.hasSkillMd;
const needsEnhance = needsAgnix; // Same trigger set
```

### Run Linters (parallel when both needed)

```javascript
if (needsAgnix || needsEnhance) {
  const lintTasks = [];

  if (needsAgnix) {
    // agnix is a Rust binary - run via CLI
    lintTasks.push(
      run('agnix', ['.'], { ignoreExitCode: true }).catch(() => '[WARN] agnix not available')
    );
  }

  if (needsEnhance) {
    lintTasks.push(
      Skill({ name: "enhance", args: "--apply" })
    );
  }

  await Promise.all(lintTasks);

  // Commit any auto-fixes from enhance (stage only modified tracked files)
  const status = await run('git', ['status', '--porcelain']);
  if (status.trim()) {
    const modified = status.trim().split('\n')
      .filter(l => l.startsWith(' M') || l.startsWith('M '))
      .map(l => l.trim().split(/\s+/).pop());
    if (modified.length > 0) {
      await run('git', ['add', ...modified]);
      await run('git', ['commit', '-m', 'fix: apply config lint auto-fixes']);
    }
  }
} else {
  console.log('[OK] No agent/skill/plugin config changes - skipping agnix/enhance');
}
```
</phase-2>

<phase-3>
## Phase 3: Review Loop

**Skip if**: `--skip-review` flag is set.

```javascript
if (skipReview) {
  workflowState?.startPhase('review-loop');
  workflowState?.completePhase({ approved: true, iterations: 0, skipped: true });
  // Skip to Phase 4
}
```

When not skipped, invoke the `orchestrate-review` skill which contains the full review loop implementation (signal detection, parallel reviewer spawning, aggregation, iteration, stall detection).

```javascript
workflowState?.startPhase('review-loop');

// Delegate to orchestrate-review skill - single source of truth for the review loop
await Skill({ name: "prepare-delivery:orchestrate-review" });

// The skill handles:
// - Pre-fetching repo-intel diff risk
// - Detecting signals for conditional specialists
// - Spawning 4 core reviewers + conditional specialists in parallel
// - Aggregating findings, fixing issues, iterating (max 5)
// - Stall detection (same findings hash for 2 iterations)
// - State updates via workflowState.completePhase()
```

See `skills/orchestrate-review/SKILL.md` for the full implementation.
</phase-3>

<phase-4>
## Phase 4: Delivery Validation

**Agent**: `prepare-delivery:delivery-validator` (sonnet)

```javascript
workflowState?.startPhase('delivery-validation');
const result = await Task({
  subagent_type: "prepare-delivery:delivery-validator",
  prompt: `Validate completion. Check: tests pass, build passes, requirements met.`
});
if (!result.approved) {
  workflowState?.failPhase(result.reason, { fixInstructions: result.fixInstructions });
  return {
    approved: false,
    reason: result.reason,
    fixInstructions: result.fixInstructions
  };
}
```
</phase-4>

<phase-5>
## Phase 5: Docs Sync

**Skip if**: `--skip-docs` flag is set.

**Agent**: `sync-docs:sync-docs-agent` (sonnet)

```javascript
if (skipDocs) {
  workflowState?.startPhase('docs-update');
  workflowState?.completePhase({ docsUpdated: false, skipped: true });
} else {
  workflowState?.startPhase('docs-update');

  function parseSyncDocsResult(output) {
    const match = output.match(/=== SYNC_DOCS_RESULT ===[\s\S]*?({[\s\S]*?})[\s\S]*?=== END_RESULT ===/);
    return match ? JSON.parse(match[1]) : { issues: [], fixes: [], changelog: { status: 'ok' } };
  }

  const syncResult = await Task({
    subagent_type: "sync-docs:sync-docs-agent",
    prompt: `Sync documentation with code state.
Mode: apply
Scope: before-pr

Execute the sync-docs skill and return structured results.`
  });

  const result = parseSyncDocsResult(syncResult);

  if (result.fixes && result.fixes.length > 0) {
    await Task({
      subagent_type: "next-task:simple-fixer",
      model: "haiku",
      prompt: `Apply these documentation fixes:
${JSON.stringify(result.fixes, null, 2)}

Use the Edit tool to apply each fix. Commit message: "docs: sync documentation with code changes"`
    });
  }

  workflowState?.completePhase({ docsUpdated: true, fixesApplied: result.fixes?.length || 0 });
}
```
</phase-5>

## Output Format

Return structured JSON between markers:

```
=== PREPARE_DELIVERY_RESULT ===
{
  "approved": true|false,
  "branch": "feature/...",
  "baseBranch": "main",
  "phases": {
    "preReviewGates": { "passed": true, "deslopFixes": 0 },
    "configLint": { "ran": true|false, "agnix": true|false, "enhance": true|false },
    "reviewLoop": { "approved": true, "iterations": 2, "skipped": false },
    "deliveryValidation": { "approved": true },
    "docsSync": { "updated": true, "fixesApplied": 1, "skipped": false }
  },
  "readyToShip": true|false
}
=== END_RESULT ===
```

## Constraints

- Do NOT create PRs or push to remote - only local quality checks
- Do NOT skip phases unless explicitly flagged (--skip-review, --skip-docs)
- Return structured data for orchestrator to present
- Fail fast on delivery validation - no point continuing if tests/build fail
