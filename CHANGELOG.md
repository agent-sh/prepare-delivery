# Changelog

## [0.2.0] - 2026-09-24

### Changed
- Rewrote the command, the three agents and the four skills for current models: goal, constraints with reasons, a definition of done and the output contract, instead of JavaScript for the model to act out.
- prepare-delivery-agent inherits the session model; the validator and coverage checker stay on sonnet.
- Deslop and docs fixes are applied by the pipeline itself. `next-task:simple-fixer` is no longer needed.
- The repo-intel prompt ("Generate repo-intel?") defaults to skip when AskUserQuestion is missing or the run is unattended; the review-loop escalations default to the safe choice (treat flagged findings as open, stop at the iteration limit).

### Added
- `scripts/delivery.js`: `context`, `extract`, `aggregate`, `flow`, with tests (`npm test`).

### Fixed
- Result blocks were cut out with a lazy regex (`{[\s\S]*?}`) that stops at the first `}`, so nested JSON (every real DESLOP, SYNC_DOCS and PREPARE_DELIVERY result) failed to parse. `delivery.js extract` scans balanced braces.
- The false-positive contract and the 50% cap were JavaScript in a skill, enforced only if the model re-implemented them. `delivery.js aggregate` enforces them in code.
- check-test-coverage ignored `--base` and diffed `origin/BASE..HEAD` (two dots), which counts commits that landed on the base after the branch was cut. Its base fallback (`symbolic-ref | sed || echo main`) never fired, leaving the base empty. `delivery.js context` resolves the base once and diffs `base...HEAD`.
- validate-delivery's regression check ran `git stash` / `git stash pop` around `npm test`: with committed work both runs tested the same tree, and a failed pop could strand the user's changes. It now inspects the diff for deleted or skipped tests.
- Review fixes were committed with `git add .`, which swept unrelated uncommitted files into the commit. Gates now stage only the paths they edited.
- The risk annotation read `aiRatio`, which `diff-risk` does not return.
- README install line used `claude mcp add-json`, which registers an MCP server, not a plugin.
- prepare-delivery-agent loaded its skill with `Skill(prepare-delivery)`, which resolves to the `/prepare-delivery` command and spawns the agent again. It reads the skill file now.
- delivery-validator said a SubagentStop hook starts docs sync; this plugin has no hooks. The pipeline runs docs sync itself.
- The validator's review check failed every standalone run, because the review outcome came from next-task's workflow state. The caller now passes it.

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
