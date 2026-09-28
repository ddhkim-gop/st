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
    && echo "  committed locally; push disabled pending David's call (Skyler/CLAUDE.md allows GitHub only for gameofphones, darwinism, indigo)" >> "$LOG" 2>&1
else
  echo "  no highlight changes; nothing pushed" >> "$LOG"
fi
