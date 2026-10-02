#!/usr/bin/env node
// Looks for changes that don't look like normal note editing before they are committed
// (local changes) or merged (changes from GitHub). Prints JSON: {"hold": [...], "warn": [...]}.
// "hold" means syncing to GitHub should pause until a person looks.
//
// Usage: anomaly_check.js staged              compare HEAD with the staged changes
//        anomaly_check.js range <old> <new>   compare two commits

const { execFileSync } = require("child_process");

const LIMITS = {
  changedFiles: 100,     // more notes than this changed in one go -> hold
  shrinkMinBytes: 500,   // only judge shrinkage on notes at least this big
  shrinkRatio: 0.5,      // note lost more than half its text
  shrinkHold: 5,         // this many shrunken notes at once -> hold
  emptiedHold: 3,
  frontmatterHold: 5,
  tasksLostHold: 20,     // tasks removed (net) across all notes -> hold
  bigFileBytes: 20 * 1024 * 1024,
};

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const show = (spec) => { try { return git("show", spec); } catch { return null; } };

const [mode, a, b] = process.argv.slice(2);
let oldRef, newSpec, nameStatus;
if (mode === "staged") {
  let hasHead = true;
  try { git("rev-parse", "--verify", "-q", "HEAD"); } catch { hasHead = false; }
  if (!hasHead) { console.log(JSON.stringify({ hold: [], warn: [] })); process.exit(0); }
  oldRef = "HEAD";
  newSpec = (p) => `:${p}`;
  nameStatus = git("diff", "--cached", "--name-status", "-M", "-z");
} else {
  oldRef = a;
  newSpec = (p) => `${b}:${p}`;
  nameStatus = git("diff", "--name-status", "-M", "-z", a, b);
}

// Parse -z name-status output: status, path [, newpath for renames]
const parts = nameStatus.split("\0").filter((x) => x !== "");
const changes = [];
for (let i = 0; i < parts.length; ) {
  const st = parts[i++];
  if (st[0] === "R" || st[0] === "C") changes.push({ st: st[0], from: parts[i++], path: parts[i++] });
  else changes.push({ st: st[0], from: parts[i], path: parts[i++] });
}

const hold = [], warn = [];
const shrunk = [], emptied = [], fmBroken = [];
let tasksRemoved = 0, tasksAdded = 0;

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const keys = (fm) => new Set(fm.split(/\r?\n/).map((l) => l.match(/^([^\s#:][^:]*):/)).filter(Boolean).map((m) => m[1].trim()));
const tasks = (t) => (t.match(/^\s*[-*+] \[.\]/gm) || []).length;

if (changes.length > LIMITS.changedFiles) {
  hold.push(`${changes.length} files changed at once (limit ${LIMITS.changedFiles})`);
}

for (const c of changes) {
  if (c.st === "D") {
    if (c.path.endsWith(".md")) tasksRemoved += tasks(show(`${oldRef}:${c.path}`) || "");
    continue;
  }
  const after = show(newSpec(c.path));
  if (after === null) continue;
  if (Buffer.byteLength(after) > LIMITS.bigFileBytes) warn.push(`Very large file: ${c.path}`);
  if (!c.path.endsWith(".md")) continue;

  if (/^(<{7}|>{7}) /m.test(after)) hold.push(`Leftover merge conflict markers in ${c.path}`);

  const before = c.st === "A" ? null : show(`${oldRef}:${c.from}`);
  tasksAdded += tasks(after);
  if (before === null) continue;
  tasksRemoved += tasks(before);

  const bLen = Buffer.byteLength(before), aLen = Buffer.byteLength(after);
  if (bLen > 0 && after.trim() === "") { emptied.push(c.path); continue; }
  else if (bLen >= LIMITS.shrinkMinBytes && aLen < bLen * LIMITS.shrinkRatio) {
    shrunk.push(`${c.path} (${bLen} -> ${aLen} bytes)`);
  }

  const fb = before.match(FM), fa = after.match(FM);
  if (fb && !fa) fmBroken.push(`${c.path}: properties block removed or broken`);
  else if (fb && fa) {
    const lost = [...keys(fb[1])].filter((k) => !keys(fa[1]).has(k));
    if (lost.length) fmBroken.push(`${c.path}: lost properties ${lost.join(", ")}`);
  }

  const bad = (s) => (s.match(/�/g) || []).length;
  if (bad(after) > bad(before)) warn.push(`Garbled characters appeared in ${c.path}`);
}

const report = (list, label, limit) => {
  if (!list.length) return;
  const msg = `${label}: ${list.slice(0, 5).join("; ")}${list.length > 5 ? ` and ${list.length - 5} more` : ""}`;
  (list.length >= limit ? hold : warn).push(msg);
};
report(emptied, "Notes emptied", LIMITS.emptiedHold);
report(shrunk, "Notes lost over half their text", LIMITS.shrinkHold);
report(fmBroken, "Property changes", LIMITS.frontmatterHold);

const netLost = tasksRemoved - tasksAdded;
if (netLost >= LIMITS.tasksLostHold) hold.push(`${netLost} tasks disappeared across the vault`);

console.log(JSON.stringify({ hold, warn }));
