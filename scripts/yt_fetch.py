#!/usr/bin/env python3
"""Collect team play clips from YouTube Shorts, for every league on this Mac.

Team channels upload the same single-play clips they post on X ("TO THE
HOUSE 💨", "Monan-GONE 💨 #kylemonangai #touchdown"), live - within ~10-30
minutes of the play - and, unlike X's 20-newest embed window, the Shorts tab
keeps them. So this fills what the game-day X poller missed, including games
played before it was running. No login, no API key: yt-dlp reads the public
Shorts tab (one flat listing per channel), then one metadata read per NEW
video for its upload time.

Records go to a shared store with the same shape as x_poll.py's (plus
`youtube`: the video id); x_ingest.py files both.

    python3 scripts/yt_fetch.py              # all team channels
    python3 scripts/yt_fetch.py --channel ChicagoBears
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from x_poll import TEAMS                                   # noqa: E402

STORE_DIR = Path.home() / "Library" / "Caches" / "fantasy-football" / "yt"
POSTS = STORE_DIR / "posts.json"
KEEP_DAYS = 10
PER_CHANNEL = 30          # newest Shorts to look at per channel (only new ones cost a read)
# YouTube handle, where it differs from the team's X handle.
YT_HANDLE: dict[str, str] = {
    "RamsNFL": "LARams", "Ravens": "BaltimoreRavens", "Chiefs": "KansasCityChiefs",
    "Panthers": "CarolinaPanthers", "Saints": "NewOrleansSaints", "Giants": "NYGiants",
}


def _load() -> dict:
    try:
        return json.loads(POSTS.read_text())
    except Exception:
        return {}


def _save(posts: dict) -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = POSTS.with_suffix(".tmp")
    tmp.write_text(json.dumps(posts))
    tmp.replace(POSTS)


def ytdlp(args: list[str], timeout: int = 180) -> list[str]:
    try:
        r = subprocess.run(["yt-dlp", "--no-warnings", "-q", *args], capture_output=True,
                           text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        return [l for l in (r.stdout or "").splitlines() if l.strip()]
    except Exception as e:
        print(f"  ! yt-dlp: {e}", file=sys.stderr)
        return []


def channel(account: str, team: str, posts: dict) -> int:
    handle = YT_HANDLE.get(account, account)
    tab = f"https://www.youtube.com/@{handle}/shorts"
    ids = [l.split("|", 1)[0] for l in ytdlp(["--flat-playlist", "--playlist-end",
                                                str(PER_CHANNEL), "--print", "%(id)s|", tab])]
    new = [i for i in ids if i and i not in posts]
    if not new:
        return 0
    # One process for all new videos; "|"-separated so titles can hold anything
    # but a newline.
    lines = ytdlp(["--skip-download", "--print",
                   "%(id)s|%(timestamp)s|%(duration)s|%(like_count)s|%(channel)s|%(title)s",
                   *[f"https://www.youtube.com/shorts/{i}" for i in new]], timeout=600)
    added = 0
    for l in lines:
        parts = l.split("|", 5)
        if len(parts) < 6 or not parts[1].isdigit():
            continue
        vid, ts, dur, likes, chan, title = parts
        created = datetime.fromtimestamp(int(ts), timezone.utc)
        posts[vid] = {"id": vid, "url": f"https://www.youtube.com/shorts/{vid}",
                      "handle": handle, "account": account, "team": team,
                      "name": chan or handle, "avatar": "", "verified": True,
                      "text": title, "created": created.strftime("%Y-%m-%dT%H:%M:%SZ"),
                      "youtube": vid, "poster": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                      "secs": int(float(dur)) if dur.replace(".", "", 1).isdigit() else 0,
                      "faves": int(likes) if likes.isdigit() else 0}
        added += 1
    return added


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", help="one team account (x_poll.TEAMS key)")
    a = ap.parse_args()
    posts = _load()
    todo = {a.channel: TEAMS[a.channel]} if a.channel else TEAMS
    total = 0
    for account, team in todo.items():
        n = channel(account, team, posts)
        total += n
        if n:
            _save(posts)                    # a killed run keeps what it read
            print(f"  @{YT_HANDLE.get(account, account)}: {n} new", flush=True)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    posts = {k: v for k, v in posts.items() if v["created"] >= cutoff}
    _save(posts)
    print(f"yt_fetch: {total} new Shorts; store {len(posts)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
