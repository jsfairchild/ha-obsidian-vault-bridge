// The rules tests/workflows.test.js holds every workflow to. Workflows are read line by line,
// by indent, so the repo needs no YAML package; flow style ({ … }) is refused, since this reader
// can't see inside it.

// A value as written after its key, without a trailing comment or surrounding quotes.
function bare(value) {
  return value.replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
}

// The lines under the key on line i: those indented deeper, up to the first one that isn't.
function childLines(lines, i) {
  const indent = lines[i].search(/\S/);
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === "" || lines[j].trim().startsWith("#")) continue;
    if (lines[j].search(/\S/) <= indent) break;
    out.push(lines[j]);
  }
  return out;
}

// The keys directly under the key on line i.
function childKeys(lines, i) {
  const kids = childLines(lines, i);
  if (!kids.length) return [];
  const indent = kids[0].search(/\S/);
  return kids.filter((l) => l.search(/\S/) === indent).map((l) => bare(l.replace(/:.*$/, "")));
}

function flowProblems(lines) {
  return lines
    .map((l, i) => [l, i])
    .filter(([l]) => !l.trim().startsWith("#") && /(^\s*-\s*\{|:\s*\{(?!\{))/.test(l))
    .map(([, i]) => `line ${i + 1} is in flow style ({ … }): write it in block style so the rules can read it`);
}

function triggerProblems(lines) {
  // YAML 1.1 reads a bare on as true, so a workflow's trigger key can appear either way.
  const i = lines.findIndex((l) => /^["']?(on|true)["']?\s*:/.test(l));
  if (i < 0) return ["it has no on: trigger"];
  const inline = bare(lines[i].replace(/^[^:]*:/, ""));
  const triggers = inline
    ? inline.replace(/^\[|\]$/g, "").split(",").map(bare)
    : childKeys(lines, i);
  return triggers
    .filter((t) => t !== "pull_request")
    .map((t) => `trigger ${t} isn't allowed: only pull_request`);
}

function pinProblems(lines) {
  return lines
    .map((l) => l.match(/^\s*(?:-\s+)?uses\s*:\s*(.*)$/))
    .filter(Boolean)
    .map((m) => bare(m[1]))
    .filter((u) => !/^[^@\s]+@[0-9a-f]{40}$/.test(u))
    .map((u) => `uses: ${u} isn't pinned to a 40-character commit`);
}

// The workflow's own permissions: contents: read, and no permissions block anywhere that writes.
function permissionProblems(lines) {
  const top = lines.findIndex((l) => /^permissions\s*:/.test(l));
  const problems = [];
  if (top < 0 || !childLines(lines, top).some((l) => /^\s*contents\s*:\s*read\s*(#.*)?$/.test(l))) {
    problems.push("it needs permissions: contents: read written at the top");
  }
  lines.forEach((l, i) => {
    if (!/^\s*permissions\s*:/.test(l)) return;
    if (/write/.test(bare(l))) problems.push(`line ${i + 1} gives the token write access`);
    childLines(lines, i)
      .filter((c) => /:\s*write\b/.test(c))
      .forEach((c) => problems.push(`"${c.trim()}" gives the token write access: keep contents: read`));
  });
  return problems;
}

// GitHub fills in ${{ … }} before a step's code runs, comment lines included, so a run: or
// script: step's whole text counts: its own line, and every deeper line under it.
function codeProblems(lines) {
  const problems = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(?:-\s+)?(?:run|script)\s*:(.*)$/);
    if (!m) return;
    const keyIndent = l.search(/(run|script)\s*:/);
    const code = [m[1]];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== "" && lines[j].search(/\S/) <= keyIndent) break;
      code.push(lines[j]);
    }
    code
      .filter((s) => s.includes("${{"))
      .forEach((s) => problems.push(`"${s.trim()}" puts \${{ … }} in a step's code: pass it through env:`));
  });
  return problems;
}

// Every problem in one workflow's text; none means it keeps every rule.
function workflowProblems(text) {
  const lines = text.split(/\r?\n/);
  return [
    ...flowProblems(lines),
    ...triggerProblems(lines),
    ...pinProblems(lines),
    ...permissionProblems(lines),
    ...codeProblems(lines),
  ];
}

module.exports = { workflowProblems };
