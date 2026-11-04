// Runs real Bridge cycles (bridge.sh) against a throwaway vault, a fake GitHub (a local
// bare repo) and a state folder, then checks what reached GitHub and what was notified.
// With no Home Assistant token, notify() only logs, so the "[bridge]" lines are the
// notifications. Run with: node --test tests/*.test.js
//
// Every secret here is made up and built from parts, so this file holds none.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ADDON = path.join(__dirname, "..", "obsidian_vault_bridge");

const FAKE = {
  clientSecret: "GOC" + "SPX-" + "Fake".repeat(4) + "made_up-value",
  backupKey: ["FAKE", "TEST", "AB12", "CD34", "EF56", "GH78", "IJ90"].join("-"),
  password: "pass" + "word: " + "not-a-real-one",
  routing: "rout" + "ing number 0" + "11000015",
};

const TEST_EMAIL = "test@example.com"; // made up. secret-scan: allow

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

// The add-on's options, with made-up values for the one-time secrets.
const OPTIONS = {
  obsidian_email: TEST_EMAIL,
  obsidian_password: "made-up-" + "pass-1234", // made up. secret-scan: allow
  obsidian_mfa_code: "924" + "611",
  vault_name: "Test Vault",
  vault_e2e_password: "made-up-" + "e2e-5678", // made up. secret-scan: allow
  device_name: "Test bridge",
  github_repo: "someone/test-vault",
  github_branch: "main",
  commit_interval_minutes: 5,
  excluded_folders: ["Hidden Folder One", "Hidden Folder Two"],
  max_deletions_per_cycle: 25,
  first_push_approved: true,
  notify_service: "mobile_app_test_phone", // made up. secret-scan: allow
  approve_held_changes: false,
  // An option the Bridge doesn't know: the status must not show it either.
  some_new_token: "made-up-" + "token-0000", // made up. secret-scan: allow
};

// An installed Bridge whose first push is done: the vault has one synced Note.
function setup({ fullScanDone = true, firstPushDone = true, options = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-test-"));
  const vault = path.join(root, "vault");
  const remote = path.join(root, "remote.git");
  const state = path.join(root, "state");
  const opts = { ...OPTIONS, ...options };
  const optsFile = path.join(root, "options.json");
  fs.writeFileSync(optsFile, JSON.stringify(opts));
  fs.mkdirSync(vault);
  fs.mkdirSync(state);
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(vault, "init", "-q", "-b", "main");
  for (const [k, v] of [["user.name", "Test"], ["user.email", TEST_EMAIL], ["core.autocrlf", "false"], ["core.quotepath", "false"]]) {
    git(vault, "config", k, v);
  }
  git(vault, "remote", "add", "origin", remote);
  fs.writeFileSync(path.join(vault, "Welcome.md"), "# Welcome\n");
  git(vault, "add", "-A");
  git(vault, "commit", "-q", "-m", "start");
  git(vault, "push", "-q", "origin", "main");
  if (firstPushDone) fs.writeFileSync(path.join(state, "first_push_done"), "");
  if (fullScanDone) fs.writeFileSync(path.join(state, "full_scan_done"), "");

  const bridge = {
    root, vault, remote, state,
    // Bridge status.md as it is on GitHub's bridge-status branch, or null if there is none.
    status() {
      const r = spawnSync("git", ["--git-dir", remote, "show", "bridge-status:Bridge status.md"], { encoding: "utf8" });
      return r.status === 0 ? r.stdout : null;
    },
    // A commit made on GitHub (by Claude), as another clone would push it. Returns its id.
    pushFromGitHub(name, text) {
      const other = path.join(root, "other");
      if (!fs.existsSync(other)) git(root, "clone", "-q", remote, other);
      git(other, "pull", "-q", "origin", "main");
      fs.writeFileSync(path.join(other, name), text);
      git(other, "add", "-A");
      git(other, "-c", "user.name=Test", "-c", `user.email=${TEST_EMAIL}`, "commit", "-q", "-m", "claude");
      git(other, "push", "-q", "origin", "main");
      return git(other, "rev-parse", "HEAD").trim();
    },
    write(name, text) { fs.writeFileSync(path.join(vault, name), text); },
    remove(name) { fs.rmSync(path.join(vault, name)); },
    approveOnce() { fs.writeFileSync(path.join(state, "approve_once"), ""); },
    onGitHub(name) {
      const r = spawnSync("git", ["--git-dir", remote, "cat-file", "-e", `main:${name}`], { stdio: "ignore" });
      return r.status === 0;
    },
    cycle() {
      const r = spawnSync("bash", [path.join(ADDON, "bridge.sh").replace(/\\/g, "/")], {
        cwd: vault,
        encoding: "utf8",
        env: {
          ...process.env,
          VAULT: vault, BRANCH: "main", STATE_DIR: state, MAX_DELETIONS: "25",
          FIRST_PUSH_APPROVED: String(opts.first_push_approved),
          SCAN: path.join(ADDON, "secret_scan.js"), ANOMALY: path.join(ADDON, "anomaly_check.js"),
          STATUS: path.join(ADDON, "status.js"), OPTS: optsFile,
          SUPERVISOR_TOKEN: "",
        },
      });
      const out = r.stdout + r.stderr;
      return { out, notices: out.split(/\r?\n/).filter((l) => l.startsWith("[bridge] ")) };
    },
  };
  return bridge;
}

test("a Google OAuth client secret holds the sync and the notification names the Note and line", () => {
  const b = setup();
  b.write("Setup.md", `# Setup\n\nclient secret ${FAKE.clientSecret}\n`);
  const { out, notices } = b.cycle();
  assert.strictEqual(b.onGitHub("Setup.md"), false, out);
  const paused = notices.find((l) => l.includes("Paused"));
  assert.ok(paused, out);
  assert.match(paused, /Setup\.md:3/);
  assert.ok(!out.includes(FAKE.clientSecret), "the full secret must never be printed");
});

test("a backup key holds the sync, with only a masked preview", () => {
  const b = setup();
  b.write("Drive.md", `backup key\n${FAKE.backupKey}\n`);
  const { out, notices } = b.cycle();
  assert.strictEqual(b.onGitHub("Drive.md"), false, out);
  assert.ok(notices.some((l) => l.includes("Paused") && l.includes("Drive.md:2") && l.includes("FAK")), out);
  assert.ok(!out.includes(FAKE.backupKey), "the full key must never be printed");
});

test("a password line holds the sync", () => {
  const b = setup();
  b.write("Wifi.md", `${FAKE.password}\n`);
  const { out, notices } = b.cycle();
  assert.strictEqual(b.onGitHub("Wifi.md"), false, out);
  assert.ok(notices.some((l) => l.includes("Paused") && l.includes("Wifi.md:1")), out);
});

test("a held secret holds the whole cycle: changes from GitHub wait too", () => {
  const b = setup();
  // Claude adds a Note on GitHub.
  const other = path.join(b.root, "other");
  git(b.root, "clone", "-q", b.remote, other);
  fs.writeFileSync(path.join(other, "From Claude.md"), "hello\n");
  git(other, "add", "-A");
  git(other, "-c", "user.name=Test", "-c", `user.email=${TEST_EMAIL}`, "commit", "-q", "-m", "claude");
  git(other, "push", "-q", "origin", "main");
  b.write("Setup.md", `${FAKE.clientSecret}\n`);
  b.cycle();
  assert.strictEqual(fs.existsSync(path.join(b.vault, "From Claude.md")), false);
  // Once the secret is gone, both directions flow again.
  b.write("Setup.md", "moved to the password manager\n");
  const { out } = b.cycle();
  assert.strictEqual(b.onGitHub("Setup.md"), true, out);
  assert.strictEqual(fs.existsSync(path.join(b.vault, "From Claude.md")), true, out);
});

test("removing the secret lets the next cycle sync on its own", () => {
  const b = setup();
  b.write("Setup.md", `# Setup\n${FAKE.clientSecret}\n`);
  b.cycle();
  b.write("Setup.md", "# Setup\nsecret is in the password manager\n");
  const { out } = b.cycle();
  assert.strictEqual(b.onGitHub("Setup.md"), true, out);
});

test("a one-time approval lets one held cycle through, and the next secret is held again", () => {
  const b = setup();
  b.write("Example.md", `${FAKE.password}\n`);
  b.cycle();
  b.approveOnce();
  let r = b.cycle();
  assert.strictEqual(b.onGitHub("Example.md"), true, r.out);
  assert.ok(r.notices.some((l) => l.includes("approved by you")), r.out);
  b.write("Later.md", `${FAKE.clientSecret}\n`);
  r = b.cycle();
  assert.strictEqual(b.onGitHub("Later.md"), false, r.out);
});

test("a routing or card number notifies but still syncs", () => {
  const b = setup();
  const card = "4111 " + "1111 1111 1111"; // the well-known test card number
  b.write("Bank.md", `${FAKE.routing}\ncard ${card}\n`);
  const { out, notices } = b.cycle();
  assert.strictEqual(b.onGitHub("Bank.md"), true, out);
  assert.ok(!notices.some((l) => l.includes("Paused")), out);
  assert.ok(notices.some((l) => l.includes("Heads up") && l.includes("Bank.md:1") && l.includes("Bank.md:2")), out);
});

test("a short dashed code syncs with no notification", () => {
  const b = setup();
  b.write("Order.md", "Confirmation ABCD-1234-EF56\nPart no. X12-7781-QZ\n");
  const { out, notices } = b.cycle();
  assert.strictEqual(b.onGitHub("Order.md"), true, out);
  assert.ok(!notices.some((l) => l.includes("Paused") || l.includes("Heads up")), out);
});

test("the first cycle after the update scans the whole vault once and notifies the count", () => {
  const b = setup({ fullScanDone: false });
  // An old leak, synced before the scan knew this kind.
  b.write("Old.md", `notes\n${FAKE.clientSecret}\n`);
  git(b.vault, "add", "-A");
  git(b.vault, "commit", "-q", "-m", "old");
  git(b.vault, "push", "-q", "origin", "main");
  b.write("New.md", "a new note\n");
  let r = b.cycle();
  assert.ok(r.notices.some((l) => l.includes("Secret scan of the whole vault: 1 possible secret(s); see the add-on log")), r.out);
  assert.match(r.out, /Old\.md:2/);
  assert.ok(!r.out.includes(FAKE.clientSecret), "the full secret must never be printed");
  assert.strictEqual(b.onGitHub("New.md"), true, "the full scan holds nothing");
  r = b.cycle();
  assert.ok(!r.out.includes("Secret scan of the whole vault"), r.out);
});

test("a secret already on GitHub doesn't stop later edits of its Note", () => {
  const b = setup();
  b.write("Old.md", `${FAKE.password}\n`);
  b.approveOnce();
  b.cycle();
  b.write("Old.md", `${FAKE.password}\nmore notes\n`);
  const { out, notices } = b.cycle();
  assert.ok(!notices.some((l) => l.includes("Paused")), out);
  assert.match(git(b.root, "--git-dir", b.remote, "show", "main:Old.md"), /more notes/);
});

// --- Bridge status: Bridge status.md, the single commit on GitHub's bridge-status branch ---

// The lines under one "## <heading>" of the status.
function section(status, heading) {
  const m = status.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"));
  assert.ok(m, `no "${heading}" heading in:\n${status}`);
  return m[1].trim();
}

test("a quiet cycle writes the Bridge status with the result OK", () => {
  const b = setup();
  b.write("New.md", "a new note\n");
  const { out } = b.cycle();
  const status = b.status();
  assert.ok(status, out);
  assert.match(section(status, "Last cycle"), /^- Result: OK$/m);
  assert.strictEqual(section(status, "Held changes"), "- None");
});

test("a held secret shows in the Bridge status by its Note, line and kind, with no preview", () => {
  const b = setup();
  b.write("Drive.md", `backup key\n${FAKE.backupKey}\n`);
  const { out } = b.cycle();
  const status = b.status();
  assert.ok(status, out);
  assert.match(section(status, "Last cycle"), /^- Result: held$/m);
  assert.strictEqual(section(status, "Held changes"), "- Secret scan: Drive.md, line 2, Backup key");
});

test("an alert in the Bridge status has its preview removed", () => {
  const b = setup();
  b.write("Drive.md", `backup key\n${FAKE.backupKey}\n`);
  const { out, notices } = b.cycle();
  assert.ok(notices.some((l) => l.includes("Drive.md:2 (Backup key, FAK")), "the alert itself keeps its preview");
  const alerts = section(b.status(), "Alerts");
  assert.match(alerts, /^- \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d Paused \(your vault\): possible secret in Drive\.md:2 \(Backup key\)\. Check/m, out);
  assert.ok(!b.status().includes("FAK") && !b.status().includes("*"), b.status());
});

test("the Bridge status keeps the last 10 alerts, so the 11th drops the oldest", () => {
  const b = setup();
  // Each cycle warns about a personal number in a new Note: 11 different alerts.
  const notes = "ABCDEFGHIJK".split("").map((c) => `Bank ${c}.md`);
  for (const n of notes) {
    b.write(n, `${FAKE.routing}\n`);
    b.cycle();
  }
  const alerts = section(b.status(), "Alerts").split("\n");
  assert.strictEqual(alerts.length, 10, alerts.join("\n"));
  assert.match(alerts[0], /Bank K\.md:1/, "newest first");
  assert.match(alerts[9], /Bank B\.md:1/);
  assert.ok(!alerts.some((a) => a.includes("Bank A.md")), "the oldest is dropped");
});

test("the Bridge status is stale 3 intervals after its cycle ran", () => {
  const b = setup({ options: { commit_interval_minutes: 7 } });
  b.cycle();
  const last = section(b.status(), "Last cycle");
  const ran = Date.parse(last.match(/^- Ran: (\S+)$/m)[1]);
  const stale = Date.parse(last.match(/^- Stale after: (\S+)$/m)[1]);
  assert.ok(!Number.isNaN(ran) && !Number.isNaN(stale), last);
  assert.strictEqual(stale - ran, 21 * 60 * 1000, last);
});

test("the Bridge status shows the settings, with excluded folders only as a count", () => {
  const b = setup();
  b.cycle();
  const status = b.status();
  assert.strictEqual(section(status, "Settings"), [
    "- Version: 0.3.0",
    "- Cycle interval: 5 minutes",
    "- Excluded folders: 2",
    "- Deletion limit: 25",
    "- Phone alerts: on",
  ].join("\n"));
  assert.ok(!status.includes("Hidden Folder"), status);
});

test("the Bridge status never holds a password, token, two-factor code or phone name", () => {
  const b = setup();
  b.cycle();
  const status = b.status();
  for (const key of ["obsidian_password", "vault_e2e_password", "obsidian_mfa_code", "some_new_token", "notify_service", "obsidian_email"]) {
    assert.ok(!status.includes(OPTIONS[key]), `${key} must not be in the status:\n${status}`);
  }
});

test("the Bridge status records the commit a cycle pulled from GitHub", () => {
  const b = setup();
  b.cycle();
  assert.strictEqual(section(b.status(), "Last pull"), "- None yet");
  const id = b.pushFromGitHub("From Claude.md", "hello\n");
  const { out } = b.cycle();
  const pull = section(b.status(), "Last pull");
  assert.match(pull, new RegExp(`^- Commit: ${id}$`, "m"), out);
  assert.match(pull, /^- Merged: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/m);
  // A cycle with nothing new from GitHub keeps it.
  b.write("Later.md", "later\n");
  b.cycle();
  assert.match(section(b.status(), "Last pull"), new RegExp(`^- Commit: ${id}$`, "m"));
});

test("no Bridge status is written before the first upload is approved", () => {
  const b = setup({ firstPushDone: false, options: { first_push_approved: false } });
  b.write("New.md", "a new note\n");
  const { out } = b.cycle();
  assert.match(out, /First upload is waiting for you/);
  assert.strictEqual(b.status(), null, out);
});

test("the Bridge status stays off main and out of the vault, as one commit", () => {
  const b = setup();
  b.write("One.md", "one\n");
  b.cycle();
  b.write("Two.md", "two\n");
  b.cycle();
  assert.ok(b.status());
  assert.strictEqual(git(b.root, "--git-dir", b.remote, "rev-list", "--count", "bridge-status").trim(), "1");
  assert.strictEqual(b.onGitHub("Bridge status.md"), false);
  assert.doesNotMatch(git(b.root, "--git-dir", b.remote, "log", "--format=%s", "main"), /Bridge status/);
  assert.strictEqual(fs.existsSync(path.join(b.vault, "Bridge status.md")), false);
  assert.strictEqual(git(b.vault, "status", "--porcelain"), "");
});

test("phone alerts show as off when no notify service is set", () => {
  const b = setup({ options: { notify_service: "" } });
  b.cycle();
  assert.match(section(b.status(), "Settings"), /^- Phone alerts: off$/m);
});
