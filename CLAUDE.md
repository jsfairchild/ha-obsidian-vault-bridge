# ha-obsidian-vault-bridge

The Home Assistant add-on that syncs Josh's Obsidian Vault to its private GitHub repo. This repo is public, so its public text (commits, PRs, tests, `DOCS.md`) stays generic. It never names a Note, a leaked key or a device of Josh's. Tests use made-up values only (obsidian-helper#26).

## Agent skills

### Issue tracker

Issues live in obsidian-helper's GitHub Issues (`gh -R jsfairchild/obsidian-helper`); this repo's Issues are off. See `docs/agents/issue-tracker.md`.

### Triage labels

Matt's labels, the Pack's Stage labels and triage notes, all on obsidian-helper's tracker. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context, with the glossary in obsidian-helper. See `docs/agents/domain.md`.

## The Pack

Josh's general rules come from the Pack's Rules file, which every session loads; the workflow and planning words are in the Pack glossary. `GLOSSARY-MAP.md` names the glossaries. ha-obsidian-vault-bridge uses these workflow steps: triage, grilling, spec, tickets, build, release, live-check. It skips ui-approval. The sections below say how the rules apply here.

- **Tickets:** triage, grilling and Specs happen on obsidian-helper tickets. A PR here says `Part of jsfairchild/obsidian-helper#<n>`, or `Refs` on a ticket's Release PR.
- **UI approval:** skipped. The add-on has no look of its own, only its settings and phone notifications.
- **Release:** a version bump in `obsidian_vault_bridge/config.yaml`, merged to `main`. Home Assistant then offers the update; installing it builds the add-on on the Mac mini, about 5 minutes showing "Installing (0%)".
- **Live check:** Josh does it on his iPhone, after installing the update from Home Assistant, by the add-on's notifications. A Note edited on the phone reaches a notification in about 5–10 minutes (Obsidian Sync, then the next cycle): give each step that window. Confirm a hold or a sync from the Vault repo's file list (`gh api repos/<vault repo>/git/trees/main?recursive=1 --jq '.tree[].path'`), by file name only.
- **Shared checks:** none yet, and no laptop runner, since a runner on a public repo would run strangers' code. Run the tests (`node --test tests/*.test.js`, in Git Bash with `jq` installed: they run real Bridge cycles against throwaway repos) and the Pack's secret scan (`python ~/claude-workflow/tools/check_secrets.py`) by hand before each PR.
- **Outside PRs:** never check out, act on or merge a PR or comment here that Josh didn't write.
