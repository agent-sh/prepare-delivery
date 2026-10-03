'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { extractResult, aggregate, updateFlow } = require('../scripts/delivery.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'delivery.js');

function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-test-'));
  const run = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 't@example.com');
  run('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.js'), 'module.exports = 1;\n');
  run('add', '.');
  run('commit', '-q', '-m', 'init');
  run('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'b.js'), 'module.exports = 2;\n');
  run('add', '.');
  run('commit', '-q', '-m', 'add b');
  return dir;
}

test('extract parses nested JSON between markers', () => {
  const text = [
    'some prose {not json}',
    '=== SYNC_DOCS_RESULT ===',
    '{"issues": [{"file": "README.md", "fix": {"type": "replace", "old": "a}", "new": "b"}}], "changelog": {"status": "ok"}}',
    '=== END_RESULT ==='
  ].join('\n');
  const r = extractResult(text, 'SYNC_DOCS_RESULT');
  assert.deepStrictEqual(r.changelog, { status: 'ok' });
  assert.strictEqual(r.issues[0].fix.old, 'a}');
});

test('extract uses the last block and tolerates a code fence', () => {
  const text = '=== R ===\n{"n": 1}\n=== END_RESULT ===\nlater:\n=== R ===\n```json\n{"n": {"m": 2}}\n```\n=== END_RESULT ===';
  assert.deepStrictEqual(extractResult(text, 'R'), { n: { m: 2 } });
});

test('extract does not return an inner fragment of a malformed result', () => {
  const text = '=== R ===\n{"fixes": [{"file": "a.js", "line": 1}], }\n=== END_RESULT ===';
  assert.strictEqual(extractResult(text, 'R'), null);
});

test('extract skips a malformed object and finds a later valid one', () => {
  const text = '=== R ===\n{bad: {"inner": 1}}\n{"ok": {"nested": true}}\n=== END_RESULT ===';
  assert.deepStrictEqual(extractResult(text, 'R'), { ok: { nested: true } });
});

test('extract returns null without a block', () => {
  assert.strictEqual(extractResult('no markers here {"a": 1}', 'R'), null);
});

test('aggregate ignores a false-positive flag without a reason', () => {
  const r = aggregate([{ pass: 'security', findings: [
    { file: 'a.js', line: 1, severity: 'high', description: 'x', falsePositive: true },
    { file: 'a.js', line: 2, severity: 'low', description: 'y', falsePositive: true, falsePositiveReason: 'public key' }
  ] }]);
  assert.strictEqual(r.openCount, 1);
  assert.strictEqual(r.items.find(i => i.line === 1).reasonMissing, true);
  assert.strictEqual(r.totals.high, 1);
  assert.strictEqual(r.blocked, false);
});

test('aggregate blocks when more than half of 10+ findings are dismissed', () => {
  const findings = Array.from({ length: 10 }, (_, i) => ({
    file: 'a.js', line: i, severity: 'medium', description: `d${i}`,
    falsePositive: i < 6, falsePositiveReason: i < 6 ? 'said so' : undefined
  }));
  const r = aggregate([{ pass: 'code-quality', findings }]);
  assert.strictEqual(r.blocked, true);
  assert.match(r.blockReason, /6\/10/);
  const stripped = aggregate([{ pass: 'code-quality', findings }], { stripFalsePositives: true });
  assert.strictEqual(stripped.blocked, false);
  assert.strictEqual(stripped.openCount, 10);
});

test('aggregate dedupes, sorts by severity, and a finding cannot set its own status', () => {
  const f = { file: 'a.js', line: 3, severity: 'low', description: 'same', status: 'false-positive', id: 'forged' };
  const r = aggregate([
    { pass: 'p', findings: [f, f, { file: 'b.js', line: 1, severity: 'critical', description: 'c' }] }
  ]);
  assert.strictEqual(r.totalFindings, 2);
  assert.strictEqual(r.items[0].severity, 'critical');
  assert.strictEqual(r.items[1].status, 'open');
  assert.strictEqual(r.items[1].id, 'p:a.js:3:same');
});

test('aggregate hash is stable for the same open findings', () => {
  const a = aggregate([{ pass: 'p', findings: [{ file: 'a', line: 1, description: 'x' }, { file: 'b', line: 2, description: 'y' }] }]);
  const b = aggregate([{ pass: 'p', findings: [{ file: 'b', line: 2, description: 'y' }, { file: 'a', line: 1, description: 'x' }] }]);
  assert.strictEqual(a.hash, b.hash);
});

test('aggregate hash survives reworded findings and shifted lines', () => {
  const a = aggregate([{ pass: 'security', findings: [{ file: 'a.js', line: 10, severity: 'high', description: 'SQL injection in query' }] }]);
  const b = aggregate([{ pass: 'security', findings: [{ file: 'a.js', line: 14, severity: 'high', description: 'Query built from user input' }] }]);
  assert.strictEqual(a.hash, b.hash);
  const c = aggregate([{ pass: 'security', findings: [{ file: 'a.js', line: 14, severity: 'medium', description: 'x' }] }]);
  assert.notStrictEqual(a.hash, c.hash);
});

test('context lists deleted files apart from changed files', () => {
  const dir = scratchRepo();
  try {
    execFileSync('git', ['rm', '-q', 'a.js'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'drop a'], { cwd: dir });
    const ctx = JSON.parse(execFileSync(process.execPath, [SCRIPT, 'context', '--base=main'], { cwd: dir, encoding: 'utf8' }));
    assert.deepStrictEqual(ctx.changedFiles, ['b.js']);
    assert.deepStrictEqual(ctx.deletedFiles, ['a.js']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context resolves base and lists only branch changes', () => {
  const dir = scratchRepo();
  try {
    const ctx = JSON.parse(execFileSync(process.execPath, [SCRIPT, 'context', '--base=main'], { cwd: dir, encoding: 'utf8' }));
    assert.strictEqual(ctx.branch, 'feature');
    assert.strictEqual(ctx.baseRef, 'main');
    assert.deepStrictEqual(ctx.changedFiles, ['b.js']);
    assert.strictEqual(ctx.onBase, false);
    assert.strictEqual(typeof ctx.repoIntel.available, 'boolean');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('flow writes a standalone flow and leaves another branch alone', () => {
  const dir = scratchRepo();
  const env = { ...process.env };
  delete env.AI_STATE_DIR; delete env.CODEX_HOME; delete env.OPENCODE_CONFIG; delete env.OPENCODE_CONFIG_DIR;
  try {
    const run = patch => JSON.parse(execFileSync(process.execPath, [SCRIPT, 'flow', '--json', JSON.stringify(patch)], { cwd: dir, encoding: 'utf8', env }));
    const first = run({ git: { baseBranch: 'main' }, reviewResult: { approved: true, iterations: 1 } });
    assert.strictEqual(first.written, true);
    const flow = JSON.parse(fs.readFileSync(first.file, 'utf8'));
    assert.strictEqual(flow.task.id, 'standalone');
    assert.strictEqual(flow.git.branch, 'feature');
    assert.strictEqual(flow.reviewResult.approved, true);

    // A standalone leftover from another branch is replaced, not inherited.
    flow.git.branch = 'old-branch';
    fs.writeFileSync(first.file, JSON.stringify(flow));
    const replaced = run({ reviewResult: { approved: false } });
    assert.strictEqual(replaced.written, true);
    const fresh = JSON.parse(fs.readFileSync(first.file, 'utf8'));
    assert.strictEqual(fresh.git.branch, 'feature');
    assert.strictEqual(fresh.git.baseBranch, undefined);
    assert.strictEqual(fresh.reviewResult.approved, false);

    // A /next-task flow for another branch is left alone.
    fs.writeFileSync(first.file, JSON.stringify({ task: { id: 'T-7' }, git: { branch: 'someone-else' }, reviewResult: { approved: true } }));
    const kept = run({ reviewResult: { approved: false } });
    assert.strictEqual(kept.written, false);
    assert.strictEqual(JSON.parse(fs.readFileSync(first.file, 'utf8')).reviewResult.approved, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('updateFlow ignores prototype keys', () => {
  const dir = scratchRepo();
  try {
    process.env.AI_STATE_DIR = path.join(dir, '.state');
    const r = updateFlow(dir, JSON.parse('{"__proto__": {"polluted": true}, "phase": "review-loop"}'));
    assert.strictEqual(r.written, true);
    assert.strictEqual({}.polluted, undefined);
  } finally {
    delete process.env.AI_STATE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('flow refuses a symlink or hard link to another file', () => {
  const dir = scratchRepo();
  const state = path.join(dir, '.state');
  const previous = process.env.AI_STATE_DIR;
  try {
    process.env.AI_STATE_DIR = state;
    fs.mkdirSync(state);
    const target = path.join(dir, 'other.json');
    const original = JSON.stringify({ task: { id: 'standalone' }, git: { branch: 'feature' } });
    fs.writeFileSync(target, original);
    const flow = path.join(state, 'flow.json');
    fs.symlinkSync(target, flow);
    assert.strictEqual(updateFlow(dir, { phase: 'review' }).written, false);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), original);
    fs.unlinkSync(flow);
    fs.linkSync(target, flow);
    assert.strictEqual(updateFlow(dir, { phase: 'review' }).written, false);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), original);
  } finally {
    if (previous === undefined) delete process.env.AI_STATE_DIR;
    else process.env.AI_STATE_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('flow path replacement after reading cannot overwrite another file', () => {
  const dir = scratchRepo();
  const state = path.join(dir, '.state');
  const previous = process.env.AI_STATE_DIR;
  const originalRead = fs.readFileSync;
  try {
    process.env.AI_STATE_DIR = state;
    fs.mkdirSync(state);
    const flow = path.join(state, 'flow.json');
    const target = path.join(dir, 'other.json');
    const original = 'protected fixture\n';
    fs.writeFileSync(target, original);
    fs.writeFileSync(flow, JSON.stringify({ task: { id: 'standalone' }, git: { branch: 'feature' } }));
    fs.readFileSync = function(file, ...args) {
      const result = originalRead.call(this, file, ...args);
      if (file === flow || typeof file === 'number') {
        fs.unlinkSync(flow);
        fs.symlinkSync(target, flow);
      }
      return result;
    };
    const result = updateFlow(dir, { phase: 'review' });
    fs.readFileSync = originalRead;
    assert.strictEqual(result.written, false);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), original);
  } finally {
    fs.readFileSync = originalRead;
    if (previous === undefined) delete process.env.AI_STATE_DIR;
    else process.env.AI_STATE_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('flow preserves another branch installed into the same inode after reading', () => {
  const dir = scratchRepo();
  const state = path.join(dir, '.state');
  const previous = process.env.AI_STATE_DIR;
  const originalRead = fs.readFileSync;
  try {
    process.env.AI_STATE_DIR = state;
    fs.mkdirSync(state);
    const flow = path.join(state, 'flow.json');
    const replacement = JSON.stringify({ task: { id: 'T-7' }, git: { branch: 'other-branch' }, reviewResult: { approved: false } });
    fs.writeFileSync(flow, JSON.stringify({ task: { id: 'standalone' }, git: { branch: 'feature' } }));
    fs.readFileSync = function(file, ...args) {
      const result = originalRead.call(this, file, ...args);
      if (typeof file === 'number') fs.writeFileSync(flow, replacement);
      return result;
    };
    assert.strictEqual(updateFlow(dir, { reviewResult: { approved: true } }).written, false);
    fs.readFileSync = originalRead;
    assert.strictEqual(fs.readFileSync(flow, 'utf8'), replacement);
  } finally {
    fs.readFileSync = originalRead;
    if (previous === undefined) delete process.env.AI_STATE_DIR;
    else process.env.AI_STATE_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('inferred linked state directory cannot redirect flow outside the workspace', () => {
  const dir = scratchRepo();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-external-'));
  const previous = process.env.AI_STATE_DIR;
  try {
    delete process.env.AI_STATE_DIR;
    const state = require('../scripts/delivery.js').stateDirPath(dir);
    fs.symlinkSync(external, state, 'dir');
    assert.strictEqual(updateFlow(dir, { phase: 'review' }).written, false);
    assert.deepStrictEqual(fs.readdirSync(external), []);
    process.env.AI_STATE_DIR = external;
    assert.strictEqual(updateFlow(dir, { phase: 'review' }).written, true);
  } finally {
    if (previous === undefined) delete process.env.AI_STATE_DIR;
    else process.env.AI_STATE_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});
