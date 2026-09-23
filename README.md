# prepare-delivery

Pre-ship quality gates for the [agentsys](https://github.com/agent-sh/agentsys) ecosystem.

Run all quality checks on your implementation before shipping - deslop, simplify, agnix, enhance, review loop, delivery validation, and docs sync. Does not create PRs or push.

## Installation

```bash
agentsys install prepare-delivery
```

Or add the marketplace in Claude Code with `claude plugin marketplace add agent-sh/agentsys` and install `prepare-delivery` from it.

## Usage

```bash
/prepare-delivery                    # Run all quality gates
/prepare-delivery --skip-review      # Skip review loop
/prepare-delivery --skip-docs        # Skip docs sync
/prepare-delivery --base=develop     # Against a specific base branch
```

## Pipeline

| Phase | What runs | Mode |
|-------|-----------|------|
| 1 | deslop + simplify + test-coverage-checker | Parallel; deslop fixes are applied by the pipeline itself |
| 2 | agnix + enhance | Only when changes touch agent/skill/plugin configs |
| 3 | 4 core reviewers + signal-based specialists | Iterative, max 5 rounds, stops on a stall |
| 4 | delivery-validator (tests, build, requirements, review status) | Blocking |
| 5 | sync-docs agent | Fixes applied by the pipeline |

Each gate commits only the files it edited, so uncommitted work in your tree is left alone. A missing optional plugin (deslop, sync-docs, enhance, agnix, simplify) skips its gate with a warning.

`scripts/delivery.js` does the deterministic parts: branch context and repo-intel signals (`context`), parsing result blocks (`extract`), the review aggregation and its false-positive rules (`aggregate`), and the flow state `/ship --state-file` reads (`flow`).

## Composability

```
/prepare-delivery  = quality gates only
/ship              = PR + CI + merge only
/gate-and-ship     = /prepare-delivery + /ship
/next-task         = full workflow (uses prepare-delivery agents in phases 8-10)
```

## Components

### Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| prepare-delivery-agent | inherits | Orchestrates the full pipeline via skill |
| delivery-validator | sonnet | Autonomous pass/fail validation |
| test-coverage-checker | sonnet | Test quality validation (advisory) |

### Skills

| Skill | Purpose |
|-------|---------|
| prepare-delivery | 5-phase pipeline orchestration |
| check-test-coverage | Test existence, quality, risk-weighted validation |
| orchestrate-review | Multi-pass parallel code review with iteration |
| validate-delivery | Tests, build, requirements, diff-risk checks |

## Cross-Plugin Dependencies

| Phase | Plugin | Agent/Skill |
|-------|--------|-------------|
| Pre-review gates | [deslop](https://github.com/agent-sh/deslop) | deslop:deslop-agent |
| Pre-review gates | (own) | prepare-delivery:test-coverage-checker |
| Pre-review gates | (optional) | simplify skill, when the harness has it |
| Config lint | [agnix](https://github.com/agent-sh/agnix) | agnix CLI (conditional) |
| Config lint | [enhance](https://github.com/agent-sh/enhance) | /enhance skill (conditional) |
| Review loop | (general-purpose) | 4 core + conditional reviewer agents |
| Delivery validation | (own) | prepare-delivery:delivery-validator |
| Docs sync | [sync-docs](https://github.com/agent-sh/sync-docs) | sync-docs:sync-docs-agent |
| Ship (via /gate-and-ship) | [ship](https://github.com/agent-sh/ship) | ship:ship command |

## Platforms

Works with Claude Code, OpenCode, Codex CLI, and Cursor via agentsys.

## License

MIT
