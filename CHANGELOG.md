# Changelog

## [0.1.2] - 2026-04-26

### Docs
- Added REVIEWER-CONTRACT marker comments and drift-sync note in CLAUDE.md - when editing the false-positive contract in orchestrate-review/SKILL.md, update the matching block in audit-project/commands/audit-project-agents.md (PR #3).

## [0.1.1] - 2026-04-26

### Security

- orchestrate-review caps false-positive ratio at 50% to prevent prompt-injected reviewers from zeroing the gate counter; requires a non-empty falsePositiveReason on every flag.

### Fixed

- 'Treat flagged findings as open' re-aggregates in place instead of restarting the loop (was discarding the strip).

## [0.1.0] - 2026-03-25

### Added
- Initial release - pre-ship quality gates plugin
- prepare-delivery-agent (sonnet) - orchestrates full pipeline via skill
- delivery-validator (sonnet) - autonomous pass/fail validation
- test-coverage-checker (sonnet) - test quality validation (advisory)
- prepare-delivery skill - 5-phase pipeline (deslop, config lint, review, validation, docs)
- check-test-coverage skill - test existence, quality, risk-weighted validation
- orchestrate-review skill - multi-pass parallel code review with iteration
- validate-delivery skill - tests, build, requirements, diff-risk checks
- /prepare-delivery command
