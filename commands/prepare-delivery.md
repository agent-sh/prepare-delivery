---
description: "Run pre-ship quality gates - deslop, simplify, review loop, delivery validation, and docs sync. Does not ship. Use after completing implementation, before /ship or /deliver."
codex-description: 'Use when user asks to "prepare delivery", "run quality gates", "review code", "run pre-gates", "deslop and review", "validate before shipping", or has finished implementation and wants quality checks before shipping.'
argument-hint: "[--base=BRANCH] [--skip-review] [--skip-docs]"
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(node:*), Read, Write, Edit, Glob, Grep, Task, Skill, AskUserQuestion
---

# /prepare-delivery - Pre-Ship Quality Gates

Run quality gates on your implementation before shipping.
Executes: pre-review gates (deslop + simplify + test-coverage), review loop, delivery validation, and docs sync.
Does NOT ship - use `/gate-and-ship` to prepare + ship, or run `/ship` separately after.

---

## When to Use

- After completing implementation manually (without /next-task)
- When resuming delivery after implementation was done in a prior session
- When you have committed changes on a feature branch and want quality gates + ship

## Arguments

Parse from $ARGUMENTS:
- `--base=BRANCH`: Override the base branch (default: auto-detect or `main`)
- `--skip-review`: Skip the review loop - use when already reviewed
- `--skip-docs`: Skip docs sync - use when no docs affected

## Pre-flight

```javascript
const args = '$ARGUMENTS'.split(' ').filter(Boolean);

// Parse --base=BRANCH
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

// Verify we're on a feature branch
const currentBranch = (await run('git', ['branch', '--show-current'])).trim();
if (currentBranch === BASE_BRANCH) {
  console.error(`[ERROR] Cannot deliver from ${BASE_BRANCH}. Switch to a feature branch first.`);
  return;
}

// Verify there are changes to deliver
const changedFiles = (await run('git', ['diff', '--name-only', `${BASE_BRANCH}...HEAD`])).trim().split('\n').filter(Boolean);
if (changedFiles.length === 0) {
  console.error(`[ERROR] No changes found between ${BASE_BRANCH} and HEAD. Nothing to deliver.`);
  return;
}

console.log(`[OK] Delivering branch: ${currentBranch}`);
console.log(`[OK] Base branch: ${BASE_BRANCH}`);
console.log(`[OK] Changed files: ${changedFiles.length}`);
```

## State Management

```javascript
// Try next-task's workflow state if available, otherwise track minimally
let workflowState = null;
try {
  const { getPluginRoot } = require('./lib/cross-platform');
  const path = require('path');
  const pluginRoot = getPluginRoot('next-task');
  if (pluginRoot) {
    workflowState = require(path.join(pluginRoot, 'lib/state/workflow-state.js'));
  }
} catch (e) { /* next-task not installed */ }

// Load existing flow or create minimal one
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

<phase-8>
## Phase 8: Pre-Review Gates

**Parallel**: `deslop:deslop-agent` + `next-task:test-coverage-checker` + `/simplify`

```javascript
workflowState?.startPhase('pre-review-gates');
console.log('[OK] Phase 8: Running pre-review gates (deslop + test-coverage + simplify)...');

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

// Run all three gates in parallel
const [deslopResult, coverageResult] = await Promise.all([
  Task({
    subagent_type: "deslop:deslop-agent",
    prompt: `Scan for AI slop patterns.
Mode: apply
Scope: diff
Thoroughness: normal

Return structured results between === DESLOP_RESULT === markers.`
  }),
  Task({ subagent_type: "next-task:test-coverage-checker", prompt: `Validate test coverage.${testGapsContext}` }),
  Skill({ name: "simplify" })
]);

// If deslop fixes found, apply them
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
console.log(`[OK] Pre-review gates complete. Deslop fixes: ${deslop.fixes?.length || 0}`);
```
</phase-8>

<phase-9>
## Phase 9: Review Loop

**Skip if**: `--skip-review` flag is set.

```javascript
if (skipReview) {
  console.log('[WARN] Skipping review loop (--skip-review)');
  workflowState?.startPhase('review-loop');
  workflowState?.completePhase({ approved: true, iterations: 0, skipped: true });
}
```

When not skipped, run the full review loop below.

**CRITICAL**: Spawn multiple parallel reviewer agents. Do NOT use a single generic reviewer.

```javascript
workflowState?.startPhase('review-loop');
console.log('[OK] Phase 9: Running review loop...');

// Pre-fetch repo-intel diff risk
let diffRiskContext = '';
try {
  const { binary } = require('@agentsys/lib');
  const fs = require('fs');
  const cp = require('child_process');
  const { getStateDirPath } = require('@agentsys/lib/platform/state-dir');
  const cwd = process.cwd();
  const mapFile = path.join(getStateDirPath(cwd), 'repo-intel.json');

  if (fs.existsSync(mapFile)) {
    const files = cp.execFileSync('git', ['diff', '--name-only', `${BASE_BRANCH}...HEAD`], {
      encoding: 'utf8', cwd
    }).trim().split('\n').filter(Boolean);

    if (files.length > 0) {
      try {
        const diffRisk = JSON.parse(binary.runAnalyzer([
          'repo-intel', 'query', 'diff-risk',
          '--files', files.join(','),
          '--map-file', mapFile, cwd
        ]));
        if (diffRisk) {
          diffRiskContext = '\n\nRepo intel diff-risk (focus review on highest-risk files):\n' + JSON.stringify(diffRisk, null, 2);
        }
      } catch (e) { /* unavailable */ }
    }
  }
} catch (e) { /* repo-intel unavailable */ }
```

### Step 1: Get Changed Files

```bash
git diff --name-only ${BASE_BRANCH}...HEAD
```

### Step 2: Detect Signals for Conditional Specialists

| Signal | Pattern | Specialist |
|--------|---------|------------|
| hasDb | `/(db\|migrations?\|schema\|prisma\|sql)/i` | database specialist |
| hasApi | `/(api\|routes?\|controllers?\|handlers?)/i` | api designer |
| hasFrontend | `/\.(tsx\|jsx\|vue\|svelte)$/` | frontend specialist |
| hasBackend | `/(server\|backend\|services?\|domain)/i` | backend specialist |
| hasDevops | `/(\.github\/workflows\|Dockerfile\|k8s\|terraform)/i` | devops reviewer |
| needsArchitecture | 20+ changed files | architecture reviewer |

### Step 3: Spawn ALL Reviewer Agents in Parallel

**MANDATORY**: 4 core reviewers (ALWAYS) + conditional specialists.

```javascript
const reviewResults = await Promise.all([
  Task({ subagent_type: 'general-purpose', model: 'sonnet',
    prompt: `You are a code quality reviewer. Review these files: ${files.join(', ')}
Focus: Style and consistency, Best practices, Bugs and logic errors, Error handling, Maintainability, Duplication
Return findings as JSON array with: file, line, severity (critical/high/medium/low), description, suggestion${diffRiskContext}` }),
  Task({ subagent_type: 'general-purpose', model: 'sonnet',
    prompt: `You are a security reviewer. Review these files: ${files.join(', ')}
Focus: Auth/authz flaws, Input validation, Injection risks, Secrets exposure, Insecure defaults
Return findings as JSON array with: file, line, severity (critical/high/medium/low), description, suggestion${diffRiskContext}` }),
  Task({ subagent_type: 'general-purpose', model: 'sonnet',
    prompt: `You are a performance reviewer. Review these files: ${files.join(', ')}
Focus: N+1 queries, Blocking operations, Hot path inefficiencies, Memory leaks
Return findings as JSON array with: file, line, severity (critical/high/medium/low), description, suggestion${diffRiskContext}` }),
  Task({ subagent_type: 'general-purpose', model: 'sonnet',
    prompt: `You are a test coverage reviewer. Review these files: ${files.join(', ')}
Focus: Missing tests, Edge case coverage, Test quality, Integration needs, Mock appropriateness
Return findings as JSON array with: file, line, severity (critical/high/medium/low), description, suggestion${diffRiskContext}` })
]);

// Add conditional specialists based on detected signals
```

### Step 4: Aggregate, Fix, Iterate

Combine findings, deduplicate by file+line+description, group by severity.
Fix issues in severity order: critical -> high -> medium -> low.
Commit after each batch.

Repeat until:
- `openCount === 0` -> approved
- Same findings hash for 2 consecutive iterations -> stall
- 5 iterations reached -> hard limit

### Review Iteration Rules
- MUST run at least 1 full iteration with ALL 4 core reviewers
- Do NOT use a single generic reviewer
- MUST continue while `openCount > 0`

### Verification Output (MANDATORY)

```
[VERIFIED] Review Loop Complete
- Iterations: N
- Core reviewers spawned: code-quality, security, performance, test-coverage
- Conditional specialists: [list]
- Findings resolved: X critical, Y high, Z medium
- Status: approved | blocked
```

```javascript
workflowState?.completePhase({ approved, iterations, remaining });
```
</phase-9>

<phase-10>
## Phase 10: Delivery Validation

**Agent**: `next-task:delivery-validator` (sonnet)

```javascript
workflowState?.startPhase('delivery-validation');
console.log('[OK] Phase 10: Running delivery validation...');
const result = await Task({
  subagent_type: "next-task:delivery-validator",
  prompt: `Validate completion. Check: tests pass, build passes, requirements met.`
});
if (!result.approved) {
  console.error(`[ERROR] Delivery validation failed: ${result.reason}`);
  workflowState?.failPhase(result.reason, { fixInstructions: result.fixInstructions });
  console.log('Fix the issues above and run /prepare-delivery again.');
  return;
}
console.log('[OK] Delivery validation passed.');
```
</phase-10>

<phase-11>
## Phase 11: Docs Update

**Skip if**: `--skip-docs` flag is set.

**Agent**: `sync-docs:sync-docs-agent` (sonnet)

```javascript
if (skipDocs) {
  console.log('[WARN] Skipping docs sync (--skip-docs)');
  workflowState?.startPhase('docs-update');
  workflowState?.completePhase({ docsUpdated: false, skipped: true });
} else {
  workflowState?.startPhase('docs-update');
  console.log('[OK] Phase 11: Syncing documentation...');

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
  console.log(`[OK] Docs sync complete. Fixes applied: ${result.fixes?.length || 0}`);
}
```
</phase-11>

## Done

```javascript
console.log('[OK] All quality gates passed. Ready to ship.');
console.log('Run /ship to create PR and merge, or /gate-and-ship to prepare + ship in one step.');
```

## Error Handling

```javascript
try {
  // ... delivery phases ...
} catch (error) {
  workflowState?.failPhase(error.message);
  console.log(`[ERROR] Preparation failed: ${error.message}`);
  console.log('Fix the issue and run /prepare-delivery again to retry.');
}
```

## Examples

```bash
# Run all quality gates
/prepare-delivery

# Against a specific base branch
/prepare-delivery --base=develop

# Skip review loop (already reviewed)
/prepare-delivery --skip-review

# Skip docs sync (no docs affected)
/prepare-delivery --skip-docs

# Combine flags
/prepare-delivery --base=develop --skip-docs
```
