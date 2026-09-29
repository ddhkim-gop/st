#!/bin/bash
# Nightly highlight refresh for st: seed that week's ESPN clips, rebuild the
# per-team feeds, push if anything changed.
#
# Staggered off gameofphones' 23:00 slot on purpose. ESPN's CDN answers a burst
# with a 202 and an empty body, and four repos pulling the same 16 games at once
# is exactly that burst - it cost every game on the nights of 2026-09-22..26.
set -uo pipefail          # not -e: a failed fetch/push must not kill the run
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ${HOME}/.ssh/id_ed25519"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/fantasy-football/st-scan.log"
mkdir -p "$(dirname "$LOG")"
cd "$REPO" || exit 1
echo "--- $(date '+%Y-%m-%d %H:%M:%S') st scan ---" >> "$LOG"

# One run at a time across all four leagues and the game-day refresher
# (gameday.py holds the lock itself and sets FF_LOCK_HELD for its runners).
LOCK="$HOME/Library/Caches/fantasy-football/run.lock"
if [ -z "${FF_LOCK_HELD:-}" ]; then
  mkdir -p "$(dirname "$LOCK")"
  waited=0
  until mkdir "$LOCK" 2>/dev/null; do
    age=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || date +%s) ))
    [ "$age" -gt 7200 ] && { rmdir "$LOCK" 2>/dev/null; continue; }   # crashed holder
    sleep 30; waited=$((waited + 30))
    [ "$waited" -ge 3600 ] && { echo "  ABORT: lock held for an hour" >> "$LOG"; exit 1; }
  done
  trap 'rmdir "$LOCK" 2>/dev/null' EXIT
fi

# A detached HEAD silently swallowed five nights of commits in gameofphones:
# they were committed onto no branch and never pushed. Refuse to run instead.
if ! git symbolic-ref -q HEAD >/dev/null; then
  echo "  ABORT: detached HEAD, not on a branch" >> "$LOG"; exit 1
fi

WEEK=$(curl -s --max-time 15 https://api.sleeper.app/v1/state/nfl \
       | python3 -c 'import sys,json;print(json.load(sys.stdin).get("week") or 1)' 2>/dev/null)
WEEK=${WEEK:-1}
for w in "$WEEK" "$((WEEK-1))"; do
  [ "$w" -ge 1 ] || continue
  echo "  espn_fetch --week $w" >> "$LOG"
  python3 scripts/espn_fetch.py --week "$w" --no-build >> "$LOG" 2>&1 || true
done
# X posts collected during games by the shared poller (gameofphones/scripts/
# x_poll.py): tie each to its play and file it for this league.
python3 scripts/x_ingest.py >> "$LOG" 2>&1 || true
python3 scripts/build_highlights.py scripts/highlights_pool.txt >> "$LOG" 2>&1 || true

if ! git diff --quiet scripts/highlights_reviewed.json assets/highlights 2>/dev/null; then
  git add assets/highlights scripts/highlights_reviewed.json scripts/highlights_pool.txt \
          scripts/.highlights_media_cache.json scripts/.highlights_oembed_cache.json \
          scripts/.playtimes.json \
          scripts/highlights_authors.json scripts/.highlights_video_cache.json >> "$LOG" 2>&1
  git commit -q -m "Highlights: nightly ESPN auto-seed (week $WEEK)" >> "$LOG" 2>&1 \
    && echo "  committed" >> "$LOG" 2>&1
  # Nightly push turned on by David 2026-09-28 (this league sits outside the
  # vault's GitHub allowlist by his explicit call). It runs unattended, so the
  # commit first goes through the vault's own egress guard - Skyler's
  # blocklist - and on any match (or if the guard can't run) stays local.
  if git show --format= HEAD | python3 -c '
import sys
sys.path.insert(0, "/Users/david/Desktop/Skyler/personal/skyler/app/data")
from egress_guard import guard_outbound
guard_outbound("", [{"role": "user", "content": sys.stdin.read()}])
' >> "$LOG" 2>&1; then
    git pull --rebase --autostash -q origin main >> "$LOG" 2>&1 \
      && git push -q origin main >> "$LOG" 2>&1 \
      && echo "  pushed" >> "$LOG" 2>&1
  else
    echo "  PUSH SKIPPED: egress guard matched this commit (or could not run) - left local" >> "$LOG"
  fi
else
  echo "  no highlight changes; nothing pushed" >> "$LOG"
fi
