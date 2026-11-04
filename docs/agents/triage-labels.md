# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker, which is obsidian-helper's (see `issue-tracker.md`): the labels live there, not in this repo.

The rows below Matt's five are the Pack's Stage labels, which mean the same in every Adopted repo. This repo skips UI approval, so it leaves out `needs-prototype` and `needs-ui-ok`.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |
| (none)                     | `needs-grilling`     | Triaged, waiting on `/mattpocock-skills:grill-with-docs` and `/mattpocock-skills:to-spec`; triage sets it instead of `ready-for-agent`, and it stays until the Spec is in the body (see RULES.md § Workflow) |
| (none)                     | `needs-live-check`   | Live and waiting on its Live check (see the `pack:live-check` skill) |
| (none)                     | `desk-only`          | Not worked in a Remote session; set at triage alongside the role label (see the `pack:remote-sessions` skill) |
| (none)                     | `needs-desk`         | A Desk task: a step only Josh can do at the laptop is waiting on this issue |
| (none)                     | `parked`             | Saved for later. Left out of plans and offers until Josh brings it back (RULES.md § Planning) |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Pack notes for triage

The same in every Adopted repo (claude-workflow#51).

- **A bug confirmed from a log counts as verified.** An outage or a failed scheduled run can't be reproduced on demand; the log lines that show it (a run log, a CI run, a service's log), quoted on the ticket, verify it (claude-workflow#302).
- **A ticket asking for a check, hook or tool** also gets the Pack's tracker searched, beside this repo's: `gh issue list -R jsfairchild/claude-workflow --state all --search "<words>"`. ynab-cfo#273 asked for a check the Pack had already shipped in claude-workflow#244.
