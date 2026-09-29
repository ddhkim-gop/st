#!/usr/bin/env python3
"""Highlights health check: say when something is wrong, stay quiet otherwise.

Run after every game-day cycle (gameday.py) and after the last nightly run
(darwinism, 00:00). Checks, for each league:

  - the feeds: no play twice, newest play first
  - its last run: finished, pushed (st: its egress guard let it), not stale
  - the sources: ESPN returned clips for finished games, the X poller got
    through during games (and no bad handle), the YouTube pull ran
  - coverage: rostered players' touchdowns in finished games that have a clip

A macOS notification goes out only for a problem not already reported today;
every run appends a summary to ~/Library/Logs/fantasy-football/health.txt.
All local - nothing here leaves the machine.

    python3 scripts/health.py                  # full check (any league's copy)
    python3 scripts/health.py --league-json    # this league only, as JSON
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
ROOT = REPO.parent
LEAGUES = ["gameofphones", "indigo", "st", "darwinism"]
LOGS = Path.home() / "Library" / "Logs" / "fantasy-football"
RUN_LOG = {"gameofphones": LOGS / "daily-scan.log"} | {
    lg: LOGS / f"{lg}-scan.log" for lg in LEAGUES if lg != "gameofphones"}
STATE = Path.home() / "Library" / "Caches" / "fantasy-football" / "health-state.json"
LOW_COVERAGE = 0.5


def league_json() -> dict:
    """This league's feed and coverage checks (run inside the league's repo)."""
    sys.path.insert(0, str(HERE))
    import espn_fetch as E
    from build_highlights import rosters
    feeds = {p.stem: json.loads(p.read_text()).get("tweets") or []
             for p in (REPO / "assets" / "highlights").glob("*.json")}
    problems, keys = [], set()
    for team, ts in feeds.items():
        ks = [t["play_key"] for t in ts if t.get("play_key")]
        if len(ks) != len(set(ks)):
            problems.append(f"{team}: same play twice")
        order = [("1|" + t["played_at"]) if t.get("played_at") else ("0|" + t.get("date", ""))
                 for t in ts]
        if order != sorted(order, reverse=True):
            problems.append(f"{team}: feed out of play order")
        keys |= set(ks)
    teams = rosters()
    team_of = {p["name"]: E._team(p.get("team")) for r in teams.values() for p in r}
    cov = {}
    week = E.current_week()
    for w in (week, week - 1):
        tds = clipped = 0
        for gid, _ in (E.game_ids(w, 2026) if w >= 1 else []):
            s = E.game_summary(gid)
            if not s.get("final"):
                continue
            sides = set(s.get("teams") or [])
            for pl in s.get("plays") or []:
                t = pl["text"]
                if "TOUCHDOWN" not in t or "NULLIFIED" in t:
                    continue
                main = t.split("TOUCHDOWN")[0]
                if any(team_of[n] in sides and (r := E._pbp_name_re(n)) and r.search(main)
                       for n in team_of):
                    tds += 1
                    clipped += f"{gid}:{pl['id']}" in keys
        if tds:
            cov[f"week {w}"] = [clipped, tds]
    return {"problems": problems, "coverage": cov, "clips": sum(map(len, feeds.values()))}


def last_run(lines: list[str]) -> list[str]:
    starts = [i for i, l in enumerate(lines) if l.startswith("--- ")]
    return lines[starts[-1]:] if starts else []


def run_checks(lg: str) -> list[str]:
    out = []
    lines = RUN_LOG[lg].read_text(errors="replace").splitlines() if RUN_LOG[lg].exists() else []
    run = last_run(lines)
    if not run:
        return [f"{lg}: no run logged yet"]
    m = re.match(r"--- (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)", run[0])
    if m and datetime.now() - datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S") > timedelta(hours=26):
        out.append(f"{lg}: last run {m.group(1)} - nightly job didn't run")
    body = "\n".join(run)
    if "ABORT" in body:
        out.append(f"{lg}: run aborted ({next(l for l in run if 'ABORT' in l).strip()})")
    if "Traceback" in body:
        out.append(f"{lg}: a script crashed (see {RUN_LOG[lg].name})")
    if "PUSH SKIPPED" in body:
        out.append(f"{lg}: push held back by the egress guard - commit left local")
    if "committed" in body and "pushed" not in body and "PUSH SKIPPED" not in body:
        out.append(f"{lg}: committed but not pushed")
    if lg == "gameofphones":
        scans = [int(n) for n in re.findall(r"scanned (\d+) ESPN videos", body)]
        if scans and max(scans) == 0:
            out.append("ESPN returned 0 clips for this week and last")
        if "yt_fetch:" not in body:
            out.append("YouTube Shorts pull didn't run")
        if "! yt-dlp" in body:
            out.append("YouTube Shorts pull hit yt-dlp errors")
    return out


def poller_checks() -> list[str]:
    log = LOGS / "x-poll.log"
    if not log.exists():
        return []
    since = (datetime.now() - timedelta(hours=6)).strftime("%Y-%m-%d %H:%M:%S")
    recent = [l for l in log.read_text(errors="replace").splitlines() if l[:19] >= since]
    ok = sum(" posts, " in l for l in recent)
    rl = sum("429" in l for l in recent)
    out = [f"X poller: bad handle {l.split('@')[1].split(':')[0]}"
           for l in recent if "HTTP 404" in l]
    if recent and ok == 0:
        out.append(f"X poller: no successful poll in 6 h ({rl} rate-limited)")
    return out


def notify(msg: str) -> None:
    safe = msg.replace('"', "'")[:230]
    subprocess.run(["osascript", "-e",
                    f'display notification "{safe}" with title "Fantasy highlights"'],
                   capture_output=True, timeout=20)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--league-json", action="store_true")
    ap.add_argument("--source", default="manual")
    a = ap.parse_args()
    if a.league_json:
        print(json.dumps(league_json()))
        return 0

    problems, lines = [], []
    for lg in LEAGUES:
        problems += run_checks(lg)
        try:
            r = subprocess.run([sys.executable, str(ROOT / lg / "scripts" / "health.py"),
                                "--league-json"], cwd=str(ROOT / lg), capture_output=True,
                               text=True, timeout=600)
            j = json.loads(r.stdout.strip().splitlines()[-1])
        except Exception as e:
            problems.append(f"{lg}: health check failed ({type(e).__name__})")
            continue
        problems += [f"{lg}: {p}" for p in j["problems"]]
        cov = ", ".join(f"{k} {c}/{n}" for k, (c, n) in j["coverage"].items())
        lines.append(f"  {lg}: {j['clips']} clips; TDs with a clip: {cov or 'no finished games'}")
        for k, (c, n) in j["coverage"].items():
            if n >= 10 and c / n < LOW_COVERAGE:
                problems.append(f"{lg}: only {c}/{n} {k} TDs have a clip")
    problems += poller_checks()

    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    head = f"{stamp} [{a.source}] " + ("OK" if not problems else f"{len(problems)} PROBLEM(S)")
    report = "\n".join([head, *[f"  ! {p}" for p in problems], *lines])
    LOGS.mkdir(parents=True, exist_ok=True)
    with (LOGS / "health.txt").open("a") as f:
        f.write(report + "\n")
    print(report)

    if problems:
        st = json.loads(STATE.read_text()) if STATE.exists() else {}
        h = hashlib.sha1("\n".join(sorted(problems)).encode()).hexdigest()
        today = datetime.now().strftime("%Y-%m-%d")
        if st.get("alerted") != h or st.get("day") != today:
            notify(f"{problems[0]}" + (f" (+{len(problems) - 1} more)" if len(problems) > 1 else ""))
            STATE.parent.mkdir(parents=True, exist_ok=True)
            STATE.write_text(json.dumps({"alerted": h, "day": today}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
