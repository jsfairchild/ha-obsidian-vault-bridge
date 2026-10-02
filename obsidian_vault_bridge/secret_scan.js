#!/usr/bin/env node
// Looks for things that resemble credentials or account numbers in vault files.
// Prints file:line and a masked preview. Always exits 0: it informs, it never edits.
//
// Usage: secret_scan.js <vault> [--stdin] [--quiet-if-clean]
//   --stdin            read relative file paths to scan from stdin (default: whole vault)
//   --quiet-if-clean   print nothing when there are no findings

const fs = require("fs");
const path = require("path");

const [vault, ...flags] = process.argv.slice(2);
const fromStdin = flags.includes("--stdin");
const quietIfClean = flags.includes("--quiet-if-clean");

const TEXT_EXT = new Set([".md", ".txt", ".json", ".canvas", ".csv", ".yaml", ".yml", ".js", ".css", ".html", ".base"]);
const SKIP_DIRS = new Set([".git", ".trash", "node_modules"]);
const MAX_BYTES = 2 * 1024 * 1024;

const RULES = [
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["API secret key", /\b(sk|rk)[-_](live|test|proj|ant)[-_][A-Za-z0-9_-]{16,}/],
  ["Generic API key", /\bsk-[A-Za-z0-9_-]{24,}/],
  ["Password or secret", /\b(password|passwd|passcode|pwd|pin|secret|api[ _-]?key|access[ _-]?token|auth[ _-]?token)\b\s*(::|[:=])\s*\S{4,}/i],
  ["US Social Security number", /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/],
  ["Account or routing number", /\b(account|acct|routing|aba|iban)\b[^\n\d]{0,20}\d[\d -]{5,}\d/i],
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

function scanFile(rel, findings) {
  if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) return;
  const abs = path.join(vault, rel);
  let text;
  try {
    if (fs.statSync(abs).size > MAX_BYTES) return;
    text = fs.readFileSync(abs, "utf8");
  } catch { return; }
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [label, re] of RULES) {
      const m = line.match(re);
      if (m) findings.push(`${rel}:${i + 1}  ${label}  (${mask(m[0])})`);
    }
    for (const c of cardNumbers(line)) findings.push(`${rel}:${i + 1}  Possible card number  (${mask(c)})`);
  });
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

if (fromStdin) {
  let buf = "";
  process.stdin.on("data", (d) => (buf += d));
  process.stdin.on("end", () => main(buf.split("\n").map((s) => s.trim()).filter(Boolean)));
} else {
  main([...walk(vault)]);
}
