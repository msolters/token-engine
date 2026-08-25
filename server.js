#!/usr/bin/env node
/**
 * token-engine — turns Claude Code token usage into engine throttle.
 *
 * Zero dependencies. It tails the JSONL session transcripts that Claude Code
 * writes under ~/.claude/projects/<project>/<session-id>.jsonl, extracts the
 * per-message `usage` blocks, and streams token bursts to the browser over
 * Server-Sent Events. The browser (index.html) does the actual engine sound.
 *
 * Usage:
 *   node server.js            # then open http://localhost:4321
 *   PORT=5000 node server.js
 *   CLAUDE_PROJECTS=/custom/path node server.js
 *
 * Note: the transcript format is internal to Claude Code and can change
 * between versions. If parsing breaks after an update, the engine just idles.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 4321;
const PROJECTS_DIR =
  process.env.CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects');

const SCAN_MS = 400;          // how often we look for appended bytes
const EMIT_MS = 250;          // how often we push an SSE tick to clients
const ACTIVE_WINDOW_MS = 10 * 60 * 1000; // only tail files touched recently

// ---------------------------------------------------------------------------
// Transcript tailing
// ---------------------------------------------------------------------------

/** per-file state: { offset, partial } — we start at EOF so history doesn't rev */
const files = new Map();
/** per-request max token count seen, so streamed usage updates count as deltas */
const perRequest = new Map();

let pendingTokens = 0; // tokens accumulated since last SSE emit
let totalTokens = 0;   // odometer since server start
let lastActivity = 0;

function listJsonlFiles() {
  const out = [];
  let projects;
  try {
    projects = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return out; // no ~/.claude/projects — engine will idle, UI shows demo mode
  }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(PROJECTS_DIR, p.name);
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.endsWith('.jsonl')) out.push(path.join(dir, name));
    }
  }
  return out;
}

function usageTokens(usage) {
  // Output + fresh input + cache writes = "work being done".
  // Cache *reads* are excluded: they're huge and cheap, and would peg the
  // throttle at 100% on every turn of a long session.
  return (
    (usage.output_tokens || 0) +
    (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0)
  );
}

function ingestLine(line) {
  if (!line) return;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return;
  }
  const usage = obj && obj.message && obj.message.usage;
  if (!usage) return;

  const tokens = usageTokens(usage);
  const key = obj.requestId || obj.uuid;

  let delta = tokens;
  if (key) {
    // Claude Code streams: the same request can log usage several times with
    // growing counts. Only credit the increase.
    const prev = perRequest.get(key) || 0;
    delta = Math.max(0, tokens - prev);
    perRequest.set(key, Math.max(prev, tokens));
    if (perRequest.size > 5000) {
      // crude cap so a very long-running server doesn't grow unbounded
      const firstKey = perRequest.keys().next().value;
      perRequest.delete(firstKey);
    }
  }
  if (delta > 0) {
    pendingTokens += delta;
    totalTokens += delta;
    lastActivity = Date.now();
  }
}

function scan() {
  const now = Date.now();
  for (const file of listJsonlFiles()) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }

    let state = files.get(file);
    if (!state) {
      // First sighting. Pre-existing sessions start at EOF so history doesn't
      // redline the engine on startup — but a file *born* while we're watching
      // (mtime within the last few seconds) counts from byte 0.
      const bornNow = now - stat.mtimeMs < 5000 && stat.size < 256 * 1024;
      state = { offset: bornNow ? 0 : stat.size, partial: '' };
      files.set(file, state);
      if (!bornNow) continue;
    }

    if (now - stat.mtimeMs > ACTIVE_WINDOW_MS) continue; // dormant session
    if (stat.size < state.offset) {
      state.offset = 0; // file was truncated/rotated
      state.partial = '';
    }
    if (stat.size === state.offset) continue;

    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const len = stat.size - state.offset;
      const buf = Buffer.alloc(Math.min(len, 4 * 1024 * 1024));
      const read = fs.readSync(fd, buf, 0, buf.length, state.offset);
      state.offset += read;
      const chunk = state.partial + buf.toString('utf8', 0, read);
      const lines = chunk.split('\n');
      state.partial = lines.pop() || '';
      for (const line of lines) ingestLine(line.trim());
    } catch {
      /* file vanished mid-read; try again next tick */
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    }
  }
}

setInterval(scan, SCAN_MS);

// ---------------------------------------------------------------------------
// HTTP + SSE
// ---------------------------------------------------------------------------

const clients = new Set();

setInterval(() => {
  const payload = JSON.stringify({
    burst: pendingTokens,               // tokens since last tick
    total: totalTokens,                 // odometer
    idleMs: Date.now() - (lastActivity || Date.now()),
    watching: fs.existsSync(PROJECTS_DIR),
  });
  pendingTokens = 0;
  for (const res of clients) res.write(`data: ${payload}\n\n`);
}, EMIT_MS);

const server = http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('index.html not found next to server.js');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`token-engine running → http://localhost:${PORT}`);
  console.log(`watching: ${PROJECTS_DIR}`);
  if (!fs.existsSync(PROJECTS_DIR)) {
    console.log('  (directory not found — engine will idle; use demo throttle in the UI)');
  }
});
