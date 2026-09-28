#!/usr/bin/env python3
"""File the X posts x_poll.py collected into this league's highlight caches.

Each video post is tied to the play it shows in ESPN's play-by-play, using the
post's own timestamp - team accounts post a play a minute or two after it
happens, so the timestamp does what a headline alone cannot:

  - A post that names a rostered player is matched with match_play, the post
    time standing in for ESPN's upload time.
  - A team account's "TOUCHDOWN!! 🙌" that names nobody is pinned to that
    team's latest touchdown in the 15 minutes before it was posted.

Credit goes to every rostered player in the matched play's own clause - scorer
and passer - so the QB gets his TD passes without the headline naming him. A
post tied to a play is auto-approved (it is a real play, like an ESPN clip);
one that is not is left for build_highlights.py's caption screen.

(ingest_highlights.py is the older, manual route: it caption-matches a
browser-made candidates file against Sleeper stat events.)

    python3 scripts/x_ingest.py           # then build_highlights.py
    python3 scripts/x_ingest.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import espn_fetch as E                                   # noqa: E402
from build_highlights import rosters, mentions            # noqa: E402

STORE = Path.home() / "Library" / "Caches" / "fantasy-football" / "x" / "posts.json"
OEMBED = HERE / ".highlights_oembed_cache.json"
MEDIA = HERE / ".highlights_media_cache.json"
VIDEO = HERE / ".highlights_video_cache.json"
REVIEWED = HERE / "highlights_reviewed.json"
POOL = HERE / "highlights_pool.txt"
AUTHORS = HERE / "highlights_authors.json"
DAYS = 8
TD_CUE = re.compile(r"touchdown|\btd\b|end ?zone|pay ?dirt|six\b|6️⃣", re.I)


def _load(p: Path, default):
    try:
        return json.loads(p.read_text())
    except Exception:
        return default


def _ts(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


class Games:
    """This week's and last week's games, by team, loaded on first use."""

    def __init__(self, week: int):
        self.week, self._by_team = week, None

    def for_team(self, team: str, at: datetime) -> dict:
        if self._by_team is None:
            self._by_team = {}
            for w in (self.week, self.week - 1):
                for gid, _label in (E.game_ids(w, 2026) if w >= 1 else []):
                    s = E.game_summary(gid)
                    for t in s.get("teams") or []:
                        self._by_team.setdefault(t, []).append(s)
        for s in self._by_team.get(E._team(team), []):
            try:
                kick = _ts(s["date"])
            except (KeyError, ValueError):
                continue
            if kick - timedelta(minutes=15) <= at <= kick + timedelta(hours=5):
                return s
        return {}


def rostered_in_play(summ: dict, play_key: str, union: list[str],
                     team_of: dict) -> list[str]:
    """Rostered players in a touchdown's own clause - scorer and passer - so
    the QB is credited for TD passes (and only those: a QB gets no credit for
    his receiver's non-scoring catch). Only players on the two teams in the
    game count: ESPN writes Kyren and Kyle Williams alike as "K.Williams"."""
    pid = play_key.split(":", 1)[1]
    pl = next((p for p in summ.get("plays") or [] if p["id"] == pid), None)
    if not pl or "touchdown" not in pl["text"].lower():
        return []
    main = pl["text"].split("TOUCHDOWN")[0]
    sides = {E._team(t) for t in summ.get("teams") or []}
    return [n for n in union if E._team(team_of.get(n)) in sides
            and (r := E._pbp_name_re(n)) and r.search(main)]


def latest_td(summ: dict, at: datetime) -> dict | None:
    """The last touchdown in the 15 minutes before `at` (a team's own post)."""
    best = None
    for pl in summ.get("plays") or []:
        t = pl["text"].lower()
        if "touchdown" not in t or "nullified" in t or "no play" in t:
            continue
        w = _ts(pl["wall"])
        if at - timedelta(minutes=15) <= w <= at + timedelta(minutes=1):
            best = pl
    return best


def latest_play_naming(summ: dict, names: list[str], at: datetime) -> dict | None:
    """A team account's post of a non-scoring play ("Kyren Williams with the
    spin move") carries no yardage or TD to match on - but team accounts post
    within a couple of minutes, so it is the player's last play before the post.
    Eight minutes back at most; none in that span, no match."""
    pats = [r for r in (E._pbp_name_re(n) for n in names) if r]
    best = None
    for pl in summ.get("plays") or []:
        w = _ts(pl["wall"])
        if at - timedelta(minutes=8) <= w <= at + timedelta(minutes=1) and \
                any(r.search(pl["text"].split("TOUCHDOWN")[0]) for r in pats):
            best = pl
    return best


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    posts = _load(STORE, {})
    if not posts:
        print("x_ingest: no collected X posts")
        return 0
    teams = rosters()
    union = sorted({p["name"] for r in teams.values() for p in r})
    team_of = {p["name"]: p.get("team") for r in teams.values() for p in r}
    games = Games(E.current_week())

    oe, mc, vc = _load(OEMBED, {}), _load(MEDIA, {}), _load(VIDEO, {})
    rv, authors = _load(REVIEWED, {}), _load(AUTHORS, {})
    keep, reject = rv.setdefault("keep", {}), rv.get("reject", {})
    pool = set(POOL.read_text().split()) if POOL.exists() else set()

    since = datetime.now(timezone.utc) - timedelta(days=DAYS)
    added = approved = 0
    for p in sorted(posts.values(), key=lambda x: x["created"]):
        url, text, at = p["url"], p["text"], _ts(p["created"])
        if at < since or url in reject or E.NEGATIVE_RE.search(text):
            continue
        who = [n for n in union if mentions(text, n)]
        if p.get("team"):                   # a team account posts its own players
            who = [n for n in who if E._team(team_of.get(n)) == E._team(p["team"])]
        team = p.get("team") or (team_of.get(who[0]) if who else "")
        summ = games.for_team(team, at) if team else {}
        loc = {}
        if summ and who:
            loc = E.match_play(text, who, summ, p["created"])
            if not loc.get("play_key") and p.get("team"):
                pl = latest_play_naming(summ, who, at)
                if pl:
                    loc = {"played_at": pl["wall"], "game_time": f"Q{pl['q']} {pl['clock']}",
                           "play_key": f"{summ['id']}:{pl['id']}", "game_id": summ["id"]}
        elif summ and p.get("team") and TD_CUE.search(text):
            pl = latest_td(summ, at)
            if pl:
                loc = {"played_at": pl["wall"], "game_time": f"Q{pl['q']} {pl['clock']}",
                       "play_key": f"{summ['id']}:{pl['id']}", "game_id": summ["id"]}
        loc.pop("ambiguous", None)
        if loc.get("play_key"):
            who = sorted(set(who) | set(rostered_in_play(summ, loc["play_key"], union, team_of)))
        if not who:
            continue
        added += url not in pool
        pool.add(url)
        oe[url] = {"url": url, "author": p["handle"],
                   "author_url": f"https://x.com/{p['handle']}", "text": text,
                   "date": p["created"][:10], "faves": p.get("faves", 0),
                   "secs": p.get("secs", 0)}
        mc[url] = {"video": p["video"], **({"poster": p["poster"]} if p.get("poster") else {}),
                   "published": p["created"], **loc}
        vc[url] = True
        authors[p["handle"]] = {"name": p.get("name") or p["handle"],
                                "avatar": p.get("avatar") or "",
                                "verified": bool(p.get("verified"))}
        if loc.get("play_key") and url not in keep:
            keep[url] = f"{' & '.join(who)} - {text[:110]} (auto: X)"
            approved += 1
        if a.dry_run:
            print(f"  {p['created'][5:16]} @{p['handle']:<14} {loc.get('game_time','--'):9} "
                  f"{' & '.join(who)[:30]:30} | {text[:50]}")

    print(f"x_ingest: {len(posts)} collected, {added} new to this league, "
          f"{approved} tied to a play and approved")
    if a.dry_run:
        return 0
    for path, val in ((OEMBED, oe), (MEDIA, mc), (VIDEO, vc), (AUTHORS, authors)):
        path.write_text(json.dumps(val, indent=1, sort_keys=True) + "\n")
    REVIEWED.write_text(json.dumps(rv, indent=1, ensure_ascii=False) + "\n")
    POOL.write_text("\n".join(sorted(pool)) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
