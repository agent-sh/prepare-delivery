---
name: check-test-coverage
description: "Use when validating test coverage quality for new code. Checks that tests exist, are meaningful, and actually exercise new code - not just path matching."
version: 0.1.0
argument-hint: "[--base=BRANCH]"
---

# check-test-coverage

Validate that new work has appropriate, meaningful test coverage.
Advisory only - reports coverage gaps but does NOT block the workflow.

Validates test QUALITY, not just test EXISTENCE. A test file that exists but
doesn't meaningfully exercise the new code is flagged as a gap.

## Scope

Analyze files in: `git diff --name-only origin/${BASE_BRANCH}..HEAD`

## Phase 1: Get Changed Files

```bash
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

CHANGED_SOURCE=$(git diff --name-only origin/${BASE_BRANCH}..HEAD 2>/dev/null | \
  grep -E '\.(js|ts|jsx|tsx|py|rs|go|rb|java|kt|swift|cpp|c|cs)$' | \
  grep -v -E '(test|spec|_test|Test)\.')

CHANGED_TESTS=$(git diff --name-only origin/${BASE_BRANCH}..HEAD 2>/dev/null | \
  grep -E '(test|spec|_test|Test)\.')
```

## Phase 1.5: Gather Repo Intel (If Available)

Optional - enriches coverage checks with historical risk signals.

```javascript
const { binary } = require('@agentsys/lib');
const fs = require('fs');
const path = require('path');
const { getStateDirPath } = require('@agentsys/lib/platform/state-dir');
const cwd = process.cwd();
const mapFile = path.join(getStateDirPath(cwd), 'repo-intel.json');

let repoIntel = null;

if (fs.existsSync(mapFile)) {
  repoIntel = {};
  try {
    repoIntel.testGaps = JSON.parse(binary.runAnalyzer([
      'repo-intel', 'query', 'test-gaps', '--top', '20', '--map-file', mapFile, cwd
    ]));
  } catch (e) { repoIntel.testGaps = null; }
  try {
    repoIntel.bugspots = JSON.parse(binary.runAnalyzer([
      'repo-intel', 'query', 'bugspots', '--top', '20', '--map-file', mapFile, cwd
    ]));
  } catch (e) { repoIntel.bugspots = null; }
}

const testGapSet = new Set((repoIntel?.testGaps || []).map(g => g.path));
const bugspotMap = new Map((repoIntel?.bugspots || []).map(b => [b.path, b]));
```

## Phase 2: Detect Test Conventions

```bash
# Detect test directory
for dir in tests __tests__ test spec; do
  [ -d "$dir" ] && echo "TEST_DIR=$dir" && break
done

# Detect naming convention
for pattern in "*.test.*" "*.spec.*" "test_*.*"; do
  ls **/$pattern 2>/dev/null | head -1 && echo "TEST_PATTERN=$pattern" && break
done
```

## Phase 3: Map Source to Test Files

```javascript
function findTestFile(sourceFile) {
  const basename = sourceFile.split('/').pop().replace(/\.[^.]+$/, '');
  const dir = sourceFile.split('/').slice(0, -1).join('/');
  const ext = sourceFile.split('.').pop();

  return [
    `tests/${basename}.test.${ext}`, `tests/${basename}.spec.${ext}`,
    `test/${basename}.test.${ext}`, `__tests__/${basename}.test.${ext}`,
    `${dir}/${basename}.test.${ext}`, `${dir}/${basename}.spec.${ext}`,
    `${dir}/__tests__/${basename}.test.${ext}`,
    `tests/test_${basename}.${ext}`, `test/test_${basename}.${ext}`,
    `${dir}/${basename}_test.${ext}`
  ];
}
```

## Phase 4: Check Coverage

For each changed source file, find test file and check if it was updated.

```javascript
const gaps = [];
const covered = [];

for (const sourceFile of changedSourceFiles) {
  const testCandidates = findTestFile(sourceFile);
  const existingTest = testCandidates.find(t => fileExists(t));

  if (!existingTest) {
    gaps.push({ file: sourceFile, reason: 'No test file found', candidates: testCandidates.slice(0, 3) });
    continue;
  }

  const testModified = changedTestFiles.includes(existingTest);
  if (!testModified) {
    gaps.push({ file: sourceFile, reason: 'Source modified but test file not updated', testFile: existingTest });
  } else {
    covered.push({ file: sourceFile, testFile: existingTest });
  }
}
```

## Phase 4.5: Risk-Weighted Validation

When repo-intel data is available, apply stricter checks to historically risky files.

```javascript
const riskIssues = [];
const trivialPatterns = [
  /expect\s*\(\s*true\s*\)/, /expect\s*\(\s*1\s*\)\.toBe\s*\(\s*1\s*\)/,
  /assert\s*\(\s*True\s*\)/, /\.toBeDefined\s*\(\s*\)/
];

for (const sourceFile of changedSourceFiles) {
  const inTestGaps = testGapSet.has(sourceFile);
  const bugspot = bugspotMap.get(sourceFile);
  const existingTest = findTestFile(sourceFile).find(t => fileExists(t));
  const testModified = existingTest && changedTestFiles.includes(existingTest);

  if (inTestGaps && bugspot && !testModified) {
    riskIssues.push({
      file: sourceFile, severity: 'critical', type: 'high-risk-untested',
      bugFixRate: bugspot.bugFixRate,
      message: `${sourceFile} has ${(bugspot.bugFixRate * 100).toFixed(0)}% bug-fix rate AND no co-changing test - coverage required`
    });
  }

  if (bugspot && bugspot.bugFixRate > 0.3 && testModified && existingTest) {
    const testContent = await readFile(existingTest);
    if (trivialPatterns.some(p => p.test(testContent))) {
      riskIssues.push({
        file: sourceFile, severity: 'warning', type: 'weak-test-for-risky-file',
        bugFixRate: bugspot.bugFixRate, testFile: existingTest,
        message: `${sourceFile} has ${(bugspot.bugFixRate * 100).toFixed(0)}% bug-fix rate but test only has trivial assertions`
      });
    }
  }
}
```

## Phase 5: Analyze New Exports

```javascript
async function findNewExports(file) {
  const diff = await run('git', ['diff', `origin/${BASE_BRANCH}..HEAD`, '--', file]);
  const newExports = [];
  const patterns = [
    /^\+\s*export\s+(function|const|class|async function)\s+(\w+)/gm,
    /^\+\s*export\s+default\s+(function|class)\s*(\w*)/gm,
    /^\+\s*module\.exports\s*=\s*\{([^}]+)\}/gm,
    /^\+\s*def\s+(\w+)\(/gm,
    /^\+\s*pub\s+fn\s+(\w+)/gm,
    /^\+\s*func\s+(\w+)/gm
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(diff)) !== null) {
      newExports.push(match[2] || match[1]);
    }
  }
  return newExports;
}
```

## Phase 6: Validate Test Quality

Verify tests actually exercise the new code.

```javascript
async function validateTestQuality(sourceFile, testFile, newExports) {
  const testContent = await readFile(testFile);
  const issues = [];

  // Check new exports are tested
  for (const exportName of newExports) {
    if (!testContent.match(new RegExp(exportName, 'g'))) {
      issues.push({ type: 'untested-export', export: exportName,
        message: `New export '${exportName}' not referenced in test file` });
    }
  }

  // Check for trivial assertions
  if (trivialPatterns.some(p => p.test(testContent))) {
    issues.push({ type: 'trivial-assertion',
      message: 'Test contains trivial assertions that do not validate behavior' });
  }

  // Check test structure
  if (!/describe\s*\(/.test(testContent) && !/it\s*\(/.test(testContent)) {
    issues.push({ type: 'no-test-structure', message: 'Test file lacks describe/it blocks' });
  }

  // Check edge case coverage
  const edgeCasePatterns = ['null', 'undefined', 'empty', 'error', 'invalid', 'boundary'];
  if (!edgeCasePatterns.some(p => testContent.toLowerCase().includes(p)) && newExports.length > 0) {
    issues.push({ type: 'missing-edge-cases', message: 'Tests may lack edge case coverage', severity: 'warning' });
  }

  // Check source import
  const sourceBasename = sourceFile.split('/').pop().replace(/\.[^.]+$/, '');
  const importPatterns = [
    new RegExp(`from\\s+['"][^'"]*${sourceBasename}['"]`),
    new RegExp(`require\\s*\\(\\s*['"][^'"]*${sourceBasename}['"]`)
  ];
  if (!importPatterns.some(p => p.test(testContent))) {
    issues.push({ type: 'no-source-import', message: `Test does not import '${sourceBasename}'`, severity: 'critical' });
  }

  return {
    testFile, sourceFile,
    quality: issues.length === 0 ? 'good' : issues.some(i => i.severity === 'critical') ? 'poor' : 'needs-improvement',
    issues
  };
}
```

## Phase 7: Analyze Test Depth

```javascript
async function analyzeTestDepth(sourceFile, testFile, diff) {
  const analysis = { sourceComplexity: 'unknown', testCoverage: 'unknown', suggestions: [] };

  const branchPatterns = [/^\+.*if\s*\(/gm, /^\+.*else\s*\{/gm, /^\+.*\?\s*.*:/gm,
    /^\+.*switch\s*\(/gm, /^\+.*case\s+/gm, /^\+.*catch\s*\(/gm];
  const newBranches = branchPatterns.flatMap(p => diff.match(p) || []);

  if (newBranches.length > 3) {
    analysis.sourceComplexity = 'high';
    analysis.suggestions.push('New code has multiple branches - ensure each path is tested');
  }

  if (/^\+.*async\s+|^\+.*await\s+/m.test(diff)) {
    const testContent = await readFile(testFile);
    if (!/\.rejects|\.resolves|async.*expect|try.*catch.*expect/i.test(testContent)) {
      analysis.suggestions.push('New async code detected - add tests for promise rejection scenarios');
    }
  }

  return analysis;
}
```

## Output Format

Return structured JSON between markers:

```
=== TEST_COVERAGE_RESULT ===
{
  "scope": "new-work-only",
  "coverage": { "filesAnalyzed": 5, "filesWithTests": 3, "filesMissingTests": 2, "coveragePercent": 60 },
  "gaps": [...],
  "qualityIssues": [...],
  "covered": [...],
  "riskIssues": [...],
  "summary": { "status": "...", "recommendation": "...", "riskSummary": "..." }
}
=== END_RESULT ===
```

## Behavior

- Advisory only - does NOT block workflow
- Reports coverage gaps to review loop for context
- Works fully without repo-intel - risk checks are additive

## Constraints

- Do NOT modify files - only report findings
- Do NOT spawn subagents - return data for orchestrator
- Do NOT block workflow on missing tests
