// Holds every file in .github/workflows/ to the rules a public repo needs, so a stranger's PR
// can reach nothing: only the plain pull_request trigger, every action pinned to a commit,
// a read-only token, and no ${{ … }} inside a run: step (values go through env:).
// Run with: node --test tests/*.test.js

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { workflowProblems } = require("./workflow_rules");

const WORKFLOWS = path.join(__dirname, "..", ".github", "workflows");

// A made-up workflow that keeps every rule; each test below breaks one.
const PIN = "0123456789abcdef0123456789abcdef01234567";
const GOOD = `name: Tests
on:
  pull_request:
permissions:
  contents: read
jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${PIN} # v4.0.0
        with:
          persist-credentials: false
      - env:
          BRANCH: \${{ github.head_ref }}
        run: |
          echo "$BRANCH"
`;

test("every workflow in the repo keeps every rule", () => {
  const files = fs.readdirSync(WORKFLOWS);
  assert.ok(files.length > 0, "the repo has no workflows to check");
  for (const f of files) {
    assert.deepStrictEqual(workflowProblems(fs.readFileSync(path.join(WORKFLOWS, f), "utf8")), [], f);
  }
});

test("a workflow that keeps every rule has no problems", () => {
  assert.deepStrictEqual(workflowProblems(GOOD), []);
});

test("a trigger other than pull_request is a problem", () => {
  const bad = GOOD.replace("  pull_request:", "  pull_request_target:");
  assert.match(workflowProblems(bad).join("\n"), /pull_request_target/);
});

test("an action pinned to a tag instead of a commit is a problem", () => {
  const bad = GOOD.replace(`actions/checkout@${PIN}`, "actions/checkout@v4");
  assert.match(workflowProblems(bad).join("\n"), /actions\/checkout@v4/);
});

test("a workflow with no permissions written in it is a problem", () => {
  const bad = GOOD.replace("permissions:\n  contents: read\n", "");
  assert.match(workflowProblems(bad).join("\n"), /contents: read/);
});

test("${{ … }} inside a run: block is a problem", () => {
  const bad = GOOD.replace('echo "$BRANCH"', 'echo "${{ github.head_ref }}"');
  assert.match(workflowProblems(bad).join("\n"), /github\.head_ref/);
});

test("${{ … }} on a one-line run: is a problem", () => {
  const bad = GOOD.replace("run: |\n          echo \"$BRANCH\"", 'run: echo "${{ github.head_ref }}"');
  assert.match(workflowProblems(bad).join("\n"), /github\.head_ref/);
});

test("${{ … }} inside an action's script: is a problem", () => {
  const bad = GOOD.replace("persist-credentials: false", 'script: console.log("${{ github.head_ref }}")');
  assert.match(workflowProblems(bad).join("\n"), /github\.head_ref/);
});

test("a step written in flow style is a problem, since the rules read block style only", () => {
  const bad = GOOD.replace("      - env:", "      - { uses: actions/checkout@v4 }\n      - env:");
  assert.match(workflowProblems(bad).join("\n"), /flow style/);
});

test("a workflow whose token can write is a problem", () => {
  const bad = GOOD.replace("  contents: read", "  contents: write");
  assert.match(workflowProblems(bad).join("\n"), /contents: read/);
});
