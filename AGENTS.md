# prepare-delivery

> Pre-ship quality gates - deslop, simplify, agnix, enhance, review loop, delivery validation, docs sync

## Overview

An agentsys plugin: Markdown prompts in `commands/`, `agents/` and `skills/`, plus `scripts/delivery.js`, a dependency-free Node.js script for the deterministic parts (branch context, result-block parsing, review aggregation, flow state). Tests use `node:test`; CI runs them on Linux and macOS.

## Conventions

- Output is plain text with the status markers `[OK]`, `[ERROR]`, `[WARN]`, `[CRITICAL]`, and no emojis or ASCII art. People read it in terminals and other plugins parse it; spend tokens on content, not decoration.
- In prose, write a spaced single dash (` - `), not ` -- ` or an em dash.
- Put summaries, plans and audit notes in the PR or issue, not in committed files: committed notes go stale.
- Changes reach main through a PR. A feature or fix is done when tests that cover it pass.
- Keep git hooks on: commit and push without `--no-verify`.
- When a script or tool fails, report the failure before working around it, so the tool gets fixed.
- Deterministic logic lives in `scripts/delivery.js`: result-block parsing, review aggregation and its false-positive rules, flow state. Change it there, with a test, not in skill prose.
- The REVIEWER CONTRACT block in `skills/orchestrate-review/SKILL.md` has a twin in the [audit-project plugin's reviewer prompt](https://github.com/agent-sh/audit-project/blob/main/commands/audit-project-agents.md). When you edit either block, update both to the same intent. No check enforces this yet.
- When goals conflict, rank them: plugin users' experience, automation that needs no babysitting, token cost, output quality, simplicity.

## Agents

- **prepare-delivery-agent** (inherits the session model, since its judgment decides which review fixes ship) - orchestrates the full pre-ship pipeline via skill
- **delivery-validator** (sonnet) - autonomous pass/fail validation after review approval
- **test-coverage-checker** (sonnet) - validates test quality for changed files (advisory)

## Skills

- **prepare-delivery** - 5-phase pipeline: deslop, config lint, review, validation, docs
- **check-test-coverage** - test existence, quality, and risk-weighted validation
- **orchestrate-review** - multi-pass parallel code review with iteration
- **validate-delivery** - tests, build, requirements, diff-risk checks

## Commands

- prepare-delivery

## Cross-Plugin Dependencies

| Phase | Plugin | Agent/Skill |
|-------|--------|-------------|
| Pre-review gates | deslop | `deslop:deslop-agent` |
| Pre-review gates | (own) | `prepare-delivery:test-coverage-checker` |
| Pre-review gates | (third-party, optional) | `/simplify` skill - invoked when installed; failures are swallowed |
| Config lint | agnix | `agnix` CLI (conditional) |
| Config lint | enhance | `/enhance` skill (conditional) |
| Review loop | (general-purpose) | 4 core + conditional reviewer agents |
| Delivery validation | (own) | `prepare-delivery:delivery-validator` |
| Docs sync | sync-docs | `sync-docs:sync-docs-agent` |
| Ship (via /gate-and-ship) | ship | `ship:ship` command |

## Dev commands

```bash
npm test                        # node:test suite
node --check scripts/delivery.js
agnix .                         # agent config lint
```

## References

- Part of the [agentsys](https://github.com/agent-sh/agentsys) ecosystem
- https://agentskills.io
