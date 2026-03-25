# prepare-delivery

> Pre-ship quality gates - deslop, simplify, agnix, enhance, review loop, delivery validation, docs sync

## Agents

- prepare-delivery-agent
- delivery-validator
- test-coverage-checker

## Skills

- prepare-delivery
- orchestrate-review
- validate-delivery

## Commands

- prepare-delivery

## Critical Rules

1. **Plain text output** - No emojis, no ASCII art. Use `[OK]`, `[ERROR]`, `[WARN]`, `[CRITICAL]` for status markers.
2. **No unnecessary files** - Don't create summary files, plan files, audit files, or temp docs.
3. **Task is not done until tests pass** - Every feature/fix must have quality tests.
4. **Create PRs for non-trivial changes** - No direct pushes to main.
5. **Always run git hooks** - Never bypass pre-commit or pre-push hooks.
6. **Use single dash for em-dashes** - In prose, use ` - ` (single dash with spaces), never ` -- `.
7. **Report script failures before manual fallback** - Never silently bypass broken tooling.
8. **Token efficiency** - Save tokens over decorations.

## Model Selection

| Model | When to Use |
|-------|-------------|
| **Opus** | Complex reasoning, analysis, planning |
| **Sonnet** | Validation, pattern matching, most agents |
| **Haiku** | Mechanical execution, no judgment needed |

## Core Priorities

1. User DX (plugin users first)
2. Worry-free automation
3. Token efficiency
4. Quality output
5. Simplicity

## Cross-Plugin Dependencies

| Phase | Plugin | Agent/Skill |
|-------|--------|-------------|
| Pre-review gates | deslop | `deslop:deslop-agent` |
| Pre-review gates | (own) | `prepare-delivery:test-coverage-checker` |
| Pre-review gates | next-task | `next-task:simple-fixer` |
| Pre-review gates | (built-in) | `/simplify` skill |
| Config lint | agnix | `agnix` CLI (conditional) |
| Config lint | enhance | `/enhance` skill (conditional) |
| Review loop | (general-purpose) | 4 core + conditional reviewer agents |
| Delivery validation | (own) | `prepare-delivery:delivery-validator` |
| Docs sync | sync-docs | `sync-docs:sync-docs-agent` |
| Ship (via /gate-and-ship) | ship | `ship:ship` command |

## References

- Part of the [agentsys](https://github.com/agent-sh/agentsys) ecosystem
- https://agentskills.io
