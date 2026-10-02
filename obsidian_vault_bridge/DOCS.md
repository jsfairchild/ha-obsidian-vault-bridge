# Obsidian Vault Bridge

Keeps your Obsidian Sync vault mirrored in a private GitHub repository, so Claude can read and
edit your notes and every change, yours or Claude's, can be rolled back.

```
Phone / PC / Mac  <-- Obsidian Sync -->  this add-on  <-- git -->  private GitHub repo  <-->  Claude
```

## How it keeps your notes safe

- **Every change is a commit.** Nothing is ever force-pushed or rewritten, so any earlier
  version of any note can be restored from GitHub's history. Obsidian Sync's own version
  history still works too.
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
  card and account numbers. The first upload waits for your approval. After that, new notes
  that look like they contain secrets are flagged in the log.
- **Narrow access.** GitHub access is a deploy key that works on this one repository only and
  cannot change its settings or visibility. Your Obsidian password and vault encryption password
  are used once and then cleared from the options; only a login token is kept, inside the
  add-on's private storage.
- **You hear about problems.** Safety stops, edit conflicts and failed uploads show up in Home
  Assistant's notifications, and on your phone if you set `notify_service` (for example
  `mobile_app_your_iphone`).
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

## Rolling back

Every commit is listed on GitHub under the repo's commit history. To undo a change, ask Claude
("undo the change you made to my pet insurance note"), or open the file on GitHub, click
History, and restore the earlier version. The restored version flows back to all your devices.
