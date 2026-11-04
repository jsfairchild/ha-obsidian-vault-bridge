# Obsidian Vault Bridge

Keeps your Obsidian Sync vault mirrored in a private GitHub repository, so Claude can read and
edit your notes and every change, yours or Claude's, can be rolled back.

```
Phone / PC / Mac  <-- Obsidian Sync -->  this add-on  <-- git -->  private GitHub repo  <-->  Claude
```

## How it keeps your notes safe

- **Every change is a commit.** Your notes' history is never force-pushed or rewritten, so
  any earlier version of any note can be restored from GitHub's history. Obsidian Sync's own
  version history still works too.
- **Conflicts never lose text.** If you and Claude edit the same note between syncs, your
  version stays in place and Claude's is saved next to it as
  `Note (GitHub conflict <date>).md`.
- **Mass-deletion stop.** If more files than the safety limit vanish at once (from either side),
  syncing to GitHub pauses and the log explains why.
- **Anomaly checks.** Before every commit and every merge from GitHub, changes are checked for
  things that don't look like normal editing: many notes changed at once, notes emptied or
  losing over half their text, properties disappearing, tasks vanishing in bulk, leftover
  conflict markers or garbled text. Small oddities send a notification; big ones pause syncing
  to GitHub. If a paused batch was intended (say you reorganized folders), turn on
  `approve_held_changes` and restart the add-on; it lets that batch through once.
- **Secret scan.** Before the first upload, the whole vault is scanned for passwords, API keys,
  card and account numbers. The first upload waits for your approval. After that, every
  commit is checked first, line by line, for what it adds:
  - A **credential** (a password or secret line, a private key, an API key or token, a Google
    OAuth client secret, a backup key) pauses syncing: nothing is committed or sent to
    GitHub, and changes from GitHub wait too. The notification names the note, the line and
    the kind, with only the first three characters shown. Move the secret out of the note
    (into a password manager) and the next cycle syncs on its own. If it was a false alarm,
    turn on `approve_held_changes` and restart the add-on; it lets that one cycle through.
  - A **personal number** (Social Security, account, routing or card number) sends a
    notification, and syncing goes on.

  Lines the add-on has already committed aren't flagged again when you edit their note. When you update
  from a version before 0.2.0, the first cycle scans the whole vault once with the newest
  checks, lists what it finds in the log and notifies you of the count. It pauses nothing.
- **Narrow access.** GitHub access is a deploy key that works on this one repository only and
  cannot change its settings or visibility. Your Obsidian password and vault encryption password
  are used once and then cleared from the options; only a login token is kept, inside the
  add-on's private storage.
- **You hear about problems.** Safety stops, edit conflicts and failed uploads show up in Home
  Assistant's notifications, and on your phone if you set `notify_service` (for example
  `mobile_app_your_iphone`). <!-- a placeholder. secret-scan: allow -->
- **Backups.** The vault and its full git history live in the add-on's storage, so Home
  Assistant's normal backups include them. Point those backups at Google Drive or a NAS for an
  off-site copy.
- **Outgoing connections only.** Nothing on your home network is opened up.

## Setup

1. **Create the GitHub repo.** On github.com create a new **private**, **empty** repository
   (no README). Make sure your GitHub account uses a passkey or two-factor login.
2. **Fill in the options:** your Obsidian email and password (plus a two-factor code if you use
   one), the vault name as shown in Obsidian Sync, its encryption password if it is end-to-end
   encrypted, and `github_repo` as `yourname/reponame`. Add any folders you want kept off GitHub
   to `excluded_folders`.
3. **Start the add-on and open the Log tab.** It logs in, downloads the vault, and prints a
   deploy key starting with `ssh-ed25519`.
4. **Add the deploy key.** In the GitHub repo go to Settings > Deploy keys > Add deploy key,
   paste the key, tick **Allow write access**, and save.
5. **Review the secret scan** in the log. Remove anything sensitive from those notes (or add its
   folder to `excluded_folders`).
6. **Approve the first upload:** turn on `first_push_approved` and restart the add-on.

After that it runs on its own and commits every few minutes.

## Status file

Once the first upload is done, the add-on writes `Bridge status.md` after every cycle to a
separate `bridge-status` branch of the same repository, so you (or Claude) can check on it
from GitHub without opening Home Assistant. It lists:

- **Last cycle:** when it ran, whether it was OK, held or failed, and a "stale after" time,
  three cycles later. If that time has passed, the add-on looks stopped or can't reach GitHub.
- **Last pull:** the newest GitHub commit merged into your vault, and when. Once it's there,
  that change is on its way to your devices through Obsidian Sync.
- **Held changes:** which safety stop paused syncing, and the notes involved. A held secret is
  shown only by its note, line and kind.
- **Alerts:** the last 10 notifications, with any preview of a secret removed.
- **Settings:** the version, the cycle interval, how many folders are excluded (not their
  names), the deletion limit and whether phone alerts are on. No password, code or login is
  ever written.

The branch holds only that one file and is replaced on every cycle, so it adds nothing to your
notes' history. The add-on syncs only the `github_branch` branch, so the file never appears
in Obsidian.

## Rolling back

Every commit is listed on GitHub under the repo's commit history. To undo a change, ask Claude
("undo the change you made to my pet insurance note"), or open the file on GitHub, click
History, and restore the earlier version. The restored version flows back to all your devices.
