# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

The Bridge's words and decisions live in the private obsidian-helper repo, beside the Vault's, so this repo has no `GLOSSARY.md` and no `docs/adr/` of its own.

## Before exploring, read these

- **`GLOSSARY-MAP.md`** at this repo's root: it names the glossaries. The Bridge's words (Secret scan, Held changes and the other safety stops) are in `~/obsidian-helper/GLOSSARY.md`.
- **`~/obsidian-helper/docs/adr/`**: read ADRs that touch the area you're about to work in. Several are about the Bridge.

When `/domain-modeling` (reached via `/grill-with-docs` and `/improve-codebase-architecture`) settles a term or a decision, it goes into obsidian-helper's glossary or ADRs, through a PR there, never into this repo.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the glossary. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
