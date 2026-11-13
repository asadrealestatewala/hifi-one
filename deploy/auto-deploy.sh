#!/usr/bin/env bash
# Hifi One automatic deploy, run by cron on the VPS (replaces .github/workflows/deploy.yml, which GitHub billing blocked).
#
#   */2 * * * * /var/www/hifi-one/deploy/auto-deploy.sh >> /var/log/hifi-one-deploy.log 2>&1
#
# Every run asks GitHub for the newest commit on main. If it is the commit already live, the script ends
# quietly. If it is new, it does the same steps the old workflow did: fetch, npm ci, migrations, role sync,
# build beside the live build, swap, restart.
#
#   ./auto-deploy.sh           normal run (what cron does)
#   ./auto-deploy.sh --force   deploy now even if nothing is new, and retry a commit that failed twice
#   ./auto-deploy.sh --status  print when it last checked, what is live, and the last result
#
# Needs a read-only GitHub deploy key on this server (see docs/DEPLOYMENT.md, "Automatic deploys").
# The whole script lives inside main() on purpose: the deploy overwrites this very file with git reset,
# and bash must not be reading a half-replaced script while it runs.

main() {
  set -uo pipefail

  APP_DIR="${APP_DIR:-/var/www/hifi-one}"
  BRANCH="${BRANCH:-main}"
  # Tried in this order: the read-only deploy key (works while the repo is private), then a plain HTTPS pull (works only
  # while the repo is public). REPO_URL overrides both.
  REPO_URLS="${REPO_URL:-git@github.com:asadrealestatewala/hifi-one.git https://github.com/asadrealestatewala/hifi-one.git}"
  DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/hifi_one_deploy}"
  STATE_DIR="${STATE_DIR:-$HOME/.hifi-autodeploy}"
  MAX_FAILURES="${MAX_FAILURES:-2}"

  mkdir -p "$STATE_DIR"
  local live_file="$STATE_DIR/live-sha" fail_file="$STATE_DIR/failed-sha" count_file="$STATE_DIR/failed-count"
  local checked_file="$STATE_DIR/last-checked" result_file="$STATE_DIR/last-result"

  ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }
  log() { echo "[$(ts)] $*"; }

  # cron starts with a tiny PATH: add the places node, npm and pm2 usually live.
  export PATH="$HOME/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:$PATH"
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
  fi

  if [ "${1:-}" = "--status" ]; then
    echo "Now:            $(ts)"
    echo "Last checked:   $(cat "$checked_file" 2>/dev/null || echo never)"
    echo "Live commit:    $(cat "$live_file" 2>/dev/null || echo unknown)"
    echo "Last result:    $(cat "$result_file" 2>/dev/null || echo none yet)"
    echo "Failed commit:  $(cat "$fail_file" 2>/dev/null || echo none) (failures: $(cat "$count_file" 2>/dev/null || echo 0))"
    return 0
  fi
  local force=0
  [ "${1:-}" = "--force" ] && force=1

  # One deploy at a time: a second run (cron firing while a long build is still going) leaves at once.
  # Two overlapping runs used to wipe node_modules under each other.
  exec 9>"$STATE_DIR/deploy.lock"
  if ! flock -n 9; then
    [ "$force" = 1 ] && log "Another deploy is running; try again when it finishes."
    return 0
  fi

  export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"

  local remote_sha="" REPO_URL="" u
  for u in $REPO_URLS; do
    remote_sha="$(GIT_TERMINAL_PROMPT=0 git ls-remote "$u" "refs/heads/$BRANCH" 2>/dev/null | cut -f1)"
    if [ -n "$remote_sha" ]; then REPO_URL="$u"; break; fi
  done
  if [ -z "$remote_sha" ]; then
    # Say it clearly, but at most once an hour, so a long outage does not fill the log.
    local warn_file="$STATE_DIR/last-warning" now last
    now="$(date +%s)"; last="$(cat "$warn_file" 2>/dev/null || echo 0)"
    if [ $((now - last)) -ge 3600 ]; then
      log "ERROR: cannot read the repository on GitHub, so nothing can deploy. If the repo is private, the server's deploy key"
      log "       ($DEPLOY_KEY.pub) must be added at GitHub: hifi-one, Settings, Deploy keys (read-only). Checked: $REPO_URLS"
      echo "$now" > "$warn_file"
    fi
    echo "$(ts) cannot read the repository (deploy key missing or repo private)" > "$result_file"
    return 1
  fi
  echo "$(ts)" > "$checked_file"

  local live_sha
  live_sha="$(cat "$live_file" 2>/dev/null || true)"
  if [ "$force" = 0 ] && [ "$remote_sha" = "$live_sha" ]; then
    return 0
  fi

  # A commit that failed MAX_FAILURES times is left alone until a newer commit arrives (or --force),
  # so a broken build does not rebuild every two minutes and starve the live site of memory.
  if [ "$force" = 0 ] && [ "$(cat "$fail_file" 2>/dev/null || true)" = "$remote_sha" ] \
     && [ "$(cat "$count_file" 2>/dev/null || echo 0)" -ge "$MAX_FAILURES" ]; then
    return 0
  fi

  log "==== Deploying ${remote_sha:0:7} (was ${live_sha:0:7}) ===="
  cd "$APP_DIR" || { log "ERROR: $APP_DIR not found"; return 1; }

  step() { log "-- $*"; }
  fail() {
    log "DEPLOY FAILED at: $1. The site keeps running the previous build."
    if [ "$(cat "$fail_file" 2>/dev/null || true)" = "$remote_sha" ]; then
      echo $(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 )) > "$count_file"
    else
      echo "$remote_sha" > "$fail_file"; echo 1 > "$count_file"
    fi
    echo "$(ts) FAILED ${remote_sha:0:7} at: $1" > "$result_file"
    return 1
  }

  step "fetch"
  git fetch "$REPO_URL" "$BRANCH" || { fail "git fetch"; return 1; }
  git reset --hard FETCH_HEAD || { fail "git reset"; return 1; }
  local new_sha
  new_sha="$(git rev-parse HEAD)"

  step "npm ci"
  npm ci --legacy-peer-deps || { fail "npm ci"; return 1; }

  # Clout Leader reads public post numbers with yt-dlp. A problem here never stops the deploy.
  mkdir -p "$HOME/.local/bin"
  if command -v yt-dlp >/dev/null 2>&1; then
    yt-dlp -U || echo "NOTE: yt-dlp self-update did not run (pip installs update with pip)"
  else
    curl -fsSL -o "$HOME/.local/bin/yt-dlp" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux && chmod +x "$HOME/.local/bin/yt-dlp" \
      || python3 -m pip install -U --user --break-system-packages yt-dlp \
      || python3 -m pip install -U --user yt-dlp \
      || echo "WARNING: yt-dlp could not be installed; Clout Leader will say so on its Settings page"
  fi

  step "database"
  npx prisma generate || { fail "prisma generate"; return 1; }
  npx prisma migrate deploy || { fail "database migration"; return 1; }
  # Registers permissions added by this release and gives them to Super Admin. Safe to repeat.
  npx tsx scripts/sync-roles.mts || { fail "role sync"; return 1; }

  # Build beside the live build, never over it, so a slow or failed build never leaves pages unstyled.
  step "build"
  rm -rf .next-build
  NEXT_DIST_DIR=.next-build SKIP_BUILD_CHECKS=1 npm run build || { fail "build"; return 1; }
  test -f .next-build/BUILD_ID || { fail "build (no BUILD_ID)"; return 1; }

  step "swap and restart"
  rm -rf .next-previous
  if [ -d .next ]; then mv .next .next-previous; fi
  mv .next-build .next
  { pm2 restart hifi-one --update-env || pm2 start npm --name hifi-one -- start; } || { fail "restart"; return 1; }
  # Clout Leader background worker (separate process so a slow platform never slows the website)
  { pm2 restart hifi-clout-worker --update-env || pm2 start npm --name hifi-clout-worker -- run clout:worker; } \
    || echo "WARNING: the Clout Leader worker did not start"
  pm2 save

  echo "$new_sha" > "$live_file"
  rm -f "$fail_file" "$count_file"
  echo "$(ts) OK ${new_sha:0:7}" > "$result_file"
  log "==== Deployed ${new_sha:0:7} ===="
  return 0
}

main "$@"
exit $?
