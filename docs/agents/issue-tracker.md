# Issue tracker: GitHub, in obsidian-helper

This repo holds only the Bridge's code. Its issues and specs live in the private repo `jsfairchild/obsidian-helper`, beside the Vault's other tickets, and this repo's own Issues are turned off. Use the `gh` CLI with `-R jsfairchild/obsidian-helper` for every issue operation: run bare, `gh` would aim at this repo.

## Conventions

- **Create an issue**: `gh issue create -R jsfairchild/obsidian-helper --title "..." --body-file <file>`.
- **Read an issue**: `gh issue view <number> -R jsfairchild/obsidian-helper --json number,title,body,labels,comments`.
- **List issues**: `gh issue list -R jsfairchild/obsidian-helper --state open --json number,title,labels` with `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue edit <parent> -R jsfairchild/obsidian-helper --add-sub-issue <child>`. Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> -R jsfairchild/obsidian-helper --body-file <file>`
- **Apply / remove labels**: `gh issue edit <number> -R jsfairchild/obsidian-helper --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> -R jsfairchild/obsidian-helper --comment "..."`

PRs are opened in this repo (`gh pr create`, no `-R`); CLAUDE.md § The Pack says how they name their ticket.

## Pull requests as a triage surface

**PRs as a request surface: no.** Outside PRs are never triaged or acted on (CLAUDE.md § The Pack).

## When a skill says "publish to the issue tracker"

Create an issue in obsidian-helper.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

As in obsidian-helper's own `docs/agents/issue-tracker.md`: the map and its child tickets live there.
