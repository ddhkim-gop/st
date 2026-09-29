#!/usr/bin/env python3
"""Collect NFL video posts from X during games, for every league on this Mac.

ESPN posts ~5 clips a game, so a rostered player's second or third touchdown
often has no ESPN clip at all (week 3: 44 of 76 rostered-player TDs clipped).
Team accounts post nearly every play they make, and the NFL's network accounts
post the big ones.

Source: X's public embed timeline (syndication.twitter.com), the same data an
embedded "Tweets by @X" widget shows. No login and no cookies - but it returns
only an account's 20 newest posts, and allows 30 requests per 15 minutes per
IP. During a game a team's 20 posts cover ~2.5 hours, so the poller asks for
ONE account per run and runs every 90 seconds (~40 requests an hour), @NFL -
which posts far faster - every fourth run. Outside a game window it exits
without touching X.

Posts land in a shared store outside every repo; each league's nightly run
reads it through x_ingest.py.

    python3 scripts/x_poll.py            # one poll, if a game is on
    python3 scripts/x_poll.py --force    # one poll regardless (testing)
"""
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

STORE_DIR = Path.home() / "Library" / "Caches" / "fantasy-football" / "x"
POSTS = STORE_DIR / "posts.json"          # id -> post record
STATE = STORE_DIR / "state.json"          # rotation slot, backoff, kickoffs
LOG = Path.home() / "Library" / "Logs" / "fantasy-football" / "x-poll.log"
KEEP_DAYS = 10

TIMELINE = "https://syndication.twitter.com/srv/timeline-profile/screen-name/{}"
SCOREBOARD = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")

# handle -> ESPN team abbreviation ("" for league-wide accounts). The team is
# what lets x_ingest pin an emoji-only "TOUCHDOWN!!" post to the play it shows.
TEAMS = {
    "AZCardinals": "ARI", "AtlantaFalcons": "ATL", "Ravens": "BAL",
    "BuffaloBills": "BUF", "Panthers": "CAR", "ChicagoBears": "CHI",
    "Bengals": "CIN", "Browns": "CLE", "dallascowboys": "DAL", "Broncos": "DEN",
    "Lions": "DET", "packers": "GB", "HoustonTexans": "HOU", "Colts": "IND",
    "Jaguars": "JAX", "Chiefs": "KC", "Raiders": "LV", "chargers": "LAC",
    "RamsNFL": "LAR", "MiamiDolphins": "MIA", "Vikings": "MIN",
    "Patriots": "NE", "Saints": "NO", "Giants": "NYG", "nyjets": "NYJ",
    "Eagles": "PHI", "steelers": "PIT", "49ers": "SF", "Seahawks": "SEA",
    "Buccaneers": "TB", "Titans": "TEN", "Commanders": "WSH",
}
NETWORKS = ["NFLonFOX", "NFLonCBS", "SNFonNBC", "NFLonPrime", "ESPNNFL"]
ACCOUNTS = {**TEAMS, **{h: "" for h in NETWORKS}, "NFL": ""}
ROTATION = list(TEAMS) + NETWORKS


def log(msg: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def _load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def _save(path: Path, value) -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value))
    tmp.replace(path)


def kickoffs(state: dict) -> list[str]:
    """Kickoff times (UTC ISO) for ESPN's current week plus yesterday through
    tomorrow, refreshed every 6 hours. The default scoreboard flips to the new
    week late (still last week's games on Tuesday 2026-09-29), so the dated
    pulls are what catch a Thursday game. ESPN rejects a date range."""
    k = state.get("kickoffs") or {}
    fresh = time.time() - k.get("at", 0) < 6 * 3600
    if fresh and all(isinstance(t, dict) for t in k.get("times", [])):
        return k.get("times", [])
    today = datetime.now().date()
    urls = [SCOREBOARD] + [f"{SCOREBOARD}?dates={today + timedelta(days=d):%Y%m%d}"
                           for d in (-1, 0, 1)]
    games = {}
    try:
        for url in urls:
            req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                       "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                evs = json.load(r).get("events") or []
            for e in evs:
                if e.get("date"):
                    games[e.get("id") or e["date"]] = {
                        "at": e["date"],
                        "teams": [(c.get("team") or {}).get("abbreviation", "")
                                  for c in (e.get("competitions") or [{}])[0].get("competitors", [])]}
    except Exception as e:
        log(f"! scoreboard: {e}")
        return k.get("times", [])
    times = sorted(games.values(), key=lambda t: t["at"])
    state["kickoffs"] = {"at": time.time(), "times": times}
    return times


def live_teams(times: list) -> set[str]:
    """Teams whose game kicks off within 10 minutes or kicked off under 4.5
    hours ago (long games plus the post-game clip dump). Empty = no game on."""
    now = datetime.now(timezone.utc)
    live = set()
    for t in times:
        if not isinstance(t, dict):         # old state format
            continue
        try:
            k = datetime.fromisoformat(t["at"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        if k - timedelta(minutes=10) <= now <= k + timedelta(hours=4, minutes=30):
            live |= {x for x in t.get("teams", []) if x}
    return live


def next_account(state: dict, live: set[str]) -> str:
    """@NFL every fourth run; otherwise the next account in a rotation of the
    teams playing right now plus the networks. The request budget turned out
    to be shared with traffic from outside this Mac (it drained ~3-4 calls a
    minute with the poller idle), so none of it goes to teams not on the field.
    """
    n = state.get("runs", 0)
    state["runs"] = n + 1
    if n % 4 == 0:
        return "NFL"
    # Teams on the field go round twice for each network pass: on MNF the
    # Bears gave 22 video posts from 3 polls, the networks few from 17.
    teams = [h for h, t in TEAMS.items() if t in live]
    rot = (teams + NETWORKS[:len(NETWORKS) // 2] + teams + NETWORKS[len(NETWORKS) // 2:]
           if live else ROTATION)
    i = state.get("slot", 0) % len(rot)
    state["slot"] = i + 1
    return rot[i]


def fetch(handle: str) -> tuple[list[dict], dict]:
    req = urllib.request.Request(TIMELINE.format(handle), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        body = r.read().decode("utf-8", "replace")
        headers = dict(r.headers)
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if not m:
        return [], headers
    entries = (json.loads(m.group(1)).get("props", {}).get("pageProps", {})
               .get("timeline", {}).get("entries", []))
    return [e["content"]["tweet"] for e in entries
            if (e.get("content") or {}).get("tweet")], headers


def to_record(t: dict, handle: str) -> dict | None:
    """A video post as a flat record, or None (no video, or a repost - the
    original is polled from its own account if it matters)."""
    if t.get("retweeted_status"):
        return None
    media = ((t.get("extended_entities") or t.get("entities") or {}).get("media") or [])
    vid = next((m for m in media if m.get("video_info")), None)
    if not vid:
        return None
    mp4s = [v for v in vid["video_info"].get("variants", [])
            if v.get("content_type") == "video/mp4" and v.get("url")]
    if not mp4s:
        return None
    best = max(mp4s, key=lambda v: v.get("bitrate") or 0)
    created = datetime.strptime(t["created_at"], "%a %b %d %H:%M:%S %z %Y")
    user = t.get("user") or {}
    sn = user.get("screen_name") or handle
    text = re.sub(r"\s*https://t\.co/\S+", "", t.get("full_text") or t.get("text") or "").strip()
    return {"id": t["id_str"], "url": f"https://x.com/{sn}/status/{t['id_str']}",
            "handle": sn, "account": handle, "team": ACCOUNTS.get(handle, ""),
            "name": user.get("name") or sn,
            "avatar": user.get("profile_image_url_https") or "",
            "verified": bool(user.get("verified") or user.get("is_blue_verified")),
            "text": text,
            "created": created.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "video": best["url"], "poster": vid.get("media_url_https") or "",
            "secs": round((vid["video_info"].get("duration_millis") or 0) / 1000),
            "faves": t.get("favorite_count") or 0}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="poll even outside a game")
    ap.add_argument("--account", help="poll this handle instead of the rotation")
    a = ap.parse_args()

    state = _load(STATE, {})
    live = live_teams(kickoffs(state))
    if not a.force and not live:
        _save(STATE, state)
        return 0
    if time.time() < state.get("backoff_until", 0):
        return 0

    handle = a.account or next_account(state, live)
    try:
        tweets, headers = fetch(handle)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            reset = int(e.headers.get("x-rate-limit-reset") or time.time() + 900)
            state["backoff_until"] = reset + 5
            log(f"429 on @{handle}; backing off until {datetime.fromtimestamp(reset):%H:%M:%S}")
        else:
            log(f"! @{handle}: HTTP {e.code}")
        _save(STATE, state)
        print(f"@{handle}: HTTP {e.code}")
        return 0
    except Exception as e:
        log(f"! @{handle}: {e}")
        _save(STATE, state)
        return 0

    posts = _load(POSTS, {})
    new = 0
    for t in tweets:
        rec = to_record(t, handle)
        if not rec:
            continue
        if rec["id"] not in posts:
            posts[rec["id"]] = rec
            new += 1
        else:                               # refresh likes on a post we have
            posts[rec["id"]]["faves"] = rec["faves"]
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    posts = {k: v for k, v in posts.items() if v["created"] >= cutoff}
    _save(POSTS, posts)
    if headers.get("x-rate-limit-remaining") == "0":
        state["backoff_until"] = int(headers.get("x-rate-limit-reset") or 0) + 5
    _save(STATE, state)
    msg = (f"@{handle}: {len(tweets)} posts, {new} new video; budget "
           f"{headers.get('x-rate-limit-remaining')}/{headers.get('x-rate-limit-limit')}; "
           f"store {len(posts)}")
    log(msg)
    print(msg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
