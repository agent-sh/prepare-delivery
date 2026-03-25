# Changelog

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
