#!/usr/bin/env python3
"""
Build a player -> scoring-play timing index from nflverse play-by-play.

Gives each highlight a real game timestamp (quarter + game clock) and a
real-time sort key, so clips can show "Q1 8:34" and order as they happened.
Output: scripts/.playtimes.json (committed), consumed by build_highlights.py.

    python3 gen_playtimes.py            # current season, all weeks so far
    python3 gen_playtimes.py --week 1
"""
import argparse
import csv
import io
import json
import re
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / ".playtimes.json"
YEAR = 2026
PBP = f"https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{YEAR}.csv"


def fetch_pbp():
    req = urllib.request.Request(PBP, headers={"User-Agent": "gop-playtimes"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return io.StringIO(r.read().decode("utf-8", "replace"))


def key_from_pbp(name):
    """nflverse 'F.Last' / 'Bi.Robinson' -> 'last#f' (last name + first initial)."""
    ini, _, last = (name or "").partition(".")
    ini = re.sub(r"[^a-z]", "", ini.lower())
    last = re.sub(r"[^a-z0-9]", "", last.lower())
    return f"{last}#{ini[:1]}" if last and ini else ""


def key_from_full(name):
    """Roster 'First Last' -> 'last#f' to match key_from_pbp."""
    parts = [p for p in re.split(r"\s+", (name or "").strip()) if p]
    if len(parts) < 2:
        return ""
    first = re.sub(r"[^a-z]", "", parts[0].lower())
    last = re.sub(r"[^a-z0-9]", "", "".join(parts[1:]).lower())
    for suf in ("jr", "sr", "ii", "iii", "iv", "v"):
        if last.endswith(suf) and len(last) > len(suf):
            last = last[:-len(suf)]
    return f"{last}#{first[:1]}" if last and first else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--week")
    args = ap.parse_args()

    # name -> list of plays, in real order
    idx = {}
    for row in csv.DictReader(fetch_pbp()):
        if args.week and row.get("week") != args.week:
            continue
        who = kind = None
        if row.get("touchdown") == "1" and row.get("td_player_name"):
            who = row["td_player_name"]
            pt = (row.get("play_type") or "").lower()
            kind = "rush TD" if pt == "run" else "rec TD" if pt == "pass" else f"{pt} TD"
        elif row.get("field_goal_result") == "made" and row.get("kicker_player_name"):
            who = row["kicker_player_name"]
            kind = f"FG {row.get('kick_distance','')}yd".strip()
        if not who:
            continue
        try:
            gsr = int(row.get("game_seconds_remaining") or 0)
        except ValueError:
            gsr = 0
        entry = {"week": row.get("week"), "q": row.get("qtr"), "clock": row.get("time"),
                 "kind": kind, "game": row.get("game_id"),
                 "date": row.get("game_date"), "start": row.get("start_time") or "",
                 "gsr": gsr}
        is_pass_td = (row.get("touchdown") == "1"
                      and (row.get("play_type") or "").lower() == "pass"
                      and row.get("passer_player_name"))
        # scorer (receiver on a pass TD, rusher on a run, kicker on a FG). On a
        # pass TD, stamp the receiver's entry with the passer's name + team, so a
        # consumer can credit the QB unambiguously (the "last#f" key collides,
        # e.g. Jordan vs Jeremiyah Love - a name+team match does not).
        recv_entry = dict(entry)
        if is_pass_td:
            recv_entry["passer"] = row["passer_player_name"]
            recv_entry["pos_team"] = row.get("posteam") or ""
        k = key_from_pbp(who)
        if k:
            idx.setdefault(k, []).append(recv_entry)
        # also credit the passer on his own card
        if is_pass_td:
            pk = key_from_pbp(row["passer_player_name"])
            if pk and pk != k:
                idx.setdefault(pk, []).append({**entry, "kind": "pass TD"})
    # order each player's plays by real time (date, kickoff, then clock down)
    for who in idx:
        idx[who].sort(key=lambda p: (p["date"], p["start"], -p["gsr"]))
    OUT.write_text(json.dumps(idx, indent=1, sort_keys=True))
    print(f"wrote {OUT.name}: {len(idx)} players, "
          f"{sum(len(v) for v in idx.values())} scoring plays")


if __name__ == "__main__":
    main()
