#!/usr/bin/env bash
# One git cycle between the local vault (kept current by Obsidian Sync) and GitHub.
# Commits local changes, merges in changes made on GitHub, then pushes.
# Never rewrites the vault's history and never force-pushes it, so every state stays
# recoverable. The one exception is the bridge-status branch, which holds no notes, only the
# Bridge status (status.js), replaced after every cycle.
#
# Env: VAULT, BRANCH, STATE_DIR, MAX_DELETIONS, FIRST_PUSH_APPROVED (true/false), OPTS
set -uo pipefail

log() { echo "[bridge] $*"; }
now() { date +%Y-%m-%dT%H:%M:%S%:z; }

# Tells you in Home Assistant (and on your phone, if notify_service is set) when syncing
# needs attention. The same message is only sent once until something changes. The last 10
# sent are kept for the Bridge status.
notify() {
  local msg="$1"
  log "$msg"
  local last="$STATE_DIR/last_notice" alerts="$STATE_DIR/alerts.jsonl"
  [ -f "$last" ] && [ "$(cat "$last")" = "$msg" ] && return 0
  echo "$msg" > "$last"
  jq -cn --arg t "$(now)" --arg m "$msg" '{time: $t, message: $m}' >> "$alerts"
  tail -n 10 "$alerts" > "$alerts.tmp" && mv "$alerts.tmp" "$alerts"
  [ -n "${SUPERVISOR_TOKEN:-}" ] || return 0
  local body
  body=$(jq -n --arg m "$msg" '{title: "Obsidian Vault Bridge", message: $m, notification_id: "obsidian_vault_bridge"}')
  curl -fsS -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" -H "Content-Type: application/json" \
    -d "$body" http://supervisor/core/api/services/persistent_notification/create >/dev/null 2>&1
  if [ -n "${NOTIFY_SERVICE:-}" ]; then
    curl -fsS -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" -H "Content-Type: application/json" \
      -d "$(jq -n --arg m "$msg" '{title: "Obsidian Vault Bridge", message: $m}')" \
      "http://supervisor/core/api/services/notify/${NOTIFY_SERVICE}" >/dev/null 2>&1
  fi
}

cd "$VAULT" || exit 1

ANOMALY=${ANOMALY:-/app/anomaly_check.js}
SCAN=${SCAN:-/app/secret_scan.js}
STATUS=${STATUS:-/app/status.js}

# After every cycle, once the first upload is done: rewrites the Bridge status as the one
# commit of the bridge-status branch. It's built from git objects alone, so the vault's
# files and its own branch are never touched. A failure here is only logged.
write_status() {
  local code="$1" result=failed blob tree commit
  [ -f "$STATE_DIR/first_push_done" ] || return 0
  if [ "$code" -eq 0 ]; then result=OK; elif [ -s "$HELD" ]; then result=held; fi
  if blob=$(node "$STATUS" "$result" | git hash-object -w --stdin) \
    && tree=$(printf '100644 blob %s\tBridge status.md\n' "$blob" | git mktree) \
    && commit=$(git commit-tree "$tree" -m "Bridge status") \
    && git push -q -f origin "$commit:refs/heads/bridge-status" 2>/dev/null; then
    return 0
  fi
  log "Could not write the Bridge status to GitHub; syncing goes on."
}
trap 'write_status $?' EXIT

# What this cycle held, one "<safety stop>: <what>" per line, for the Bridge status.
HELD="$STATE_DIR/cycle_held"
: > "$HELD"
held() { echo "$1: $2" >> "$HELD"; }

# Runs a safety check (the given command prints {"hold": [...], "warn": [...]}, and
# optionally "held": the holds without previews). Warnings notify; anything serious pauses
# syncing unless you have approved held changes once (approve_held_changes option).
gate() {
  local stop="$1" where="$2"; shift 2
  local out holds warns
  out=$("$@") || { log "Safety check failed to run; pausing to be safe."; return 1; }
  warns=$(echo "$out" | jq -r '.warn | join(" | ")')
  holds=$(echo "$out" | jq -r '.hold | join(" | ")')
  [ -n "$warns" ] && notify "Heads up ($where): $warns"
  [ -z "$holds" ] && return 0
  if approved_once; then
    log "Held changes approved by you; continuing ($where): $holds"
    return 0
  fi
  notify "Paused ($where): $holds. Check your vault; if this was intended, turn on approve_held_changes and restart the add-on."
  local h
  while IFS= read -r h; do held "$stop" "$h"; done < <(echo "$out" | jq -r '(.held // .hold)[]')
  return 1
}

# Approval covers one whole cycle; it is used up once that cycle finishes cleanly.
approved_once() { [ -f "$STATE_DIR/approve_once" ]; }

deletions_staged() { git diff --cached --diff-filter=D --name-only | wc -l; }

commit_local() {
  git add -A
  if git diff --cached --quiet; then
    return 0
  fi
  local dels
  dels=$(deletions_staged)
  if [ "$dels" -gt "$MAX_DELETIONS" ] && ! approved_once; then
    git reset -q
    notify "Safety stop: $dels notes disappeared from the vault at once (limit $MAX_DELETIONS). Nothing was sent to GitHub. Check your vault, then restore the notes or raise the limit."
    held "Deletion limit" "$dels notes deleted in your vault (limit $MAX_DELETIONS)"
    log "Nothing was committed or pushed. If this was intended, raise max_deletions_per_cycle."
    return 1
  fi
  gate "Anomaly check" "your vault" node "$ANOMALY" staged || { git reset -q; return 1; }
  # Credentials hold here, before anything is committed; personal numbers only notify.
  gate "Secret scan" "your vault" node "$SCAN" "$VAULT" --staged || { git reset -q; return 1; }
  local n
  n=$(git diff --cached --name-only | wc -l)
  git commit -q -m "Vault sync: $n file(s) changed" && log "Committed $n local change(s)."
  return 0
}

# Remembers the GitHub commit just merged into the vault, for the Bridge status.
pulled() {
  jq -cn --arg c "$(git rev-parse "$1")" --arg t "$(now)" '{commit: $c, time: $t}' > "$STATE_DIR/last_pull.json"
}

merge_remote() {
  git fetch -q origin "$BRANCH" 2>/dev/null || { log "Remote branch $BRANCH not found yet."; return 0; }
  local remote="origin/$BRANCH"
  if git merge-base --is-ancestor "$remote" HEAD 2>/dev/null; then
    return 0
  fi
  local base_args=()
  if ! git merge-base HEAD "$remote" >/dev/null 2>&1; then
    base_args=(--allow-unrelated-histories)
    log "First connection to an existing repo: joining histories."
  fi
  local range="HEAD...$remote"
  [ ${#base_args[@]} -gt 0 ] && range="HEAD $remote"
  local dels
  # shellcheck disable=SC2086
  dels=$(git diff --diff-filter=D --name-only $range | wc -l)
  if [ ${#base_args[@]} -eq 0 ] && [ "$dels" -gt "$MAX_DELETIONS" ] && ! approved_once; then
    notify "Safety stop: changes on GitHub would delete $dels notes (limit $MAX_DELETIONS). Nothing was changed in your vault."
    held "Deletion limit" "$dels notes deleted on GitHub (limit $MAX_DELETIONS)"
    return 1
  fi
  if [ ${#base_args[@]} -eq 0 ]; then
    gate "Anomaly check" "changes from GitHub" node "$ANOMALY" range "$(git merge-base HEAD "$remote")" "$remote" || return 1
  fi
  if git merge -q --no-edit "${base_args[@]}" -m "Merge changes from GitHub" "$remote" 2>/dev/null; then
    log "Merged changes from GitHub."
    pulled "$remote"
    return 0
  fi
  if [ -f .git/MERGE_HEAD ]; then
    # Both sides changed the same note. Keep the vault's version in place and save
    # GitHub's version next to it, so nothing is lost and syncing keeps flowing.
    local f stamp copy
    stamp=$(date +%Y-%m-%d\ %H%M)
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if git cat-file -e "$remote:$f" 2>/dev/null; then
        copy="${f%.*} (GitHub conflict $stamp).${f##*.}"
        git show "$remote:$f" > "$copy"
        git add -- "$copy"
      fi
      if git cat-file -e "HEAD:$f" 2>/dev/null; then
        git checkout -q --ours -- "$f" && git add -- "$f"
      else
        git rm -q --cached -- "$f" 2>/dev/null; rm -f -- "$f"
      fi
      notify "Edit conflict in $f: your version was kept and the other one saved as '${copy:-<deleted on GitHub>}'."
    done < <(git diff --name-only --diff-filter=U)
    git commit -q --no-edit -m "Merge changes from GitHub (conflicts kept as copies)"
    pulled "$remote"
    return 0
  fi
  log "Merge postponed (files changing during sync); will retry next cycle."
  return 1
}

push_remote() {
  local marker="$STATE_DIR/first_push_done"
  if [ ! -f "$marker" ]; then
    # Scan only what git will upload (excluded files such as plugin code never leave the vault).
    git ls-files | node "$SCAN" "$VAULT" --stdin | tee "$STATE_DIR/secret_scan.txt"
    if [ "$FIRST_PUSH_APPROVED" != "true" ]; then
      notify "First upload is waiting for you: review the secret scan in the add-on log, then turn on first_push_approved."
      log "FIRST PUSH ON HOLD: review the scan above, remove anything sensitive (or add the folder to"
      log "excluded_folders), then set first_push_approved to true and restart the add-on."
      return 1
    fi
  fi
  if [ ! -f "$marker" ] && ! git rev-parse -q --verify "refs/remotes/origin/$BRANCH" >/dev/null; then
    # Brand-new remote: earlier local snapshots may still contain secrets you have since removed
    # from your notes. Upload one fresh snapshot of the current notes instead of that history.
    if git checkout -q --orphan vault-bridge-first-upload \
      && git commit -q --allow-empty -m "Initial vault import" \
      && git branch -M "$BRANCH"; then
      git reflog expire --expire=now --all
      git gc -q --prune=now
      log "Older local snapshots were collapsed into one so secrets you removed are not uploaded."
    else
      notify "Could not prepare the first upload; nothing was sent to GitHub."
      return 1
    fi
  fi
  if git push -q origin "HEAD:refs/heads/$BRANCH"; then
    rm -f "$STATE_DIR/last_notice"
    [ -f "$marker" ] || { touch "$marker" "$STATE_DIR/full_scan_done"; log "First push complete."; }
    return 0
  fi
  notify "Could not upload to GitHub; retrying every cycle. Check the add-on log if this persists."
  return 1
}

# Once, on an install that was already syncing: scans everything already uploaded, in case an
# older note holds a kind of secret the scan learned later. It reports and holds nothing
# (those notes are on GitHub already; changing the secret is the fix). A new install skips
# it, because the first upload's own scan covers the whole vault.
full_scan_once() {
  local marker="$STATE_DIR/full_scan_done" out n
  [ -f "$marker" ] && return 0
  [ -f "$STATE_DIR/first_push_done" ] || return 0
  out=$(git ls-files | node "$SCAN" "$VAULT" --stdin) || return 0
  echo "$out"
  n=$(echo "$out" | grep -c '^\[secret-scan\]   ')
  notify "Secret scan of the whole vault: $n possible secret(s); see the add-on log"
  touch "$marker"
}

full_scan_once
commit_local || exit 1
merge_remote || exit 1
if [ -n "$(git log "origin/$BRANCH..HEAD" --oneline 2>/dev/null || git log --oneline -1)" ]; then
  push_remote || exit 1
fi
rm -f "$STATE_DIR/approve_once"
exit 0
