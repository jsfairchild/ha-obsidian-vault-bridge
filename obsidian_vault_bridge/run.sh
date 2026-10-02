#!/usr/bin/env bash
# Obsidian Vault Bridge: Obsidian Sync <-> local vault <-> private GitHub repo.
set -uo pipefail

OPTS=/data/options.json
opt() { jq -r ".$1 // empty" "$OPTS"; }
log() { echo "[setup] $*"; }

export HOME=/data/home XDG_CONFIG_HOME=/data/config
export VAULT=/data/vault STATE_DIR=/data/state
export BRANCH MAX_DELETIONS FIRST_PUSH_APPROVED NOTIFY_SERVICE
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$VAULT" "$STATE_DIR" /data/ssh
chmod 700 /data/ssh "$XDG_CONFIG_HOME"

BRANCH=$(opt github_branch)
MAX_DELETIONS=$(opt max_deletions_per_cycle)
FIRST_PUSH_APPROVED=$(opt first_push_approved)
NOTIFY_SERVICE=$(opt notify_service); NOTIFY_SERVICE=${NOTIFY_SERVICE#notify.}
REPO=$(opt github_repo)
INTERVAL=$(( $(opt commit_interval_minutes) * 60 ))
mapfile -t EXCLUDED < <(jq -r '.excluded_folders[]? | rtrimstr("/") | ltrimstr("/")' "$OPTS")

# Clears one-time secrets from the add-on options once they have been used,
# so passwords don't sit in Home Assistant's config.
clear_options() {
  [ -n "${SUPERVISOR_TOKEN:-}" ] || return 0
  local current new
  current=$(curl -fsS -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/addons/self/info | jq '.data.options') || return 0
  new=$(echo "$current" | jq "$(printf '.%s |= (if type == "boolean" then false else "" end) |' "$@") ." )
  curl -fsS -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" -H "Content-Type: application/json" \
    -d "{\"options\": $new}" http://supervisor/addons/self/options >/dev/null \
    && log "Cleared $* from the add-on options." \
    || log "Please clear $* from the add-on options yourself."
}

if [ "$(opt approve_held_changes)" = "true" ]; then
  touch "$STATE_DIR/approve_once"
  log "You approved the held changes; they will go through on the next cycle."
  clear_options approve_held_changes
fi

# --- 1. Deploy key for GitHub (scoped to the one repo, no admin rights) ---
KEY=/data/ssh/id_ed25519
if [ ! -f "$KEY" ]; then
  ssh-keygen -q -t ed25519 -N "" -C "obsidian-vault-bridge" -f "$KEY"
fi
# GitHub's published host key, pinned instead of trusting whatever answers first.
echo "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" > /data/ssh/known_hosts
export GIT_SSH_COMMAND="ssh -i $KEY -o UserKnownHostsFile=/data/ssh/known_hosts -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes"

if [ ! -f "$STATE_DIR/first_push_done" ]; then
  log "Deploy key for GitHub. Add it at github.com/$REPO > Settings > Deploy keys,"
  log "tick 'Allow write access', and nothing else:"
  echo "    $(cat "$KEY.pub")"
fi

# --- 2. Obsidian account login (token stored in /data, never in git) ---
if [ ! -s "$XDG_CONFIG_HOME/obsidian-headless/auth_token" ]; then
  EMAIL=$(opt obsidian_email); PASS=$(opt obsidian_password); MFA=$(opt obsidian_mfa_code)
  if [ -z "$EMAIL" ] || [ -z "$PASS" ]; then
    log "Not logged in to Obsidian. Fill in obsidian_email and obsidian_password, then restart."
    exit 1
  fi
  args=(--email "$EMAIL" --password "$PASS")
  [ -n "$MFA" ] && args+=(--mfa "$MFA")
  if ! ob login "${args[@]}" </dev/null; then
    log "Obsidian login failed. If you use two-factor login, enter a fresh obsidian_mfa_code and start again right away."
    exit 1
  fi
  unset PASS MFA
  clear_options obsidian_password obsidian_mfa_code
fi

# --- 3. Connect the vault to Obsidian Sync ---
if ! ob sync-status --path "$VAULT" --json >/dev/null 2>&1; then
  args=(--vault "$(opt vault_name)" --path "$VAULT" --device-name "$(opt device_name)" --json)
  E2E=$(opt vault_e2e_password)
  [ -n "$E2E" ] && args+=(--password "$E2E")
  if ! ob sync-setup "${args[@]}" </dev/null; then
    log "Could not connect to vault '$(opt vault_name)'. Check vault_name (and vault_e2e_password if it is end-to-end encrypted)."
    exit 1
  fi
  unset E2E
  clear_options vault_e2e_password
fi
# Sync settings and plugin data (Tasks, Templater, bookmarks) plus attachments so Claude sees them.
ob sync-config --path "$VAULT" --conflict-strategy merge \
  --file-types image,pdf \
  --configs app,core-plugin,core-plugin-data,community-plugin,community-plugin-data \
  --excluded-folders "$(IFS=,; echo "${EXCLUDED[*]}")" --device-name "$(opt device_name)" >/dev/null

log "Downloading the vault from Obsidian Sync..."
ob sync --path "$VAULT" </dev/null || { log "Initial sync failed."; exit 1; }

# --- 4. Git repository ---
cd "$VAULT"
if [ ! -d .git ]; then
  git init -q -b "$BRANCH"
  log "Started a new git history for the vault."
fi
git config user.name "Vault Bridge"
git config user.email "vault-bridge@localhost"
git config core.quotepath false
git remote remove origin 2>/dev/null
git remote add origin "git@github.com:$REPO.git"
{
  echo "# Managed by Obsidian Vault Bridge"
  echo ".obsidian/workspace*.json"
  echo ".obsidian/plugins/*/main.js"
  echo ".obsidian/plugins/*/styles.css"
  echo ".trash/"
  echo ".DS_Store"
  for f in "${EXCLUDED[@]}"; do echo "/$f/"; done
} > .git/info/exclude

# --- 5. Keep syncing ---
(
  while true; do
    ob sync --path "$VAULT" --continuous </dev/null
    echo "[sync] Obsidian Sync stopped (exit $?); restarting in 30s."
    sleep 30
  done
) &

log "Running. Committing to GitHub every $(opt commit_interval_minutes) minute(s)."
while true; do
  bash /app/bridge.sh
  sleep "$INTERVAL"
done
