#!/usr/bin/python3
"""
Local Sleeper poller for the ST League.  [abbi]

Why this exists: GitHub throttles `schedule` events hard — auto_refresh.yml asks
for every 30 min but actually fires every ~113 min (median 98, worst 234, measured
on the sibling gameofphones repo 2026-08-04; same owner/schedule, so ST is
throttled the same way). `workflow_dispatch` is NOT throttled, so we poll Sleeper
from this Mac and dispatch the workflow only when something actually changed.

Degrades gracefully: if this Mac is asleep the GitHub cron still runs, just slowly.

Reads nothing secret — auth is whatever `gh` already has.
Exit 0 always (launchd noise is not useful); problems go to the log.

Mirrors personal/fantasy football/gameofphones/scripts/poll_sleeper_local.py.

# edited-by: abbi | 2026-08-04
"""

import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

LEAGUE_ID = "1400268451699818496"          # 2026 — keep in step with refresh_transactions.py
REPO = "ddhkim-gop/st"
WORKFLOW = "auto_refresh.yml"
GH = "/opt/homebrew/bin/gh"

STATE_DIR = os.path.expanduser("~/Library/Application Support/st")
STATE_FILE = os.path.join(STATE_DIR, "last_txn.json")


def log(msg):
    stamp = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")
    print(f"{stamp}  {msg}", flush=True)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "darwinism-poll/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def weeks_to_check():
    """Only the weeks that can plausibly hold new transactions — keeps this to a
    handful of requests instead of the full 0-18 sweep the CI script does."""
    weeks = {0, 1}
    try:
        state = get("https://api.sleeper.app/v1/state/nfl")
        for key in ("week", "display_week", "leg"):
            val = state.get(key)
            if isinstance(val, int):
                weeks.update({val, val + 1})
    except Exception as e:
        log(f"WARN: state lookup failed ({e}); falling back to weeks 0-1")
    return sorted(w for w in weeks if 0 <= w <= 18)


def newest_transaction_id():
    newest = 0
    seen = 0
    for week in weeks_to_check():
        try:
            raw = get(f"https://api.sleeper.app/v1/league/{LEAGUE_ID}/transactions/{week}") or []
        except Exception as e:
            log(f"WARN: week {week} fetch failed ({e}); skipping")
            continue
        for t in raw:
            # Match the CI script: pending claims are not final, ignore them.
            if t.get("status") not in ("complete", "failed"):
                continue
            seen += 1
            try:
                newest = max(newest, int(t["transaction_id"]))
            except (KeyError, ValueError):
                pass
    return newest, seen


def read_last():
    try:
        with open(STATE_FILE) as f:
            return int(json.load(f)["last_txn_id"])
    except Exception:
        return 0


def write_last(txn_id):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"last_txn_id": str(txn_id),
                   "updated": datetime.now(timezone.utc).isoformat()}, f)
    os.replace(tmp, STATE_FILE)      # atomic: a crash mid-write can't corrupt state


def main():
    newest, seen = newest_transaction_id()
    if not newest:
        log(f"no usable transactions found ({seen} seen); leaving state alone")
        return

    last = read_last()
    if newest <= last:
        log(f"no change (newest {newest}, {seen} txns)")
        return

    if last == 0:
        # First run: adopt current state rather than firing a pointless dispatch.
        write_last(newest)
        log(f"first run — baseline set to {newest} ({seen} txns), no dispatch")
        return

    log(f"NEW transaction {newest} (was {last}) — dispatching {WORKFLOW}")
    try:
        subprocess.run([GH, "workflow", "run", WORKFLOW, "--repo", REPO],
                       check=True, capture_output=True, text=True, timeout=60)
    except FileNotFoundError:
        log(f"ERROR: {GH} not found — state NOT advanced, will retry next poll")
        return
    except subprocess.CalledProcessError as e:
        log(f"ERROR: dispatch failed ({e.stderr.strip()}) — state NOT advanced, will retry")
        return
    except subprocess.TimeoutExpired:
        log("ERROR: dispatch timed out — state NOT advanced, will retry")
        return

    write_last(newest)               # only after a confirmed dispatch
    log("dispatched")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"ERROR: unhandled {type(e).__name__}: {e}")
    sys.exit(0)
