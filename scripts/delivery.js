#!/usr/bin/env node
// delivery.js - branch context, result parsing, review aggregation and flow state for /prepare-delivery
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const USAGE = `usage:
  delivery.js context [--base=BRANCH]           branch, base ref, changed files, repo-intel signals as JSON
  delivery.js extract <NAME> [file]             JSON between "=== NAME ===" and "=== END_RESULT ===" (stdin if no file)
  delivery.js aggregate [file] [--strip-false-positives]
                                                merge reviewer results [{pass, findings}], enforce the false-positive contract
  delivery.js flow --json '<patch>'             merge a patch into {stateDir}/flow.json for this branch
`;

function fail(msg, code = 2) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function out(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// Same order as agent-core's lib/platform/state-dir.js.
function stateDirPath(cwd) {
  if (process.env.AI_STATE_DIR) return path.resolve(cwd, process.env.AI_STATE_DIR);
  if (process.env.OPENCODE_CONFIG || process.env.OPENCODE_CONFIG_DIR || isDir(path.join(cwd, '.opencode'))) {
    return path.join(cwd, '.opencode');
  }
  if (process.env.CODEX_HOME || isDir(path.join(cwd, '.codex'))) return path.join(cwd, '.codex');
  return path.join(cwd, '.claude');
}

// ---------------------------------------------------------------- context

function resolveBase(flag, cwd) {
  if (flag) return flag;
  const head = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
  if (head) return head.replace(/^origin\//, '');
  for (const name of ['main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`], cwd)
      || git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], cwd)) return name;
  }
  return 'main';
}

function analyzerPath() {
  const bin = path.join(os.homedir(), '.agent-sh', 'bin', process.platform === 'win32' ? 'agent-analyzer.exe' : 'agent-analyzer');
  return fs.existsSync(bin) ? bin : null;
}

function analyzer(bin, args, cwd) {
  try {
    return JSON.parse(execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }));
  } catch {
    return null;
  }
}

function repoIntel(cwd, changedFiles) {
  const mapFile = path.join(stateDirPath(cwd), 'repo-intel.json');
  if (!fs.existsSync(mapFile)) return { available: false, reason: 'no repo-intel map', mapFile };
  const bin = analyzerPath();
  if (!bin) return { available: false, reason: 'agent-analyzer not installed', mapFile };
  const q = (name, extra) => analyzer(bin, ['repo-intel', 'query', name, ...extra, '--map-file', mapFile, cwd], cwd);
  const changed = new Set(changedFiles);
  const list = v => (Array.isArray(v) ? v : []);
  return {
    available: true,
    mapFile,
    // Sorted by riskScore, highest first.
    diffRisk: changedFiles.length
      ? list(q('diff-risk', ['--files', changedFiles.join(',')])).sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))
      : [],
    testGaps: list(q('test-gaps', ['--top', '50'])).filter(g => changed.has(g.path)),
    bugspots: list(q('bugspots', ['--top', '50'])).filter(b => changed.has(b.path))
  };
}

function cmdContext(args) {
  const cwd = process.cwd();
  const flag = (args.find(a => a.startsWith('--base=')) || '').slice('--base='.length) || null;
  if (git(['rev-parse', '--is-inside-work-tree'], cwd) !== 'true') fail('not inside a git work tree', 1);
  const branch = git(['branch', '--show-current'], cwd) || null;
  const base = resolveBase(flag, cwd);
  // Prefer the remote ref: a stale local base branch makes the diff include other people's commits.
  const baseRef = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`], cwd) ? `origin/${base}`
    : git(['rev-parse', '--verify', '--quiet', `refs/heads/${base}`], cwd) ? base : null;
  const changedFiles = baseRef
    ? (git(['diff', '--name-only', '--diff-filter=d', `${baseRef}...HEAD`], cwd) || '').split('\n').filter(Boolean)
    : [];
  // Listed apart so reviewers get files that exist, and the validator still sees deleted tests.
  const deletedFiles = baseRef
    ? (git(['diff', '--name-only', '--diff-filter=D', `${baseRef}...HEAD`], cwd) || '').split('\n').filter(Boolean)
    : [];
  const dirty = (git(['status', '--porcelain'], cwd) || '').split('\n').filter(Boolean);
  const flowFile = path.join(stateDirPath(cwd), 'flow.json');
  let flow = null;
  try { flow = JSON.parse(fs.readFileSync(flowFile, 'utf8')); } catch { /* no flow */ }
  out({
    branch,
    base,
    baseRef,
    onBase: branch === base,
    changedFiles,
    deletedFiles,
    uncommitted: dirty,
    stateDir: stateDirPath(cwd),
    flow: flow ? { file: flowFile, taskId: flow.task && flow.task.id, branch: flow.git && flow.git.branch } : null,
    repoIntel: repoIntel(cwd, changedFiles)
  });
}

// ---------------------------------------------------------------- extract

// First complete JSON value starting at or after `from`, found by scanning for balanced braces
// outside strings. A lazy regex stops at the first "}" and breaks on nested objects.
function firstJson(text, from = 0) {
  for (let start = text.indexOf('{', from); start !== -1; start = text.indexOf('{', start + 1)) {
    let end = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { /* not JSON */ }
        // Resume after the failed object: an inner fragment of a malformed result is not the result.
        end = i;
        break;
      }
    }
    if (end === -1) return null;
    start = end;
  }
  return null;
}

function extractResult(text, name) {
  const open = `=== ${name} ===`;
  const start = text.lastIndexOf(open);
  if (start === -1) return null;
  const end = text.indexOf('=== END_RESULT ===', start + open.length);
  const body = end === -1 ? text.slice(start + open.length) : text.slice(start + open.length, end);
  return firstJson(body);
}

function cmdExtract(args) {
  const [name, file] = args;
  if (!name) fail(USAGE);
  const text = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  const result = extractResult(text, name);
  if (!result) fail(`no parseable ${name} block`, 1);
  out(result);
}

// ---------------------------------------------------------------- aggregate

const SEVERITY = { critical: 0, high: 1, medium: 2, low: 3 };

// The false-positive contract: a flag counts only with a non-empty reason, and more than half of
// 10+ findings flagged means a reviewer may have been steered by the code it read.
function aggregate(results, { stripFalsePositives = false } = {}) {
  const seen = new Set();
  const items = [];
  for (const r of results) {
    for (const f of (r && Array.isArray(r.findings) ? r.findings : [])) {
      const reason = !stripFalsePositives && typeof f.falsePositiveReason === 'string' ? f.falsePositiveReason.trim() : '';
      const falsePositive = !stripFalsePositives && f.falsePositive === true && reason.length > 0;
      const id = `${r.pass}:${f.file}:${f.line}:${f.description}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const severity = Object.hasOwn(SEVERITY, f.severity) ? f.severity : 'low';
      // Computed fields go last so a finding cannot relabel its own id, pass or status.
      items.push({
        ...f,
        id,
        pass: r.pass,
        severity,
        falsePositive,
        falsePositiveReason: reason || undefined,
        reasonMissing: !stripFalsePositives && f.falsePositive === true && reason.length === 0,
        status: falsePositive ? 'false-positive' : 'open'
      });
    }
  }
  items.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
  const open = items.filter(i => !i.falsePositive);
  const flagged = items.length - open.length;
  const ratio = items.length ? flagged / items.length : 0;
  const blocked = items.length >= 10 && ratio > 0.5;
  const totals = Object.fromEntries(Object.keys(SEVERITY).map(s => [s, open.filter(i => i.severity === s).length]));
  // Same open findings two iterations in a row means the fixes are not landing. Fresh reviewers
  // reword descriptions and edits shift lines, so the key is pass, file and severity only.
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(open.map(i => `${i.pass}:${i.file}:${i.severity}`).sort()))
    .digest('hex').slice(0, 16);
  return {
    items,
    totals,
    openCount: open.length,
    markedFalsePositive: flagged,
    totalFindings: items.length,
    falsePositiveRatio: Number(ratio.toFixed(3)),
    blocked,
    blockReason: blocked
      ? `reviewers marked ${flagged}/${items.length} findings (${Math.round(ratio * 100)}%) as false positive - human review required`
      : null,
    hash
  };
}

function cmdAggregate(args) {
  const strip = args.includes('--strip-false-positives');
  const file = args.find(a => !a.startsWith('--'));
  const text = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  let results;
  try { results = JSON.parse(text); } catch { fail('input is not valid JSON', 1); }
  if (!Array.isArray(results)) fail('input must be an array of {pass, findings}', 1);
  out(aggregate(results, { stripFalsePositives: strip }));
}

// ---------------------------------------------------------------- flow

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function merge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    target[k] = isPlainObject(v) && isPlainObject(target[k]) ? merge(target[k], v) : v;
  }
  return target;
}

// Writes the fields /ship reads from --state-file (git.branch, git.baseBranch, reviewResult).
// A /next-task flow owned by another branch is someone else's run and is left alone. A standalone
// flow from another branch is this script's own leftover and is replaced.
function acquireFlowLock(file) {
  const create = () => {
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return fd;
    } catch (error) {
      fs.closeSync(fd);
      fs.unlinkSync(file);
      throw error;
    }
  };
  try { return create(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.nlink !== 1) throw error;
    let owner;
    try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* interrupted metadata write */ }
    let stale = false;
    if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
      try { process.kill(owner.pid, 0); }
      catch (probeError) { stale = probeError.code === 'ESRCH'; }
    } else {
      // A process may die between exclusive creation and its metadata write.
      // Give incomplete metadata a grace period; never expire a known live PID.
      stale = Date.now() - before.mtimeMs > 60_000;
    }
    const after = fs.lstatSync(file);
    if (!stale || !after.isFile() || after.nlink !== 1 || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw error;
    fs.unlinkSync(file);
    return create(); // one bounded recovery attempt, no wait/poll loop
  }
}

function updateFlow(cwd, patch) {
  const branch = git(['branch', '--show-current'], cwd);
  let dir = stateDirPath(cwd);
  let file = path.join(dir, 'flow.json');
  fs.mkdirSync(dir, { recursive: true });
  dir = fs.realpathSync(dir);
  if (!process.env.AI_STATE_DIR) {
    const relative = path.relative(fs.realpathSync(cwd), dir);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return { written: false, file, reason: 'inferred state directory points outside the workspace' };
    }
  }
  file = path.join(dir, 'flow.json');
  const lockFile = path.join(dir, '.flow.json.lock');
  let lock;
  try { lock = acquireFlowLock(lockFile); }
  catch (error) { return { written: false, file, retryable: error.code === 'EEXIST', reason: `cannot lock flow.json (${error.code}); another writer may still be active` }; }
  try {
    let fd;
    let created = false;
    const flags = fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
    try {
      try { fd = fs.openSync(file, flags); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        fd = fs.openSync(file, flags | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
        created = true;
      }
    } catch (error) {
      return { written: false, file, reason: `cannot safely open flow.json (${error.code})` };
    }
    try {
      // Read, check ownership, and write through one descriptor. Reopening the
      // pathname after checking it can follow a replacement link to another file.
      const opened = fs.fstatSync(fd);
      const unchanged = () => {
        try {
          const current = fs.lstatSync(file);
          return current.isFile() && current.dev === opened.dev && current.ino === opened.ino && current.nlink === 1;
        } catch { return false; }
      };
      if (!opened.isFile() || opened.nlink !== 1 || !unchanged()) {
        return { written: false, file, reason: 'flow.json must be a single-link regular file' };
      }
      let flow = null;
      let original = '';
      if (!created) {
        try {
          original = fs.readFileSync(fd, 'utf8');
          flow = JSON.parse(original);
        } catch { return { written: false, file, reason: 'flow.json is not valid JSON' }; }
        const owner = flow && flow.git && flow.git.branch;
        if (owner && owner !== branch) {
          if (!(flow.task && flow.task.id === 'standalone')) {
            return { written: false, file, reason: `flow.json belongs to a /next-task run on branch ${owner}` };
          }
          flow = null;
        }
      }
      if (!flow) {
        flow = {
          task: { id: 'standalone', title: `Deliver ${branch}`, source: 'manual' },
          policy: { stoppingPoint: 'merged' },
          status: 'in_progress',
          createdAt: new Date().toISOString()
        };
      }
      merge(flow, patch);
      flow.git = merge(flow.git || {}, { branch });
      flow.lastUpdate = new Date().toISOString();
      if (!unchanged()) return { written: false, file, reason: 'flow.json changed during the update' };
      const currentSize = fs.fstatSync(fd).size;
      if (currentSize !== Buffer.byteLength(original)) return { written: false, file, reason: 'flow.json contents changed during the update' };
      const current = Buffer.alloc(currentSize);
      const read = fs.readSync(fd, current, 0, currentSize, 0);
      if (read !== currentSize || current.toString('utf8') !== original) return { written: false, file, reason: 'flow.json contents changed during the update' };
      const data = Buffer.from(`${JSON.stringify(flow, null, 2)}\n`, 'utf8');
      const written = fs.writeSync(fd, data, 0, data.length, 0);
      if (written !== data.length) throw new Error('incomplete flow.json write');
      fs.ftruncateSync(fd, data.length);
      return { written: true, file };
    } finally {
      fs.closeSync(fd);
    }
  } finally {
    try {
      const held = fs.fstatSync(lock);
      let current;
      try { current = fs.lstatSync(lockFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current?.isFile() && current.dev === held.dev && current.ino === held.ino && current.nlink === 1) fs.unlinkSync(lockFile);
    } finally {
      fs.closeSync(lock);
    }
  }
}

function cmdFlow(args) {
  const i = args.indexOf('--json');
  if (i === -1 || !args[i + 1]) fail(USAGE);
  let patch;
  try { patch = JSON.parse(args[i + 1]); } catch { fail('--json is not valid JSON', 1); }
  if (!isPlainObject(patch)) fail('--json must be an object', 1);
  out(updateFlow(process.cwd(), patch));
}

// ---------------------------------------------------------------- main

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'context': cmdContext(args); break;
    case 'extract': cmdExtract(args); break;
    case 'aggregate': cmdAggregate(args); break;
    case 'flow': cmdFlow(args); break;
    default: fail(USAGE);
  }
}

module.exports = { extractResult, firstJson, aggregate, updateFlow, resolveBase, stateDirPath };
