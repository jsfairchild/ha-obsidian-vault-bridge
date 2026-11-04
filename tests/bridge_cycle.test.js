// Runs real Bridge cycles (bridge.sh) against a throwaway vault, a fake GitHub (a local
// bare repo) and a state folder, then checks what reached GitHub and what was notified.
// With no Home Assistant token, notify() only logs, so the "[bridge]" lines are the
// notifications. Run with: node --test tests/
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

// An installed Bridge whose first push is done: the vault has one synced Note.
function setup({ fullScanDone = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-test-"));
  const vault = path.join(root, "vault");
  const remote = path.join(root, "remote.git");
  const state = path.join(root, "state");
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
  fs.writeFileSync(path.join(state, "first_push_done"), "");
  if (fullScanDone) fs.writeFileSync(path.join(state, "full_scan_done"), "");

  const bridge = {
    root, vault, remote, state,
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
          VAULT: vault, BRANCH: "main", STATE_DIR: state, MAX_DELETIONS: "25", FIRST_PUSH_APPROVED: "true",
          SCAN: path.join(ADDON, "secret_scan.js"), ANOMALY: path.join(ADDON, "anomaly_check.js"),
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
