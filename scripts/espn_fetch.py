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
import pathlib
import random
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
    r"picked off|picks? off|pick[- ]?six|intercept(ed|ion|s)?|"
    r"rough (night|day|outing)|"
    r"turnover|fumbles?( it| the| away)?|strip[- ]sack|"
    # sacks and injuries: footage of something happening *to* the player
    r"sacks?|sacked|carted off|injur(y|ed|ies)|leaves? (the game|with)|"
    r"exits? (the game|with)|hurt)\b"
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
  | \bconnects?\s+with | \blinks?\s+up | \bhooks?\s+up | \bthrows | \btosses
  | \bslings? | \bfloats? | \blofts? | \bdimes? | \bthreads | \bairs\b
  | \bfinds\s+(?!pay\s*dirt|the\s+end|his\s+way|a\s+(?:hole|seam|lane))\w
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


# One ESPN pull, shared by every league on this Mac.
#
# Each repo used to fetch the same 16 games itself: four leagues x two weeks =
# ~128 requests a night for ~32 games of data. ESPN's 202 is a cumulative
# per-IP budget, not a per-burst one, so the first two leagues to run got their
# clips and the last two got nothing at all - on 2026-09-27, gameofphones and
# indigo pulled fine and st logged 29 challenges and zero videos. The cache
# lives outside every repo so it is shared rather than committed four times.
ESPN_CACHE = pathlib.Path.home() / "Library" / "Caches" / "fantasy-football" / "espn"
CACHE_TTL = 6 * 3600     # one night's runs all fall inside this


def _cache_read(key: str, max_age: float | None = CACHE_TTL):
    """Cached payload for `key`, or None when missing or older than max_age
    (None = any age)."""
    f = ESPN_CACHE / f"{key}.json"
    try:
        if max_age is not None and time.time() - f.stat().st_mtime > max_age:
            return None
        return json.loads(f.read_text())
    except Exception:
        return None


def _cache_write(key: str, value) -> None:
    """Write atomically: a half-written file read by the next league would be a
    challenge-shaped failure that no retry clears."""
    try:
        ESPN_CACHE.mkdir(parents=True, exist_ok=True)
        tmp = ESPN_CACHE / f"{key}.tmp"
        tmp.write_text(json.dumps(value))
        tmp.replace(ESPN_CACHE / f"{key}.json")
    except Exception as e:
        print(f"  ! cache write {key}: {e}", file=sys.stderr)


def get(url: str, timeout: int = 25, tries: int = 5):
    """GET JSON with retries. ESPN's CDN answers a burst with a 202 and an empty
    body - a bot challenge, not an outage: the same URL returns 200 moments
    later. The old 3 tries at 1.5s steps (~9s) were not enough, and a whole
    night's run could lose every game to it, so back off exponentially with
    jitter and name the 202 instead of letting it surface as a JSON error."""
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": UA, "Accept": "application/json",
                              "Referer": "https://www.espn.com/"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                if r.status == 202 or not body.strip():
                    raise RuntimeError(f"CDN challenge (HTTP {r.status}, "
                                       f"{len(body)} bytes)")
                return json.loads(body.decode("utf-8", "replace"))
        except Exception as e:
            last = e
            if i < tries - 1:
                time.sleep(min(2 ** (i + 1), 16) + random.uniform(0, 1.5))
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


# Circuit breaker, shared by every league through a marker file: once the CDN
# has challenged three games in a row, stop asking it for 30 minutes and serve
# cached clip lists. Retrying a blocked endpoint burns ~30s a game, and four
# leagues doing it made a 2-minute job a 30-minute one - while likely keeping
# the IP blocked longer.
_BLOCKED = ESPN_CACHE / "cdn-blocked"
_BLOCK_FOR = 30 * 60
_fails = 0


def _cdn_blocked() -> bool:
    try:
        return time.time() - _BLOCKED.stat().st_mtime < _BLOCK_FOR
    except OSError:
        return False


def game_videos(gid: str) -> list[dict]:
    """This game's clips, from the shared cache when it is still warm.

    A miss is only written on a real answer: caching [] after a 202 would turn
    one challenge into six hours of empty feeds across every league.
    """
    global _fails
    hit = _cache_read(f"game-{gid}")
    if hit is not None:
        return hit
    # First choice: the same clip list from ESPN's site.web.api host, which -
    # with the parameters ESPN's own game page sends - carries `videos` and
    # has not been challenging this Mac. cdn.espn.com's 202 wall cost every
    # ESPN clip from 2026-09-28 on (MNF PHI@CHI: 0 clips; this host: 12).
    try:
        sw = get(f"{SUMMARY}?event={gid}&region=us&lang=en&contentorigin=espn&xhr=1")
        if "videos" in sw:
            vids = sw.get("videos") or []
            comp = ((sw.get("header") or {}).get("competitions") or [{}])[0]
            if (((comp.get("status") or {}).get("type")) or {}).get("completed"):
                _cache_write(f"game-{gid}", vids)
            return vids
    except Exception as e:
        print(f"  ! summary videos {gid}: {e}", file=sys.stderr)
    if _cdn_blocked():
        return _cache_read(f"game-{gid}", max_age=None) or []
    try:
        gp = get(f"{CORE}/game?xhr=1&gameId={gid}").get("gamepackageJSON", {})
        _fails = 0
    except Exception as e:
        _fails += 1
        if _fails >= 3:
            try:
                ESPN_CACHE.mkdir(parents=True, exist_ok=True)
                _BLOCKED.touch()
                print("  ! CDN keeps challenging - using cached clip lists for 30 min",
                      file=sys.stderr)
            except OSError:
                pass
        # A challenged night still has last night's list: ESPN clips of a
        # finished game only ever disappear, they don't change.
        stale = _cache_read(f"game-{gid}", max_age=None)
        print(f"  ! game {gid}: {e}" + (f" - using {len(stale)} cached" if stale else ""),
              file=sys.stderr)
        return stale or []
    vids = gp.get("videos") or []
    # Only a finished game's list is cached. PHI@CHI was cached empty at 9:44
    # the morning of the game; that night ESPN challenged the refetch and the
    # stale empty list was served, so the whole MNF game got no ESPN clips.
    comp = ((gp.get("header") or {}).get("competitions") or [{}])[0]
    if (((comp.get("status") or {}).get("type")) or {}).get("completed"):
        _cache_write(f"game-{gid}", vids)
    return vids


SUMMARY = SCORE.replace("/scoreboard", "/summary")


def game_summary(gid: str) -> dict:
    """{date, teams, final, plays} for one game from ESPN's play-by-play.

    Every play carries `wallclock`, the real-world moment it happened - the one
    thing a clip's own publish date cannot give, since ESPN re-posts and X
    accounts upload hours or days after the snap. Only a finished game is
    cached; a live one would freeze its play list mid-game for six hours.
    """
    hit = _cache_read(f"summary-{gid}")
    if hit is not None and all("off" in pl for pl in hit.get("plays") or []):
        return hit
    try:
        s = get(f"{SUMMARY}?event={gid}")
    except Exception as e:
        print(f"  ! summary {gid}: {e}", file=sys.stderr)
        return {}
    comp = ((s.get("header") or {}).get("competitions") or [{}])[0]
    final = bool((((comp.get("status") or {}).get("type")) or {}).get("completed"))
    teams = [_team(((c.get("team") or {}).get("abbreviation")))
             for c in comp.get("competitors") or []]
    dr = s.get("drives") or {}
    drives = list(dr.get("previous") or []) + ([dr["current"]] if dr.get("current") else [])
    plays = []
    for d in drives:
        off = _team(((d.get("team") or {}).get("abbreviation")) or "")
        for pl in d.get("plays") or []:
            if not pl.get("wallclock"):
                continue
            plays.append({"id": str(pl.get("id") or ""), "off": off,
                          "wall": pl["wallclock"],
                          "q": (pl.get("period") or {}).get("number"),
                          "clock": (pl.get("clock") or {}).get("displayValue", ""),
                          "type": ((pl.get("type") or {}).get("text") or ""),
                          "yards": pl.get("statYardage"),
                          "text": pl.get("text") or ""})
    plays.sort(key=lambda x: x["wall"])
    out = {"id": gid, "date": comp.get("date", ""), "teams": teams,
           "final": final, "plays": plays}
    if final:
        _cache_write(f"summary-{gid}", out)
    return out


_SUFFIX = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"}
_ORDINAL = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5}


def _pbp_name_re(full: str):
    """'Kenneth Walker III' -> matches ESPN's 'K.Walker'; 'Amon-Ra St. Brown'
    -> 'A.St. Brown'. ESPN sometimes widens the initial ('Ja.Chase')."""
    parts = [x for x in full.split() if x.lower() not in _SUFFIX]
    if len(parts) < 2:
        return None
    init = re.sub(r"[^a-z]", "", parts[0].lower())[:1]
    last = r"\s?".join(re.escape(x) for x in " ".join(parts[1:]).split())
    return re.compile(rf"\b{init}[a-z']{{0,2}}\.\s?{last}\b", re.I)


def _clip_yards(text: str) -> set[int]:
    return {int(n) for n in re.findall(r"\b(\d{1,3})[- ]?(?:yard|yd)s?\b", text, re.I)}


def _play_yards(pl: dict) -> set[int]:
    ys = {int(n) for n in re.findall(r"\bfor (-?\d{1,3}) yards?\b", pl["text"])}
    ys |= {int(n) for n in re.findall(r"\b(\d{1,3}) yard field goal\b", pl["text"], re.I)}
    if isinstance(pl.get("yards"), int):
        ys.add(pl["yards"])
    return ys


def _clip_ordinal(text: str) -> int:
    m = re.search(r"\b(\d)(?:st|nd|rd|th)\b|\b(first|second|third|fourth|fifth)\b",
                  text, re.I)
    if not m or not re.search(r"\b(?:td|touchdown)", text[m.start():], re.I):
        return 0
    return int(m.group(1)) if m.group(1) else _ORDINAL[m.group(2).lower()]


_TD_CLIP = re.compile(r"\btd\b|touchdown|pay dirt|end ?zone|to the house|"
                      r"\bscores?\b|walks? in|punches? it in|dives? in|"
                      r"goal[- ]?line|pylon|six points|paydirt", re.I)
_FG_CLIP = re.compile(r"\bfg\b|field goal", re.I)


def _scored_plays(text: str, names: list[str], summ: dict, published: str = ""):
    """Every play in `summ` naming a credited player, scored as (score, play, game).

    Scored on what the headline actually says - scorer, TD or not, yardage,
    run vs catch, "his 2nd TD" - against every play in the game that names a
    credited player. `published` (ESPN's upload time) rules out plays that had
    not happened yet and breaks ties toward the nearest earlier play. With no
    upload time a tie is left unmatched rather than guessed: two clips wrongly
    pinned to one play would be merged as duplicates and a real highlight lost.
    """
    plays = (summ or {}).get("plays") or []
    pats = [r for r in (_pbp_name_re(n) for n in names) if r]
    if not plays or not pats:
        return []
    pub = None
    if published:
        try:
            pub = datetime.fromisoformat(published.replace("Z", "+00:00"))
        except ValueError:
            pub = None
    kind = clip_kind(text)
    td_clip, fg_clip = bool(_TD_CLIP.search(text)), bool(_FG_CLIP.search(text))
    cyards, nth = _clip_yards(text), _clip_ordinal(text)
    td_seen: dict[int, int] = {}          # per-name running TD count, game order
    scored = []
    for pl in plays:
        # Names are read from the play's own clause only. The tail after
        # "TOUCHDOWN" names the two-point passer/receiver, the kicker, the
        # long snapper - Garrett Wilson caught a *teammate's* conversion, and
        # snapper N.Moore sits in every Ravens extra point, which tied Lamar's
        # TD to Chris Moore with his TD to Hibner.
        main = re.split(r"TOUCHDOWN", pl["text"])[0]
        hits = [i for i, r in enumerate(pats) if r.search(main)]
        if not hits:
            continue
        ptxt, ptype = pl["text"].lower(), pl["type"].lower()
        is_td = (("touchdown" in ptxt or "touchdown" in ptype)
                 and "nullified" not in ptxt and "no play" not in ptxt)
        if is_td:
            for i in hits:
                td_seen[i] = td_seen.get(i, 0) + 1
        wall = datetime.fromisoformat(pl["wall"].replace("Z", "+00:00"))
        if pub and wall > pub + timedelta(minutes=2):
            continue                       # clip was up before this play happened
        sc = len(hits) - 1                  # QB and receiver both named
        # The headline often names the other half of the play, rostered or
        # not ("Lamar Jackson finds Chris Moore"): that surname in the play's
        # text pins which of his passes it was.
        # Parenthesised names are tacklers: "(A.Winfield)" on an Aaron Jones
        # run is not the partner a "Jones 🤝 Winfield" post is about.
        others = {m.lower() for m in re.findall(
            r"\b[A-Z][a-z']{0,2}\.\s?([A-Z][A-Za-z'\-]{2,})",
            re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", main))}
        others -= {n.split()[-1].lower() for n in names}
        if any(re.search(rf"\b{re.escape(o)}\b", text, re.I) for o in others):
            sc += 3
        is_fg = "field goal" in ptype and "good" in ptype
        if fg_clip:
            sc += 4 if is_fg else -3
        elif td_clip:
            sc += 4 if is_td else -3
        elif is_td:
            sc += 1
        py = _play_yards(pl)
        if cyards:                          # a stated distance is a hard fact
            sc += 4 if cyards & py else -4
        if kind:
            is_rush = "rush" in ptype
            is_pass = "pass" in ptype or " pass " in ptxt
            if (kind == "rush" and is_rush) or (kind == "rec" and is_pass):
                sc += 2
            elif (kind == "rush" and is_pass) or (kind == "rec" and is_rush):
                sc -= 2
        if nth and is_td and any(td_seen.get(i) == nth for i in hits):
            sc += 3
        if pub:
            dt = (pub - wall).total_seconds()
            sc += 2 * max(0.0, 1 - dt / 1800) if dt >= -120 else 0
        scored.append((sc, pl, summ))
    return scored


def _pick(scored: list, timed: bool) -> dict:
    """Best play from (score, play, game) triples. Below 3 is no match; with
    no upload time, a runner-up within half a point is too close to call."""
    if not scored:
        return {}
    scored = sorted(scored, key=lambda x: x[0], reverse=True)
    best_sc, best, summ = scored[0]
    if best_sc < 3:
        return {}
    if not timed and len(scored) > 1 and scored[1][0] >= best_sc - 0.5:
        return {"ambiguous": True}          # a guess here could merge two plays
    return {"played_at": best["wall"], "game_time": f"Q{best['q']} {best['clock']}",
            "play_key": f"{summ['id']}:{best['id']}", "game_id": summ["id"]}


def match_play(text: str, names: list[str], summ: dict, published: str = "") -> dict:
    """The play a clip shows, as {played_at, game_time, play_key, game_id}, or
    {} - see _scored_plays for the evidence weighed."""
    return _pick(_scored_plays(text, names, summ, published), bool(published))


def rostered_passer(text: str, summ: dict, union: list[str]) -> list[str]:
    """[QB] for a TD clip whose headline names only an unrostered receiver.

    "Jeremy Ruckert hauls in 4-yard TD for Jets" names no rostered player, so
    the clip was dropped - yet Geno Smith, who threw it, is rostered. Find the
    TD pass whose receiver the headline names; if its passer is rostered, the
    clip is his. More than one candidate passer and nobody is credited.
    """
    qbs = set()
    for pl in (summ or {}).get("plays") or []:
        if "touchdown" not in pl["text"].lower() or "nullified" in pl["text"].lower():
            continue
        main = pl["text"].split("TOUCHDOWN")[0]
        m = re.search(r"([A-Z][a-z']{0,2}\.\s?[A-Z][\w'\-]+) pass\b.*?\bto "
                      r"[A-Z][a-z']{0,2}\.\s?([A-Z][\w'\-]+(?:\s[A-Z][\w'\-]+)?)", main)
        if not m or not re.search(rf"\b{re.escape(m.group(2).split()[-1])}\b", text, re.I):
            continue
        for n in union:
            r = _pbp_name_re(n)
            if r and r.fullmatch(m.group(1).strip()):
                qbs.add(n)
    return sorted(qbs) if len(qbs) == 1 else []


def locate_play(text: str, names: list[str], team: str, date_iso: str,
                week: int, year: int = 2026) -> dict:
    """match_play for a clip with no game attached (an X post).

    Tries that team's games from the post date backwards, as far as three
    weeks. Going back matters: a post's date can be when it was captured, not
    when the play happened, and a week-1 touchdown found this way is dated to
    week 1 - and dropped as stale - instead of sorting above Sunday's plays.
    All candidate games are scored together, so an older game only wins with a
    strictly better match.
    """
    team = _team(team)
    try:
        day = datetime.fromisoformat(date_iso).replace(tzinfo=timezone.utc)
    except ValueError:
        return {}
    post = day + timedelta(hours=36)        # a Sunday-night kickoff is Monday UTC
    games = []
    for w in range(week, max(0, week - 3), -1):
        for gid, label in game_ids(w, year):
            if team not in {_team(x) for x in re.split(r"\s*(?:@|VS)\s*", label.upper())}:
                continue
            summ = game_summary(gid)
            try:
                kick = datetime.fromisoformat(summ["date"].replace("Z", "+00:00"))
            except (KeyError, ValueError):
                continue
            if kick <= post:
                games.append((kick, summ))
    # Pick across all the games at once. The game just before the post date
    # gets +3 - clips go up within a day or two - so an older game's play
    # wins only on clearly stronger evidence (a matching yardage, a named
    # receiver), and a tie anywhere stays unmatched.
    scored = []
    for kick, g in games:
        bonus = 3 if (day - kick).total_seconds() <= 2.5 * 86400 else 0
        scored += [(sc + bonus, pl, gg) for sc, pl, gg in _scored_plays(text, names, g)]
    return _pick(scored, False)


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
        time.sleep(random.uniform(0.6, 1.4))   # pace the burst past the CDN
        summ = None
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
                    if summ is None:
                        summ = game_summary(gid)
                    who = rostered_passer(text, summ, roster_union)
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
                if summ is None:
                    summ = game_summary(gid)
                pub = v.get("originalPublishDate") or ""
                loc = match_play(text, who, summ, pub)
                loc.pop("ambiguous", None)
                mc[url] = {"video": mp4, **({"poster": poster} if poster else {}),
                           "espn_game": gid, "published": pub, **loc}
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
