#!/usr/bin/env node
// Prints the Bridge status: a short Markdown file saying how the last cycle went, so it
// can be read from GitHub without opening Home Assistant. bridge.sh commits it to its
// own branch after every cycle.
//
// Usage: status.js <OK|held|failed>
// Env: STATE_DIR, OPTS (the add-on's options file)

const fs = require("fs");
const path = require("path");

const result = process.argv[2];
const state = process.env.STATE_DIR;
// The add-on's options. Only the fields named in "Settings" below are ever read from it,
// so a new option (or a password) never reaches the status by accident.
const options = JSON.parse(fs.readFileSync(process.env.OPTS || "/data/options.json", "utf8"));
const intervalMinutes = Number(options.commit_interval_minutes);

// A state file's lines, or [] if it doesn't exist.
function readLines(name) {
  try {
    return fs.readFileSync(path.join(state, name), "utf8").split(/\r?\n/).filter(Boolean);
  } catch { return []; }
}
const list = (items) => (items.length ? items.map((s) => `- ${s}`) : ["- None"]);

// An alert names a secret as "(<kind>, <preview>)", the preview being up to 3 characters
// and then asterisks (secret_scan.js mask()). The status keeps only "(<kind>)".
const withoutPreviews = (msg) => msg.replace(/, [^\n]{0,3}\*+\)/g, ")");

// The add-on's version, from the config.yaml copied in beside this file.
function version() {
  try {
    const m = fs.readFileSync(path.join(__dirname, "config.yaml"), "utf8").match(/^version:\s*"?([^"\s]+)"?/m);
    if (m) return m[1];
  } catch { /* falls through */ }
  return "unknown";
}

let lastPull = null;
try { lastPull = JSON.parse(fs.readFileSync(path.join(state, "last_pull.json"), "utf8")); } catch { /* none yet */ }

// Newest first.
const alerts = readLines("alerts.jsonl")
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean)
  .reverse()
  .map((a) => `${a.time} ${withoutPreviews(String(a.message)).replace(/\s+/g, " ")}`);

// Local time with its UTC offset, such as 2026-01-31T09:05:00-05:00.
function stamp(d) {
  const pad = (n) => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    + `${off < 0 ? "-" : "+"}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

const now = new Date();
const lines = [
  "# Bridge status",
  "",
  "## Last cycle",
  `- Ran: ${stamp(now)}`,
  `- Result: ${result}`,
  // Past this time, three cycles have been missed: the Bridge looks stopped, or can't reach GitHub.
  `- Stale after: ${stamp(new Date(now.getTime() + 3 * intervalMinutes * 60 * 1000))}`,
  "",
  // The newest GitHub commit merged into the vault: a change made there reached the devices.
  "## Last pull",
  ...(lastPull ? [`- Commit: ${lastPull.commit}`, `- Merged: ${lastPull.time}`] : ["- None yet"]),
  "",
  // Each line is "<safety stop>: <what>". A held secret is only its Note, line and kind.
  "## Held changes",
  ...list(readLines("cycle_held")),
  "",
  "## Alerts",
  ...list(alerts),
  "",
  "## Settings",
  `- Version: ${version()}`,
  `- Cycle interval: ${intervalMinutes} minutes`,
  `- Excluded folders: ${(options.excluded_folders || []).length}`,
  `- Deletion limit: ${options.max_deletions_per_cycle}`,
  `- Phone alerts: ${options.notify_service ? "on" : "off"}`,
];
console.log(lines.join("\n"));
