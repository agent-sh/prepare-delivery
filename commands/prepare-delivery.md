---
description: "Run pre-ship quality gates - deslop, simplify, agnix, enhance, review loop, delivery validation, and docs sync. Does not ship."
codex-description: 'Use when user asks to "prepare delivery", "run quality gates", "review code", "run pre-gates", "deslop and review", "validate before shipping", or has finished implementation and wants quality checks before shipping.'
argument-hint: "[--base=BRANCH] [--skip-review] [--skip-docs]"
allowed-tools: Task, Read
---

# /prepare-delivery - Pre-Ship Quality Gates

Run all quality gates on your implementation before shipping.
Does NOT ship - use `/gate-and-ship` to prepare + ship, or run `/ship` separately after.

## Arguments

- `--base=BRANCH`: Override the base branch (default: auto-detect or `main`)
- `--skip-review`: Skip the review loop
- `--skip-docs`: Skip docs sync

## Execution

### Phase 1: Spawn Prepare Delivery Agent

```javascript
const args = '$ARGUMENTS'.split(' ').filter(Boolean);
const argsStr = args.join(' ');

// Pre-fetch repo-intel context for the agent
let repoIntelContext = '';
try {
  const { binary } = require('@agentsys/lib');
  const fs = require('fs');
  const path = require('path');
  const cwd = process.cwd();
  const stateDir = ['.claude', '.opencode', '.codex'].find(d => fs.existsSync(path.join(cwd, d))) || '.claude';
  const mapFile = path.join(cwd, stateDir, 'repo-intel.json');

  if (fs.existsSync(mapFile)) {
    const parts = [];
    try {
      const testGaps = JSON.parse(binary.runAnalyzer(['repo-intel', 'query', 'test-gaps', '--top', '20', '--map-file', mapFile, cwd]));
      if (testGaps?.length) parts.push('Test gaps: ' + testGaps.map(f => f.path).join(', '));
    } catch (e) {}
    try {
      const aiFiles = JSON.parse(binary.runAnalyzer(['repo-intel', 'query', 'recent-ai', '--top', '30', '--map-file', mapFile, cwd]));
      if (aiFiles?.length) parts.push('AI-written files: ' + aiFiles.map(f => f.path).join(', '));
    } catch (e) {}

    if (parts.length > 0) {
      repoIntelContext = '\n\nRepo-intel context:\n' + parts.join('\n');
    }
  }
} catch (e) { /* repo-intel unavailable */ }

const result = await Task({
  subagent_type: "prepare-delivery:prepare-delivery-agent",
  prompt: `Run pre-ship quality gate pipeline.
Arguments: ${argsStr}
${repoIntelContext}

Return structured results between === PREPARE_DELIVERY_RESULT === markers.`
});
```

### Phase 2: Parse Agent Results

```javascript
function parseResult(output) {
  const match = output.match(/=== PREPARE_DELIVERY_RESULT ===[\s\S]*?({[\s\S]*?})[\s\S]*?=== END_RESULT ===/);
  return match ? JSON.parse(match[1]) : { approved: false, error: 'No structured result' };
}

const delivery = parseResult(result);
```

### Phase 3: Present Results

```markdown
## Prepare Delivery Report

| Phase | Status |
|-------|--------|
| Pre-review gates | ${delivery.phases?.preReviewGates?.passed ? '[OK]' : '[FAIL]'} |
| Config lint | ${delivery.phases?.configLint?.ran ? '[OK]' : 'skipped'} |
| Review loop | ${delivery.phases?.reviewLoop?.approved ? '[OK]' : delivery.phases?.reviewLoop?.skipped ? 'skipped' : '[FAIL]'} |
| Delivery validation | ${delivery.phases?.deliveryValidation?.approved ? '[OK]' : '[FAIL]'} |
| Docs sync | ${delivery.phases?.docsSync?.updated ? '[OK]' : delivery.phases?.docsSync?.skipped ? 'skipped' : '[FAIL]'} |

**Status**: ${delivery.readyToShip ? '[OK] Ready to ship' : '[FAIL] Not ready'}
```

If ready to ship:
```
Run /ship to create PR and merge, or /gate-and-ship to prepare + ship in one step.
```

If not ready:
```
Fix the reported issues and run /prepare-delivery again.
```
