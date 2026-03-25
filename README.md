# prepare-delivery

Pre-ship quality gates for the [agentsys](https://github.com/agent-sh/agentsys) ecosystem.

Run all quality checks on your implementation before shipping - deslop, simplify, agnix, enhance, review loop, delivery validation, and docs sync. Does not create PRs or push.

## Installation

```bash
# Via agentsys (recommended)
claude plugin marketplace add agent-sh/agentsys

# Standalone
claude mcp add-json prepare-delivery '{"type":"url","url":"https://github.com/agent-sh/prepare-delivery.git"}'
```

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
| 1 | deslop + simplify + test-coverage-checker | Parallel |
| | _Deslop fixes are applied via next-task:simple-fixer when found_ | |
| 2 | agnix + enhance | Conditional (when changes touch agent/skill configs) |
| 3 | 4 core reviewers + conditional specialists | Iterative (max 5) |
| 4 | delivery-validator (tests, build, requirements) | Blocking |
| 5 | sync-docs agent | Sequential |

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
| prepare-delivery-agent | sonnet | Orchestrates the full pipeline via skill |
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
| Pre-review gates | [next-task](https://github.com/agent-sh/next-task) | next-task:simple-fixer |
| Pre-review gates | (built-in) | /simplify skill |
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
