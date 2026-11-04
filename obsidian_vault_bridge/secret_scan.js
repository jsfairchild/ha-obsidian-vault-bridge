#!/usr/bin/env node
// Looks for things that resemble credentials or account numbers in vault files.
// Prints file:line and a masked preview. It never edits a file.
//
// Usage: secret_scan.js <vault> [--stdin] [--quiet-if-clean]
//   --stdin            read relative file paths to scan from stdin (default: whole vault)
//   --quiet-if-clean   print nothing when there are no findings
//        secret_scan.js <vault> --staged
//   Scans only the lines that staged changes add (compared with HEAD), so a secret that is
//   already on GitHub doesn't stop every later edit of its note. Prints JSON
//   {"hold": [...], "warn": [...]}: credentials hold, personal numbers warn.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const [vault, ...flags] = process.argv.slice(2);
const fromStdin = flags.includes("--stdin");
const quietIfClean = flags.includes("--quiet-if-clean");
const staged = flags.includes("--staged");

const TEXT_EXT = new Set([".md", ".txt", ".json", ".canvas", ".csv", ".yaml", ".yml", ".js", ".css", ".html", ".base"]);
const SKIP_DIRS = new Set([".git", ".trash", "node_modules"]);
const MAX_BYTES = 2 * 1024 * 1024;

// A credential holds the sync; a personal number only notifies.
const CREDENTIAL = "credential", PERSONAL = "personal number";
const RULES = [
  ["Private key", CREDENTIAL, /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", CREDENTIAL, /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", CREDENTIAL, /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ["Slack token", CREDENTIAL, /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", CREDENTIAL, /\bAIza[0-9A-Za-z_-]{35}\b/],
  // These two come from the Pack's tools/check_secrets.py; change them in both places.
  ["Google OAuth client secret", CREDENTIAL, /GOCSPX-[\w-]{20,}/],
  ["Backup key", CREDENTIAL, /\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){6}\b/],
  ["API secret key", CREDENTIAL, /\b(sk|rk)[-_](live|test|proj|ant)[-_][A-Za-z0-9_-]{16,}/],
  ["Generic API key", CREDENTIAL, /\bsk-[A-Za-z0-9_-]{24,}/],
  ["Password or secret", CREDENTIAL, /\b(password|passwd|passcode|pwd|pin|secret|api[ _-]?key|access[ _-]?token|auth[ _-]?token)\b\s*(::|[:=])\s*\S{4,}/i],
  ["US Social Security number", PERSONAL, /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/],
  ["Account or routing number", PERSONAL, /\b(account|acct|routing|aba|iban)\b[^\n\d]{0,20}\d[\d -]{5,}\d/i],
];

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function cardNumbers(line) {
  const out = [];
  for (const m of line.matchAll(/\b(?:\d[ -]?){12,18}\d\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && /^[3-6]/.test(digits) && luhn(digits)) out.push(m[0]);
  }
  return out;
}

function mask(s) {
  s = s.trim();
  if (s.length <= 6) return "*".repeat(s.length);
  return s.slice(0, 3) + "*".repeat(Math.min(s.length - 3, 12));
}

function* walk(dir, rel = "") {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) yield* walk(path.join(dir, ent.name), r);
    else if (ent.isFile()) yield r;
  }
}

// Findings for one file's text: {rel, line, label, kind, preview}. Lines in `skip` are left out.
function scanText(rel, text, skip = new Set()) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (skip.has(line)) return;
    const at = { rel, line: i + 1 };
    for (const [label, kind, re] of RULES) {
      const m = line.match(re);
      if (m) out.push({ ...at, label, kind, preview: mask(m[0]) });
    }
    for (const c of cardNumbers(line)) out.push({ ...at, label: "Possible card number", kind: PERSONAL, preview: mask(c) });
  });
  return out;
}

const scannable = (rel) => TEXT_EXT.has(path.extname(rel).toLowerCase());

function scanFile(rel, findings) {
  if (!scannable(rel)) return;
  const abs = path.join(vault, rel);
  let text;
  try {
    if (fs.statSync(abs).size > MAX_BYTES) return;
    text = fs.readFileSync(abs, "utf8");
  } catch { return; }
  for (const f of scanText(rel, text)) findings.push(`${f.rel}:${f.line}  ${f.label}  (${f.preview})`);
}

function main(files) {
  const findings = [];
  for (const f of files) scanFile(f, findings);
  if (findings.length === 0) {
    if (!quietIfClean) console.log(`[secret-scan] No likely secrets found in ${files.length} file(s).`);
    return;
  }
  console.log(`[secret-scan] ${findings.length} possible secret(s) found. Review these lines:`);
  for (const f of findings) console.log(`[secret-scan]   ${f}`);
}

// Scans what `git add` staged in the vault: only lines the new version adds, so a renamed or
// edited note is judged by what changed in it.
function scanStaged() {
  const git = (...args) => execFileSync("git", args, { cwd: vault, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const show = (spec) => { try { return git("show", spec); } catch { return null; } };
  let hasHead = true;
  try { git("rev-parse", "--verify", "-q", "HEAD"); } catch { hasHead = false; }
  const parts = git("diff", "--cached", "--name-status", "-M", "-z", "--diff-filter=ACMR").split("\0").filter((x) => x !== "");
  const hold = [], warn = [];
  for (let i = 0; i < parts.length; ) {
    const st = parts[i++];
    const from = parts[i++];
    const rel = st[0] === "R" || st[0] === "C" ? parts[i++] : from;
    if (!scannable(rel)) continue;
    const after = show(`:${rel}`);
    if (after === null || Buffer.byteLength(after) > MAX_BYTES) continue;
    const before = hasHead && st[0] !== "A" ? show(`HEAD:${from}`) : null;
    const old = new Set(before === null ? [] : before.split(/\r?\n/));
    for (const f of scanText(rel, after, old)) {
      const where = `${f.rel}:${f.line} (${f.label}, ${f.preview})`;
      if (f.kind === CREDENTIAL) hold.push(`possible secret in ${where}`);
      else warn.push(`possible personal number in ${where}`);
    }
  }
  console.log(JSON.stringify({ hold, warn }));
}

if (staged) {
  scanStaged();
} else if (fromStdin) {
  let buf = "";
  process.stdin.on("data", (d) => (buf += d));
  process.stdin.on("end", () => main(buf.split("\n").map((s) => s.trim()).filter(Boolean)));
} else {
  main([...walk(vault)]);
}
