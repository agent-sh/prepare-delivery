---
description: "Full delivery pipeline - runs /prepare-delivery (quality gates) then /ship. Use after completing implementation to go from code to merged PR in one command."
codex-description: 'Use when user asks to "deliver", "deliver and ship", "review and ship", "quality gates and ship", "full delivery", or wants to go from finished implementation to merged PR.'
argument-hint: "[--base=BRANCH] [--skip-review] [--skip-docs]"
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(node:*), Read, Write, Edit, Glob, Grep, Task, Skill, AskUserQuestion
---

# /deliver - Prepare + Ship

Chains `/prepare-delivery` (quality gates) then `/ship` (PR + merge).
Single command to go from finished implementation to merged PR.

---

## Arguments

All arguments are forwarded to `/prepare-delivery`:
- `--base=BRANCH`: Override the base branch (default: auto-detect or `main`)
- `--skip-review`: Skip the review loop
- `--skip-docs`: Skip docs sync

## Step 1: Prepare Delivery

Run all quality gates via `/prepare-delivery`.

```javascript
const args = '$ARGUMENTS';
console.log('[OK] Step 1: Running prepare-delivery...');
await Skill({ name: "prepare-delivery:prepare-delivery", args });
```

If prepare-delivery fails, stop here. Do not proceed to ship.

## Step 2: Ship

Hand off to `ship:ship` for PR creation, CI monitoring, and merge.

```javascript
console.log('[OK] Step 2: Handing off to ship:ship...');

// Parse --base from args for ship
const argList = args.split(' ').filter(Boolean);
const baseArg = argList.find(a => a.startsWith('--base='));
const BASE_BRANCH = baseArg ? baseArg.split('=')[1] : null;

// Build ship args
const shipArgs = [];
if (BASE_BRANCH) {
  shipArgs.push(`--base ${BASE_BRANCH}`);
}

// Pass flow state if next-task is installed
try {
  const { getPluginRoot } = require('./lib/cross-platform');
  const path = require('path');
  const pluginRoot = getPluginRoot('next-task');
  if (pluginRoot) {
    const workflowState = require(path.join(pluginRoot, 'lib/state/workflow-state.js'));
    const flowPath = workflowState.getFlowPath();
    shipArgs.push(`--state-file "${flowPath}"`);
  }
} catch (e) { /* next-task not installed */ }

await Skill({ name: "ship:ship", args: shipArgs.join(' ') });
```

## Error Handling

```javascript
try {
  // Step 1: prepare-delivery
  // Step 2: ship:ship
} catch (error) {
  console.log(`[ERROR] Delivery failed: ${error.message}`);
  console.log('Fix the issue and run /deliver again, or run /prepare-delivery and /ship separately.');
}
```

## Examples

```bash
# Full delivery: quality gates + ship
/deliver

# Against a specific base branch
/deliver --base=develop

# Skip review, still ship
/deliver --skip-review

# Combine flags
/deliver --base=develop --skip-docs
```

## Composability

This command composes two independent commands:

```
/deliver = /prepare-delivery + /ship
```

Each can be run independently:
- `/prepare-delivery` - run quality gates only, decide later whether to ship
- `/ship` - ship directly if you've already reviewed and validated
- `/deliver` - do both in sequence
