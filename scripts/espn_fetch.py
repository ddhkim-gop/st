#!/usr/bin/env python3
"""Pull real NFL per-play highlight clips from ESPN's free public feed.

ESPN's game pages carry a `videos[]` array whose headlines name the player and
the play ("Derrick Henry powers in for a Ravens TD", "Jared Goff finds Amon-Ra
St. Brown"), each with a direct .mp4 on ESPN's CDN and a thumbnail. That is
everything the panel needs - and it costs no API key, no auth, and zero model
tokens (the headline IS the attribution, so no frame-watching).

Why this exists: X has no public search API and rate-limits hard; Reddit blocks
Anthropic's crawler; Highlightly paywalls NFL. ESPN's `cdn.espn.com/core` route
answers from this machine (the `site.api.espn.com` host is IP-blocked; the CDN
core route is not) and serves NFL highlights free.

It does NOT reinvent the build. It pre-seeds the three committed caches the X
pipeline already reads -
    .highlights_oembed_cache.json   author/text/date  (so oembed() is a cache hit)
    .highlights_media_cache.json    {video, poster}   (so the panel plays inline)
    highlights_reviewed.json keep{} "Player - detail" (trusted attribution)
- appends each clip's ESPN watch URL to highlights_pool.txt, then runs
build_highlights.py. Everything downstream (dedupe, per-player cap, playtimes,
dual-credit labelling, team fan-out) is reused unchanged.

The mp4 URL points at ESPN's Akamai CDN; the bytes stream from there exactly as
X clips stream from video.twimg - nothing is rehosted, so the repo stays small.

    python3 espn_fetch.py                     # Week-1 slate, then build
    python3 espn_fetch.py --dates 20260907 20260908
    python3 espn_fetch.py --no-build          # seed caches only
    python3 espn_fetch.py --dry-run           # print matches, write nothing
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Headlines that are recaps or negative plays, not a highlight of the named
# player: "...win big over...", "takes 5 sacks in loss", full-game wraps.
NEGATIVE_RE = re.compile(
    r"\b(win big|wins big|\bloss\b|takes? \d+ sacks?|"
    r"shines as|recap|full (game )?highlights|reaction|reacts?|breaks? down|"
    r"press conference|interview|highlights?$|"
    r"says?|talks?|discusses|weighs? in|reflects?|"
    # studio/debate takes about a player, not footage of a play
    r"slams|blasts|rips|rants?|calls out|stephen a|first take|get up|"
    # turnovers / negative plays - not a highlight for the offensive player
    r"picked off|intercept(ed|ion)?|rough (night|day|outing)|"
    r"turnover|fumbles?( it| the| away)?|strip[- ]sack)\b"
    # talking-head quotes: name + ": '...'" or a quoted span. Plays have neither.
    r"|:\s*['\"]|'[^']{8,}'", re.I)

HERE = Path(__file__).resolve().parent
POOL = HERE / "highlights_pool.txt"
REVIEWED = HERE / "highlights_reviewed.json"
OEMBED_CACHE = HERE / ".highlights_oembed_cache.json"
MEDIA_CACHE = HERE / ".highlights_media_cache.json"
BUILD = HERE / "build_highlights.py"

CORE = "https://cdn.espn.com/core/nfl"                      # game videos (works)
SCORE = ("https://site.web.api.espn.com/apis/site/v2/"      # scoreboard: this host
         "sports/football/nfl/scoreboard")                 # answers 200 where the
                                                           # cdn/core route 202-blocks
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36")

# Reuse the X builder's roster load and name matcher verbatim, so ESPN clips are
# attributed with the same ambiguity guard (shared surnames need a first name).
sys.path.insert(0, str(HERE))
from build_highlights import rosters, mentions, playtime_key  # noqa: E402
PLAYTIMES = HERE / ".playtimes.json"


_TEAM_ALIAS = {"LA": "LAR", "WAS": "WSH", "OAK": "LV", "SD": "LAC", "STL": "LAR"}


def _team(t):
    t = (t or "").upper()
    return _TEAM_ALIAS.get(t, t)


def _pbp_parts(nm):
    """nflverse 'P.Mahomes' -> ('p','mahomes')."""
    nm = (nm or "").strip()
    first, last = (nm.split(".", 1) if "." in nm else
                   ((nm.split()[0], nm.split()[-1]) if nm.split() else ("", "")))
    return re.sub(r"[^a-z]", "", first.lower())[:1], re.sub(r"[^a-z]", "", last.lower())


def passer_maps(teams):
    """(playtimes, roster_players). roster_players is (initial, last, team, name)
    so a nflverse passer name+team resolves to exactly one rostered QB - the
    'last#f' key alone collides (Jordan vs Jeremiyah Love)."""
    try:
        pt = json.loads(PLAYTIMES.read_text())
    except Exception:
        pt = {}
    roster_players = []
    for r in teams.values():
        for p in r:
            i, l = _pbp_parts(p["name"])
            roster_players.append((i, l, _team(p.get("team")), p["name"]))
    return pt, roster_players


# A QB belongs on a clip only when he threw the touchdown. These read the ESPN
# headline, which titles a scoring play by the man who reached the end zone.
RUSH_RE = re.compile(r"""
    rush(?:ing|es|ed)?\s+(?:TD|touchdown)   | \brun(?:s|ning)?\s+(?:it\s+)?in
  | \bbreaks?\s+free       | \bpowers?\s+(?:in|across|through|his\s+way)
  | \bmotors?\s+in         | \bwalks?\s+in(?:to)?\b
  | \bpunches?\s+it\s+in   | \bbarrels?\s+in
  | \bdashes?\s+in         | \bscamper       | \bplunge
  | \bscrambl             | \bbulldozes?    | \bstiff-arms?
  | \bbreaks?\s+through    | \bkeeper\b
  | reaches?\s+across\s+the\s+goal\s+line
  | \bcarr(?:y|ies)\b      | \buntouched\b
""", re.VERBOSE | re.IGNORECASE)

REC_RE = re.compile(r"""
    \bcatch | \breception | \bpass\b | \bhauls?\s+in | \bsnare
  | \bgrab  | touchdown\s+(?:pass|catch|reception)
  | \bhits?\s+\S+(?:\s+\S+){0,2}\s+for\s+(?:a|an|his|the|\d)
  | \boff\s+\S+'s\s+pass
""", re.VERBOSE | re.IGNORECASE)


def clip_kind(text: str) -> str:
    """'rush', 'rec' or '' for an ESPN headline, from its verbs alone.

    A receiving cue outranks a rushing verb: "Rodgers scrambles, hits Freiermuth
    for a TD" carries both, and the ball was thrown.
    """
    if REC_RE.search(text or ""):
        return "rec"
    if RUSH_RE.search(text or ""):
        return "rush"
    return ""


ORDINAL_RE = re.compile(r"\b(?:his\s+)?(\d+)(?:st|nd|rd|th)\s+(?:TD|touchdown)", re.I)


def nth_td_kind(text, ents):
    """'rush TD'/'rec TD' when the headline counts the score ("his 2nd TD").

    ESPN numbers a player's touchdowns in game order, which is the order the
    play log is already in, so the ordinal names the exact play - the one thing
    the verbs cannot do for a headline like "finds pay dirt for his 2nd TD".
    """
    m = ORDINAL_RE.search(text or "")
    if not m:
        return ""
    tds = [e for e in ents if e.get("kind") in ("rush TD", "rec TD")]
    i = int(m.group(1)) - 1
    return tds[i].get("kind") if 0 <= i < len(tds) else ""


def with_passers(who, pt, roster_players, text=""):
    """Expand a receiver credit list with the QB(s) who threw their TDs.

    ESPN titles a passing TD by the receiver, so the QB is never in the headline.
    nflverse stamps each receiver's rec-TD with the passer's name+team; match that
    to the roster so the QB is co-credited and the clip lands on his card too.

    The 'last#f' playtimes key collides (two D. Moores, Jordan vs Jeremiyah Love),
    so filter the receiver's own entries to his team (passer and receiver are
    teammates, so the entry's pos_team is the receiver's team too), and resolve
    the passer by name+team - never by key alone.

    A player's rec TDs are not the only thing he did in the game, so the whole
    entry list cannot speak for one clip: Kenneth Walker III ran one in and
    caught one from Mahomes in the same game, and crediting off the list put
    Mahomes on the *run*. `text` is the clip's own headline, which names the
    play - a rushing verb blocks the QB outright, and when a player scored both
    ways the headline must actually read as a catch before a QB is added.
    """
    kind = clip_kind(text)
    if kind == "rush":
        return list(who)
    team_of = {fn: t for (_i, _l, t, fn) in roster_players}
    out = list(who)
    for r in who:
        rteam = team_of.get(r)
        ents = pt.get(playtime_key(r), [])
        # Scored both ways this game: an unworded headline cannot say which.
        # "his 2nd TD" still can - it indexes the play log directly. Failing
        # that, only an explicit receiving cue earns the QB a credit.
        if kind != "rec" and {e.get("kind") for e in ents} >= {"rush TD", "rec TD"}:
            nth = nth_td_kind(text, ents)
            if nth != "rec TD":
                continue
        for e in ents:
            if e.get("kind") != "rec TD" or not e.get("passer"):
                continue
            eteam = _team(e.get("pos_team"))
            if rteam and eteam and eteam != _team(rteam):
                continue                       # a different same-key player's play
            pi, pl = _pbp_parts(e["passer"])
            cands = [fn for (i, l, t, fn) in roster_players
                     if l == pl and i == pi and (not eteam or t == eteam)]
            for qb in cands:
                if qb not in out:
                    out.append(qb)
    return out


def get(url: str, timeout: int = 25, tries: int = 3):
    """GET JSON with retries. ESPN's CDN intermittently answers a rapid burst
    with an HTML challenge page (non-JSON); a short backoff clears it."""
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": UA, "Accept": "application/json",
                              "Referer": "https://www.espn.com/"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def current_week() -> int:
    try:
        return int(get("https://api.sleeper.app/v1/state/nfl", timeout=15).get("week") or 1)
    except Exception:
        return 1


def game_ids(week: int, year: int) -> list[tuple[str, str]]:
    """[(gameId, 'AWAY@HOME'), ...] for every NFL game in a regular-season week.

    One scoreboard call returns the whole week's slate (~16 games), so this hits
    ESPN once instead of once per calendar day - fewer requests, less throttling.
    """
    try:
        evs = get(f"{SCORE}?seasontype=2&week={week}&dates={year}")["events"]
    except Exception as e:
        print(f"  ! scoreboard week {week}: {e}", file=sys.stderr)
        return []
    return [(e["id"], e.get("shortName", "")) for e in evs]


def mp4_of(v: dict) -> str:
    src = (v.get("links", {}) or {}).get("source", {}) or {}
    for k in ("href", "HD", "full", "mezzanine"):
        h = src.get(k)
        if isinstance(h, dict):
            h = h.get("href")
        if h and ".mp4" in h:
            return h
    return ""


def game_videos(gid: str) -> list[dict]:
    try:
        gp = get(f"{CORE}/game?xhr=1&gameId={gid}").get("gamepackageJSON", {})
    except Exception as e:
        print(f"  ! game {gid}: {e}", file=sys.stderr)
        return []
    return gp.get("videos") or []


def _load(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", type=int, help="NFL week (default: current from Sleeper)")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="print matches only")
    a = ap.parse_args()

    week = a.week or current_week()
    print(f"ESPN pull for {a.year} week {week}")

    teams = rosters()                      # arms the shared-surname guard
    roster_union = sorted({p["name"] for r in teams.values() for p in r})
    print(f"{len(roster_union)} rostered players to match against")
    pt, roster_players = passer_maps(teams)

    oe = _load(OEMBED_CACHE)
    mc = _load(MEDIA_CACHE)
    rv = _load(REVIEWED)
    keep = rv.setdefault("keep", {})
    pool = set(POOL.read_text().split()) if POOL.exists() else set()

    seen_clip: set[str] = set()
    seen_games: set[str] = set()
    matched, scanned = [], 0
    for gid, label in game_ids(week, a.year):
        if gid in seen_games:
            continue
        seen_games.add(gid)
        time.sleep(0.4)                      # be polite to ESPN's CDN
        for v in game_videos(gid):
                scanned += 1
                cid = str(v.get("id") or "")
                if cid and cid in seen_clip:
                    continue
                seen_clip.add(cid)
                headline = v.get("headline") or ""
                if NEGATIVE_RE.search(headline):
                    continue                 # recap / negative play, not a highlight
                text = headline
                desc = v.get("description") or ""
                if desc and desc != text:
                    text = f"{text}. {desc}"
                who = [n for n in roster_union if mentions(text, n)]
                if not who:
                    continue
                who = with_passers(who, pt, roster_players, text)  # QB gets his TD passes
                url = ((v.get("links", {}) or {}).get("web", {}) or {}).get("href")
                mp4 = mp4_of(v)
                if not url or not mp4:
                    continue
                date_iso = (v.get("originalPublishDate") or "")[:10]
                poster = v.get("thumbnail") or ""
                note = f"{' & '.join(who)} - {v.get('headline','')} (auto: ESPN)"
                matched.append({"url": url, "who": who, "text": text,
                                "date": date_iso, "label": label, "note": note,
                                "mp4": mp4, "poster": poster})
                if a.dry_run:
                    continue
                oe[url] = {"url": url, "author": "ESPN",
                           "author_url": "https://www.espn.com",
                           "text": text, "date": date_iso}
                mc[url] = {"video": mp4, **({"poster": poster} if poster else {})}
                keep[url] = note
                pool.add(url)

    print(f"\nscanned {scanned} ESPN videos -> {len(matched)} name a rostered player")
    for m in sorted(matched, key=lambda x: x["date"]):
        print(f"  {m['date']}  {m['label']:9}  {' & '.join(m['who'])[:34]:34}  "
              f"{m['text'][:46]}")

    if a.dry_run:
        print("\ndry run - nothing written")
        return 0
    if not matched:
        print("no ESPN clips matched a rostered player; nothing written")
        return 0

    OEMBED_CACHE.write_text(json.dumps(oe, indent=1, sort_keys=True) + "\n")
    MEDIA_CACHE.write_text(json.dumps(mc, indent=1, sort_keys=True) + "\n")
    REVIEWED.write_text(json.dumps(rv, indent=1, ensure_ascii=False) + "\n")
    POOL.write_text("\n".join(sorted(pool)) + "\n")
    print(f"seeded caches; pool now {len(pool)} urls")

    if not a.no_build:
        print("\nrebuilding feeds…")
        subprocess.run([sys.executable, str(BUILD), str(POOL)], cwd=str(HERE.parent))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
