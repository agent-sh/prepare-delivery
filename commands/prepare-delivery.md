---
description: "Run pre-ship quality gates - deslop, simplify, agnix, enhance, review loop, delivery validation, and docs sync. Does not ship."
codex-description: 'Use when user asks to "prepare delivery", "run quality gates", "review code", "run pre-gates", "deslop and review", "validate before shipping", or has finished implementation and wants quality checks before shipping.'
argument-hint: "[--base=BRANCH] [--skip-review] [--skip-docs]"
allowed-tools: Task, Skill, Read, Edit, Write, Glob, Grep, Bash(git:*), Bash(node:*), Bash(npm:*), Bash(agnix:*), AskUserQuestion
---

# /prepare-delivery

Run the quality gates on the current branch and report whether it is ready to ship. Nothing is pushed and no PR is opened; `/ship` or `/gate-and-ship` does that.

Arguments: `$ARGUMENTS`

- `--base=BRANCH`: base branch. Default: the remote default branch, else `main`.
- `--skip-review`: skip the review loop.
- `--skip-docs`: skip docs sync.

## Run

Spawn `prepare-delivery:prepare-delivery-agent` with the arguments. It runs the whole pipeline and ends its reply with a `=== PREPARE_DELIVERY_RESULT ===` block. If Task is not available, read this plugin's `skills/prepare-delivery/SKILL.md` and run it inline (not through the Skill tool: `Skill(prepare-delivery)` resolves to this command).

The block holds nested JSON. When you need it as data rather than reading it, save the reply to a file and run `node <plugin>/scripts/delivery.js extract PREPARE_DELIVERY_RESULT <file>` (`<plugin>` is this plugin's root, `${CLAUDE_PLUGIN_ROOT}` in Claude Code); do not cut it out with a regex. If there is no parseable block, report the run as not ready and quote the end of the agent's reply.

## Report

```markdown
## Prepare Delivery Report

| Phase | Status |
|-------|--------|
| Pre-review gates | [OK] or [FAIL] |
| Config lint | [OK], [WARN] or skipped |
| Review loop | [OK], [FAIL], blocked or skipped |
| Delivery validation | [OK] or [FAIL] |
| Docs sync | [OK], [FAIL] or skipped |

**Status**: [OK] Ready to ship | [FAIL] Not ready
```

Under the table, list what each gate changed (commits made) and, when not ready, the fix instructions from the result. End with the next step: `/ship` (or `/gate-and-ship`) when ready, otherwise fix and run `/prepare-delivery` again.
