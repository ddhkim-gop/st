#!/usr/bin/env python3
"""Build assets/highlights/<team>.json from a pool of candidate X post URLs.

Discovery cannot be automated: X has no public search API, and yt-dlp has no
timeline or search extractor for it. So a human (or Claude driving a logged-in
browser) collects candidate post URLs into a pool file; everything after that
is automatic.

For each URL the script reads X's public oembed endpoint - no auth, no key -
to get the post text, author and date. It then matches the text against every
team's Sleeper roster and writes one feed per team, so a single pool fans out
across all 12 teams instead of being curated twelve times.

Usage:
    python3 scripts/build_highlights.py pool.txt              # all teams
    python3 scripts/build_highlights.py pool.txt --team ddhk   # one team
    python3 scripts/build_highlights.py pool.txt --dry-run
"""
from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "assets" / "highlights"
LEAGUE_ID = "1400268451699818496"          # Game of Phones 2026
SLEEPER = "https://api.sleeper.app/v1"
OEMBED = "https://publish.twitter.com/oembed"
MAX_PER_TEAM = 30
MAX_PER_PLAYER = 5      # a player can make several distinct plays in a game;
                        # reposts of one play are collapsed by video id below
# How far back a highlight may come from. In season this is the current game
# week only - the panel is about what just happened. Before week 1 there are no
# games, so it opens up to the whole camp/preseason run.
PRESEASON_FLOOR = "2026-07-01"

# Previous-season footage is never shown, in or out of season (David,
# 2026-09-07): a clip of last year's touchdown is not this year's highlight,
# even while there are no games to clip from. Flip to True to let camp-season
# panels fall back on it.
ALLOW_PREVIOUS_SEASON = False
MAX_AGE_DAYS = 21       # fallback if Sleeper's state endpoint is unreachable

# Team defences are excluded: their "name" is a city or franchise, so any post
# mentioning the place matches. That produced 11 entries like a Vikings tweet
# filed under "Minnesota Vikings DEF" - a location match, not a highlight.
EXCLUDE_POSITIONS = {"DEF", "DST", "D/ST"}

# A "highlight" should be footage, not a take about a player. oembed cannot tell
# a video post from a text or photo one - pic.twitter.com appears for both - so
# yt-dlp is asked whether the post carries a playable video. Results are cached
# because the check costs a network round trip per post.
VIDEO_CACHE = REPO / "scripts" / ".highlights_video_cache.json"

# Direct media URLs so the panel can play a clip in place. These point at
# video.twimg.com, unsigned and public, so the bytes still come from X's CDN -
# nothing is rehosted here. Resolution costs a yt-dlp call, so it is cached.
MEDIA_CACHE = REPO / "scripts" / ".highlights_media_cache.json"

# oembed (author/text/date) is cached and COMMITTED, so a clip that resolved
# once keeps rendering even when X later 403s the oembed for it (transient
# throttling was silently evicting already-shipped, watched clips).
OEMBED_CACHE = REPO / "scripts" / ".highlights_oembed_cache.json"
_OEMBED: dict | None = None

# Real game timing per player (quarter + clock), built by gen_playtimes.py from
# nflverse. Lets each clip show "Q1 8:34" and sort as it happened in real life.
PLAYTIMES = REPO / "scripts" / ".playtimes.json"


def _playtimes() -> dict:
    try:
        return json.loads(PLAYTIMES.read_text())
    except Exception:
        return {}


def playtime_key(full_name: str) -> str:
    """Roster 'First Last' -> 'last#f' to match the nflverse playtimes index."""
    parts = [p for p in re.split(r"\s+", (full_name or "").strip()) if p]
    if len(parts) < 2:
        return ""
    first = re.sub(r"[^a-z]", "", parts[0].lower())
    last = re.sub(r"[^a-z0-9]", "", "".join(parts[1:]).lower())
    for suf in ("jr", "sr", "ii", "iii", "iv", "v"):
        if last.endswith(suf) and len(last) > len(suf):
            last = last[:-len(suf)]
    return f"{last}#{first[:1]}" if last and first else ""

# Display name, avatar and verified flag per handle, so the panel can render a
# post the way X does instead of a bare handle. Harvested from X's own timeline
# responses; committed because it changes rarely.
AUTHORS = REPO / "scripts" / "highlights_authors.json"

# Engagement counts per post id, so the card can carry the post's own numbers.
# A snapshot: they only drift upward, and re-harvesting refreshes them.
STATS = REPO / "scripts" / "highlights_stats.json"

# The text gate below reads captions; it cannot watch the footage. Verdicts
# from actually watching a post live here and outrank it in both directions.
REVIEWED = REPO / "scripts" / "highlights_reviewed.json"

# Scoreboards read off clips, as "AWAY@HOME AS-HS". Looked up against
# nflverse's schedule so a clip's season and week are a fact, not a guess.
try:
    from scoreboard import verdict as score_verdict
except ImportError:                       # running from another directory
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from scoreboard import verdict as score_verdict

# Surnames common enough that a bare match is meaningless - these need the
# first name too, or "Cook" pulls in every post about a coach named Cook.
#
# This hand-kept seed is a floor, not the whole answer: a blocklist cannot keep
# up with the league. shared_surnames() below adds every surname two or more
# active NFL players share, read off Sleeper's own roster of players, which is
# what caught Ja'Kobi Lane being filed under Jaylin Lane and Tetairoa McMillan
# under Jalen McMillan.
AMBIGUOUS = {
    "cook", "brown", "smith", "johnson", "williams", "jones", "davis", "wilson",
    "moore", "hill", "bell", "young", "carter", "allen", "robinson", "white",
    "harris", "walker", "mitchell", "warren", "love", "james", "murray", "kirk",
    "black", "thomas", "taylor", "scott", "green", "king", "wright", "lloyd",
    "pitts", "cousins", "jackson", "adams", "evans", "collins", "reed", "hall",
    "harrison", "pierce", "douglas", "washington", "mitchell", "little",
    "watson", "cook", "dell", "henry", "conner", "gibbs", "burden",
}


_SHARED: set[str] | None = None


def shared_surnames(players: dict) -> set[str]:
    """Surnames borne by two or more active NFL players.

    A surname the league only uses once is safe to match bare - "Bhayshul" aside,
    nobody else is Tuten. A surname two players share is not: the post says
    "Lane" and means whichever one it means, so the first name has to appear.
    Derived from the same player dump the rosters come from, so it tracks the
    league instead of drifting behind a hand-kept list.
    """
    global _SHARED
    if _SHARED is not None:
        return _SHARED
    seen: dict[str, set[str]] = {}
    for p in players.values():
        if not p or p.get("position") not in ("QB", "RB", "WR", "TE", "K"):
            continue
        if (p.get("status") or "") in ("Inactive",):
            continue
        first = (p.get("first_name") or "").strip().lower()
        last = (p.get("last_name") or "").strip().lower()
        if not first or not last:
            continue
        seen.setdefault(last, set()).add(first)
    _SHARED = {k for k, v in seen.items() if len(v) > 1}
    return _SHARED


# A post can carry video and name a player without ever showing him. These
# are the shapes that kept slipping through: a college betting prop, a fantasy
# rankings graphic, a transaction report. Each embeds video of someone.
REJECT_PATTERNS = [
    (r"\b(ncaaf|cfb|college\s*football|ncaa|heisman|bowl\s+game)\b",
     "college football"),
    # A clip captioned with a past season is old college or archive film.
    (r"\((?:19|20)\d{2}[,)]|\b(?:20(?:1\d|2[0-5]))\s*(?:season|week|vs)\b|"
     r"\bin\s+20(?:1\d|2[0-5])\b", "archive/old season"),
    (r"""\b(prop|props|parlay|bet|bets|betting|odds|sportsbook|
           fanduel|draftkings|underdog|\d+u|units?)\b
        | \b(over|under)\s*\d
        | (?<![\w.])[-+]\d{3}(?![\w.])""", "betting"),
    # Fantasy advice of any shape. The feed shows football, not roster takes.
    (r"""\b(ranking|rankings|tiers?|start\s*/?\s*sit|waiver|sleepers?|
           mock\s+draft|draft\s+(guide|kit|board|steal)|adp|
           top\s+\d+|best\s+ball|dynasty|redraft|
           fantasy|lineup|roster\s+(spot|crunch)|stash|
           buy\s+low|sell\s+high|breakout|bust|value|target[s]?\s+him|
           who\s+(should|would)\s+you|take\s+the\s+over)\b""",
     "fantasy advice/list"),
    # Podcasts, radio, shows and interviews. All of these embed video of a
    # person talking about football, which is not a highlight.
    (r"""\b(podcast|pod|episode|ep\.?\s*\d|full\s+episode|
           radio|show|segment|livestream|live\s+stream|
           interview|interviews|sits?\s+down|joins?\s+(us|the|on)|
           talks?\s+(about|to)|spoke|speaks|discuss(es|ing)?|
           react(s|ion|ing)?|explains?|breaks?\s+down|
           press\s+conference|presser|told\s+reporters|media\s+availability|
           on\s+how|on\s+his|on\s+what|on\s+why|asked\s+about|
           subscribe|listen|watch\s+the\s+full|clip\s+from|
           presented\s+by|via\s+@\w+\s*$)\b""", "podcast/interview/show"),
    (r"""\b(injur\w+|questionable|doubtful|ruled\s+out|placed\s+on\s+ir|
           activated|contract|extension|restructure|holdout|
           signs?|signed|waived|released|cut|suspended|fined|
           traded|acquires?|acquired|banged\s+up)\b""", "news/transaction"),
]

# Accounts whose video is essentially never a highlight: fantasy-advice shops,
# podcast feeds, news breakers whose clips are TV hits, and repost aggregators.
# A specific post from one of these can still be admitted by hand through
# highlights_reviewed.json, which outranks this list.
EXCLUDE_AUTHORS = {
    "fantasypros", "fantasyfocus", "mattharmon_byb", "ffphinest",
    "afantasyformula", "underdognfl", "balls_out_bets", "propkitchen",
    "rapsheet", "jfowlerespn", "schultz_report", "nfl_dovkleiman",
    "mysportsupdate", "dawhitehousepod", "nfl_talk_sports",
    "chisportstracks", "thescorechicago", "lostalkspats",
    # exposed by watching: advice talking-heads and college-only accounts
    "thedumbzone", "simmbros", "popes_ff", "fbbible_", "noexpertfs",
    "dynastydadff", "blueprintffb", "rotowire", "fantasypts", "fantasylabs",
    "upsidersff", "weekinfantasy", "dynastynerds", "sleeperhq", "sleepernfl",
    "matthewberrytmr", "yahoofantasyjh", "parlayanalyzer", "linecrushbot",
    "line_crush", "925_sports", "performancescfb", "swankywolverine",
    "terrapins247", "yahh_nezzz", "section313sport", "micnuggetsnfl",
    "kalshifb", "profootballdoc", "medspirationnfp", "singhdpt",
}

HIGHLIGHT_CUES = r"""\b(
    touchdown|tds?|score[sd]?|scoring|end\s*zone|six
  | catch|catches|caught|grab|grabs|snag|reception|hands
  | one[-\s]?hand|toe[-\s]?tap|contested|sideline|over\s+the\s+shoulder
  | juke[sd]?|hurdle[sd]?|stiff[-\s]?arm|spin|truck(ed|s)?|broke[n]?\s+tackle
  | route|releases?|footwork|separation|beat
  | deep\s+ball|dime|bomb|dot|throw[sn]?|pass|dart|launch
  | rush|run|runs|carry|carries|burst|explode[sd]?|speed
  | sack[s]?|pressure|interception|int|pick[-\s]?six|forced\s+fumble|tackle
  | highlight[s]?|reel|film|footage|clip|rep[s]?|drill[s]?
  | camp|practice|ota|preseason|scrimmage|joint\s+practice
  | wow|nasty|filthy|absurd|insane|cooking|cooked|smooth
)\b"""


def get_json(url: str, timeout: int = 30):
    req = urllib.request.Request(url, headers={"User-Agent": "highlights-builder"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def rosters() -> dict[str, list[dict]]:
    """owner display name -> list of {name, position, team} for that roster."""
    users = {u["user_id"]: (u.get("display_name") or u.get("username") or "Unknown")
             for u in get_json(f"{SLEEPER}/league/{LEAGUE_ID}/users")}
    players = get_json(f"{SLEEPER}/players/nfl")
    shared_surnames(players)          # arm the derived ambiguity set
    out: dict[str, list[dict]] = {}
    for r in get_json(f"{SLEEPER}/league/{LEAGUE_ID}/rosters"):
        owner = users.get(r.get("owner_id"), f"team {r['roster_id']}")
        roster = []
        for pid in (r.get("players") or []):
            p = players.get(str(pid)) or {}
            name = (p.get("full_name")
                    or f"{p.get('first_name','')} {p.get('last_name','')}".strip())
            if not name:
                continue
            position = p.get("position") or ""
            if position.upper() in EXCLUDE_POSITIONS:
                continue
            roster.append({"name": name, "position": position,
                           "team": p.get("team") or "FA"})
        out[owner] = roster
    return out


def reviewed_players(verdict: str) -> set[str]:
    """The player a verdict actually confirms, read off the note's prefix.

    Notes are written as "Player Name - what the footage shows", or
    "Player A & Player B - ..." when one clip genuinely shows both. A post often
    names several players, so without this a clip verified as Trey McBride's
    touchdown could be filed under Marvin Harrison on another roster - the
    label would lie about footage that had genuinely been watched.
    """
    head = (verdict or "").split(" - ", 1)[0].strip()
    return {n.strip() for n in head.split(" & ") if n.strip()}


def _load_reviewed() -> tuple[dict, dict, dict]:
    """(keep, keep_preseason_only, reject) from the reviewed file.

    `keep_preseason_only` holds posts that do show the named player but whose
    footage is from a previous season - a season-long touchdown reel, a clip
    in an old uniform. Fine while there are no games to clip from; once games
    are being played the panel must be that week's football, so they drop out.
    """
    if not REVIEWED.exists():
        return {}, {}, {}
    try:
        d = json.loads(REVIEWED.read_text())
    except ValueError:
        print(f"  ! {REVIEWED.name} is not valid JSON; ignoring", file=sys.stderr)
        return {}, {}, {}
    return (d.get("keep") or {}, d.get("keep_preseason_only") or {},
            d.get("reject") or {})


def _load_scoreboards() -> dict:
    if not REVIEWED.exists():
        return {}
    try:
        return (json.loads(REVIEWED.read_text()).get("games") or {})
    except ValueError:
        return {}


SCORE_RE = re.compile(r"^\s*([A-Za-z]{2,3})\s*@\s*([A-Za-z]{2,3})\s+"
                      r"(\d{1,2})\s*-\s*(\d{1,2})\s*$")


def dated_by_scoreboard(url: str, boards: dict, st: dict | None) -> tuple[str, str]:
    """(verdict, detail) for a clip whose score bug was recorded.

    Returns "unrecorded" when no scoreboard was read for this post - practice
    and camp clips have none, so they fall back to the review buckets.
    """
    raw = boards.get(url)
    if not raw:
        return "unrecorded", ""
    m = SCORE_RE.match(raw)
    if not m:
        return "unparsed", raw
    away, home, a, h = m.groups()
    try:
        v, g = score_verdict(away, home, a, h, st=st)
    except Exception as e:
        return "unparsed", f"{raw} ({e})"
    if not g:
        return v, raw
    return v, f"{g['season']} wk{g['week']} {g['away']} {g['away_score']} @ {g['home']} {g['home_score']}"


def _load_video_cache() -> dict:
    if VIDEO_CACHE.exists():
        try:
            return json.loads(VIDEO_CACHE.read_text())
        except ValueError:
            return {}
    return {}


def has_video(url: str, cache: dict) -> bool:
    if url in cache:
        return bool(cache[url])
    if not shutil.which("yt-dlp"):
        print("  ! yt-dlp not found; cannot verify video. Install it or pass "
              "--any-post.", file=sys.stderr)
        cache[url] = False
        return False
    try:
        r = subprocess.run(
            ["yt-dlp", "-q", "--no-warnings", "--skip-download",
             "--socket-timeout", "20", "--print", "%(duration)s", url],
            capture_output=True, text=True, timeout=90, stdin=subprocess.DEVNULL)
        first = (r.stdout or "").strip().splitlines()
        ok = bool(first) and re.fullmatch(r"[0-9.]+", first[0].strip()) is not None
    except Exception:
        ok = False
    cache[url] = ok
    return ok


def _load_media_cache() -> dict:
    if MEDIA_CACHE.exists():
        try:
            return json.loads(MEDIA_CACHE.read_text())
        except ValueError:
            return {}
    return {}


def media(url: str, cache: dict) -> dict:
    """{video, poster} for a post, or {} if they cannot be resolved.

    An empty result is not a failure the panel cannot survive - it falls back
    to X's own embed, which still plays via a click through to X.
    """
    if url in cache:
        return cache[url] or {}
    out = {}
    if shutil.which("yt-dlp"):
        try:
            r = subprocess.run(
                ["yt-dlp", "-q", "--no-warnings", "--skip-download",
                 "--socket-timeout", "20", "-f", "mp4/best",
                 "--print", "%(url)s", "--print", "%(thumbnail)s", url],
                capture_output=True, text=True, timeout=90,
                stdin=subprocess.DEVNULL)
            lines = [l.strip() for l in (r.stdout or "").splitlines() if l.strip()]
            vids = [l for l in lines if l.startswith("http") and ".mp4" in l]
            thumbs = [l for l in lines if l.startswith("http") and ".mp4" not in l]
            if vids:
                out = {"video": vids[0]}
                if thumbs:
                    out["poster"] = thumbs[0]
        except Exception:
            out = {}
    cache[url] = out
    return out


def _oembed_cache() -> dict:
    global _OEMBED
    if _OEMBED is None:
        try:
            _OEMBED = json.loads(OEMBED_CACHE.read_text())
        except Exception:
            _OEMBED = {}
    return _OEMBED


def _save_oembed_cache() -> None:
    if _OEMBED is not None:
        OEMBED_CACHE.write_text(json.dumps(_OEMBED, indent=1, sort_keys=True) + "\n")


def synth_info(url: str, note: str) -> dict:
    """Minimal card for an approved clip whose oembed never resolved (X 403).

    A watched-and-approved clip must ship regardless of oembed availability, so
    fall back to the reviewed note for text and the handle parsed from the URL.
    Dated today to stay inside the freshness window.
    """
    handle = url.split("/status/")[0].rstrip("/").rsplit("/", 1)[-1]
    return {"url": url, "author": handle, "author_url": f"https://x.com/{handle}",
            "text": note, "date": datetime.now(timezone.utc).strftime("%Y-%m-%d")}


def oembed(url: str) -> dict | None:
    cache = _oembed_cache()
    if url in cache:
        return cache[url]           # persisted -> survives a later transient 403
    q = urllib.parse.urlencode({"url": url, "dnt": "true", "omit_script": "true"})
    try:
        data = get_json(f"{OEMBED}?{q}")
    except Exception as e:
        print(f"  ! oembed failed for {url}: {e}", file=sys.stderr)
        return None
    raw = data.get("html") or ""
    # strip tags and unescape so name matching runs on plain prose
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    # oembed puts the date in the trailing attribution line, spelled out in
    # full ("September 4, 2026"). An earlier \w{3} pattern never matched it.
    date = ""
    m = re.search(r"(January|February|March|April|May|June|July|August|September|"
                  r"October|November|December)\s+(\d{1,2}),\s+(\d{4})", text)
    if m:
        try:
            date = datetime.strptime(" ".join(m.groups()), "%B %d %Y").strftime("%Y-%m-%d")
        except ValueError:
            date = ""
    if not date:
        m = re.search(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+"
                      r"(\d{1,2}),\s+(\d{4})", text)
        if m:
            try:
                date = datetime.strptime(" ".join(m.groups()), "%b %d %Y").strftime("%Y-%m-%d")
            except ValueError:
                date = ""
    info = {"url": data.get("url") or url,
            "author": data.get("author_name") or "",
            "author_url": data.get("author_url") or "",
            "text": text, "date": date}
    cache[url] = info               # persist so it survives future 403s
    return info


def _word(term: str) -> str:
    """A whole-word pattern for a name part. Without the boundaries, "Tate"
    matched the "tate" inside "statement" and filed a college betting prop
    under Carnell Tate."""
    return r"\b" + re.escape(term) + r"\b"


def mentions(text: str, player_name: str) -> bool:
    """Does this post name the player? Conservative on common surnames."""
    t = text.lower()
    parts = [p for p in re.split(r"\s+", player_name.lower()) if p]
    if not parts:
        return False
    first, last = parts[0], parts[-1]
    # drop suffixes so "Kyle Pitts Sr." still matches on "Pitts"
    if last in {"jr.", "sr.", "ii", "iii", "iv", "v"} and len(parts) > 2:
        last = parts[-2]
    if re.search(_word(player_name.lower()), t):
        return True
    if not re.search(_word(last), t):
        return False
    if last in AMBIGUOUS or last in (_SHARED or set()):
        return bool(re.search(_word(first), t)
                    or re.search(re.escape(f"{first[0]}. {last}"), t))
    return True


def is_highlight(text: str, player_name: str, roster_union: set[str]) -> tuple[bool, str]:
    """Does this post show a play by this player, or merely name him?

    Carrying video is not enough. A betting prop, a rankings graphic and a
    news roundup all embed video and all name players they never show. Three
    gates, all of which must pass. This reads the post's own words - it cannot
    see the footage - so it is a precision filter, not a proof.
    """
    t = text.lower()

    for pattern, why in REJECT_PATTERNS:
        if re.search(pattern, t, re.VERBOSE):
            return False, why

    # A post naming several players is a list or a slate, not one player's play.
    named = {n for n in roster_union if re.search(_word(n.split()[-1].lower()), t)}
    if len(named) >= 3:
        return False, f"names {len(named)} players (list)"

    # The play itself has to be described. Without a cue the post is a caption
    # about a player, not footage of one.
    if not re.search(HIGHLIGHT_CUES, t, re.VERBOSE):
        return False, "no play described"

    return True, ""


def load_capture(path: Path) -> list[dict]:
    """Records harvested from X's own timeline responses in the browser.

    Each already carries text, author, date and the fact that it has video, so
    this path needs no oembed call and no yt-dlp probe.
    """
    out = []
    for r in json.loads(path.read_text()):
        d = ""
        m = re.match(r"([A-Za-z]{3})\s+(\d{1,2})", r.get("d") or "")
        if m:
            month = ["Jan","Feb","Mar","Apr","May","Jun",
                     "Jul","Aug","Sep","Oct","Nov","Dec"].index(m.group(1)) + 1
            day = int(m.group(2))
            # X's timeline drops the year from recent dates. Choose the most
            # recent year that is not in the future - an earlier rule keyed off
            # the month and dated a May post to next year, so it would have
            # looked fresh forever.
            today = datetime.now(timezone.utc).date()
            year = today.year
            if (month, day) > (today.month, today.day):
                year -= 1
            d = f"{year}-{month:02d}-{day:02d}"
        out.append({"url": r["u"], "author": r.get("a") or "",
                    "author_url": f"https://x.com/{r.get('a','')}",
                    "text": r.get("t") or "", "date": d,
                    "faves": r.get("f") or 0, "secs": r.get("s") or 0})
    return out


_WINDOW: str | None = None
_IN_SEASON: bool = False


def _state() -> dict:
    return get_json(f"{SLEEPER}/state/nfl", timeout=20)


def in_season() -> bool:
    """Are games being played? Drives whether archive footage is allowed."""
    window_start()
    return bool(_IN_SEASON)


def window_start() -> str:
    """Earliest date a highlight may carry, as YYYY-MM-DD.

    Asks Sleeper what week it is rather than hardcoding a calendar. Once games
    are being played the window is the current week alone, because a highlight
    is about what just happened. Before the opener there is nothing to clip
    from a game, so it reaches back over camp and the preseason.
    """
    global _WINDOW, _IN_SEASON
    if _WINDOW:
        return _WINDOW
    floor = PRESEASON_FLOOR
    try:
        st = get_json(f"{SLEEPER}/state/nfl", timeout=15)
        start = datetime.strptime(st["season_start_date"], "%Y-%m-%d")
        week = int(st.get("week") or 1)
        wk_start = start + timedelta(days=7 * max(week - 1, 0))
        today = datetime.now(timezone.utc).replace(tzinfo=None)
        if today >= start:                     # games have been played
            # Sleeper can flip to the next week before that week's games are
            # played (mid-week), pushing wk_start ahead of the football actually
            # on the field. Floor to the earlier of the week start and 7 days
            # ago, so a just-played game still shows instead of being hidden as
            # "last week". Never reaches back past a week - still current, not
            # archival.
            floor_dt = min(wk_start, today - timedelta(days=7))
            floor = floor_dt.strftime("%Y-%m-%d")
            _IN_SEASON = True
            print(f"window: from {floor} (week {week} start "
                  f"{wk_start:%Y-%m-%d}, 7-day floor applied); "
                  f"previous-season footage excluded")
        else:
            print(f"window: preseason, from {floor} "
                  f"(week 1 opens {st['season_start_date']})")
    except Exception as e:
        floor = (datetime.now(timezone.utc)
                 - timedelta(days=MAX_AGE_DAYS)).strftime("%Y-%m-%d")
        print(f"  ! Sleeper state unreachable ({e}); "
              f"falling back to last {MAX_AGE_DAYS} days", file=sys.stderr)
    _WINDOW = floor
    return floor


def fresh(date: str) -> bool:
    """Inside the highlight window - see window_start()."""
    return bool(date) and date >= window_start()


def _clip_id(url: str, cache: dict) -> str:
    """Id of the actual video behind a post, or '' if unresolved.

    Every account reposting one play embeds the *same* monetized amplify clip,
    so X serves them all the same video id - that id is the play's true
    fingerprint. Two different plays get different ids even when they share a
    player, a game and a clip length, which is exactly the case the old
    length-bucket key merged by mistake.
    """
    v = (media(url, cache) or {}).get("video") or ""
    m = re.search(r"/(?:amplify_video|ext_tw_video|tweet_video)/(\d+)", v)
    if m:
        return m.group(1)
    # Direct-mp4 sources (ESPN) have no amplify id; their filename is a stable
    # per-clip id, so distinct plays by one player on one day keep distinct keys
    # instead of collapsing under the (player, date, length) fallback below.
    m = re.search(r"/([^/]+)\.mp4(?:[?#]|$)", v)
    return m.group(1) if m else ""


def dedupe(hits: list[dict], media_cache: dict) -> list[dict]:
    """Collapse re-posts of the same play, keep distinct plays, cap per player.

    Grouped on the underlying video id (see _clip_id): reposts of one play
    share it, distinct plays don't - so a player's several highlights in a
    game all survive, while a dozen re-uploads of one catch fold into a single
    card. Posts whose video can't be resolved (link-out cards) fall back to the
    older (player, date, rounded length) heuristic. Most-liked copy in a group
    wins, favouring the cleanest cut.
    """
    best: dict[tuple, dict] = {}
    for h in sorted([x for x in hits if fresh(x["date"])],
                    key=lambda x: -x.get("faves", 0)):
        cid = _clip_id(h["url"], media_cache)
        key = ((h["player"], "vid", cid) if cid
               else (h["player"], h["date"], round((h.get("secs") or 0) / 5)))
        best.setdefault(key, h)
    kept, per_player = [], {}
    for h in sorted(best.values(), key=lambda x: (x["date"] or "0", x.get("faves", 0)),
                    reverse=True):
        n = per_player.get(h["player"], 0)
        if n >= MAX_PER_PLAYER:
            continue
        per_player[h["player"]] = n + 1
        kept.append(h)
    return kept


def build(pool: list[str], only_team: str | None, dry_run: bool,
          video_only: bool = True, highlights_only: bool = True,
          capture: Path | None = None, verified_only: bool = False) -> int:
    if not capture:
        print(f"resolving {len(pool)} candidate posts via oembed"
              f"{' (video posts only)' if video_only else ''}…")
    cache = _load_video_cache()
    approved, archive, refused = _load_reviewed()
    boards = _load_scoreboards()
    season_state = None
    if archive and not ALLOW_PREVIOUS_SEASON:
        print(f"excluding {len(archive)} posts whose footage is from a previous "
              f"season (ALLOW_PREVIOUS_SEASON is off)")
    elif not in_season():
        approved = {**archive, **approved}      # no games yet, so old plays count
    else:
        try:
            season_state = _state()
        except Exception as e:
            print(f"  ! could not read season state ({e}); "
                  f"scoreboard dating disabled", file=sys.stderr)
        if archive:
            print(f"in season: holding back {len(archive)} posts whose footage "
                  f"is from a previous season")
    if capture:
        resolved = [r for r in load_capture(capture) if r["url"] not in refused]
        n0 = len(resolved)
        if highlights_only:
            resolved = [r for r in resolved
                        if r["url"] in approved
                        or r["author"].lower() not in EXCLUDE_AUTHORS]
        print(f"capture: {n0} video posts, {len(resolved)} after author filter")
    skipped, vetoed, by_author = 0, 0, 0
    if not capture:
        resolved = []
    for url in ([] if capture else pool):
        if url in refused:
            vetoed += 1
            continue
        # An approved post was watched, so the video question is already settled.
        if video_only and url not in approved and not has_video(url, cache):
            skipped += 1
            continue
        info = oembed(url)
        if not info and url in approved:
            info = synth_info(url, approved[url])      # keep watched clips alive
            print(f"  ~   approved (oembed unavailable) @{info['author']}")
        if info:
            handle = info["author_url"].rsplit("/", 1)[-1].lower()
            if highlights_only and url not in approved and handle in EXCLUDE_AUTHORS:
                by_author += 1
                continue
            resolved.append(info)
            print(f"  ok  {info['date'] or '????-??-??'}  @{info['author_url'].rsplit('/',1)[-1]}"
                  f"  {info['text'][:58]}")
        time.sleep(0.4)          # be polite to a public endpoint
    _save_oembed_cache()
    if video_only:
        VIDEO_CACHE.write_text(json.dumps(cache, indent=1, sort_keys=True) + "\n")
        print(f"\nskipped {skipped} posts with no video")
    if vetoed:
        print(f"dropped {vetoed} posts rejected on review (watched, showed no play)")
    if by_author:
        print(f"dropped {by_author} posts from advice/podcast/news accounts")
    if not resolved:
        print("no posts resolved; nothing written", file=sys.stderr)
        return 1

    teams = rosters()
    print(f"\nmatching against {len(teams)} rosters…")
    roster_union = {p["name"] for roster in teams.values() for p in roster}
    media_cache = _load_media_cache()
    authors = {}
    if AUTHORS.exists():
        try:
            authors = {k.lower(): v for k, v in json.loads(AUTHORS.read_text()).items()}
        except ValueError:
            print(f"  ! {AUTHORS.name} is not valid JSON; ignoring", file=sys.stderr)
    stats = {}
    if STATS.exists():
        try:
            stats = {k: v for k, v in json.loads(STATS.read_text()).items()
                     if not k.startswith("_")}
        except ValueError:
            print(f"  ! {STATS.name} is not valid JSON; ignoring", file=sys.stderr)
    playtimes = _playtimes()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    rejects: dict[str, str] = {}
    dropped_by_score: dict[str, str] = {}
    for owner, roster in sorted(teams.items()):
        slug = re.sub(r"[^a-z0-9]+", "-", owner.lower()).strip("-")
        if only_team and slug != only_team.lower():
            continue
        hits = []
        for post in resolved:
            # A watched note ("Player - what the footage shows") is authoritative
            # for *who* is in the clip - it was assigned by watching the video,
            # not by reading the caption. So an approved post attaches to the
            # player it names even when the tweet text never spells that name
            # ("THERE GOES JSN" -> Jaxon Smith-Njigba). Unreviewed posts still
            # fall back to naming the player in their text.
            who = reviewed_players(approved.get(post["url"], ""))
            for p in roster:
                named_by_review = p["name"] in who      # who is empty if unreviewed
                if not named_by_review and not mentions(post["text"], p["name"]):
                    continue
                if verified_only and post["url"] not in approved:
                    break
                if who and p["name"] not in who:
                    continue        # watched note names a different player
                if in_season():
                    v, detail = dated_by_scoreboard(post["url"], boards,
                                                    season_state)
                    if v not in ("current-week", "unrecorded"):
                        dropped_by_score[post["url"]] = f"{v}: {detail}"
                        break
                if post["url"] in approved:
                    ok, why = True, ""      # watched and confirmed
                elif not highlights_only:
                    ok, why = True, ""
                else:
                    ok, why = is_highlight(post["text"], p["name"], roster_union)
                if not ok:
                    rejects[post["url"]] = f"{p['name']}: {why}"
                    break
                hits.append({"url": post["url"], "player": p["name"],
                             "meta": f"{p['position']} · {p['team']}",
                             "date": post["date"], "author": post["author"],
                             "text": post.get("text", ""),
                             "verified": post["url"] in approved,
                             "faves": post.get("faves", 0),
                             "secs": post.get("secs", 0)})
                break            # one post is filed under one player
        hits = dedupe(hits, media_cache)[:MAX_PER_TEAM]
        pos_of = {p["name"]: p.get("position") for p in roster}
        used_pt: dict = {}
        for h in hits:                    # only for what actually ships
            # A shared clip ("QB to WR") credits both in its note; on a team that
            # rosters both, label the card with both, skill player first, so the
            # fantasy-relevant name leads instead of the QB burying the receiver.
            who = [w for w in reviewed_players(approved.get(h["url"], ""))
                   if w in pos_of]
            if len(who) > 1:
                who.sort(key=lambda n: (pos_of.get(n) == "QB", n))
                h["player"] = " & ".join(who)
            h.update(media(h["url"], media_cache))
            # attach the real game timestamp (Q + clock) from nflverse; consume
            # per player so a player's multiple clips get successive plays.
            lst = playtimes.get(playtime_key(h.get("player", "")), [])
            i = used_pt.get(h["player"], 0)
            if i < len(lst):
                p = lst[i]
                h["game_time"] = f"Q{p['q']} {p['clock']}"
                h["kickoff"] = p.get("start", "")
                used_pt[h["player"]] = i + 1
            st = stats.get(h["url"].rsplit("/", 1)[-1])
            if st:
                h["stats"] = st
            a = authors.get((h.get("author") or "").lower())
            if a:
                h["author_name"] = a.get("name") or h["author"]
                h["avatar"] = a.get("avatar") or ""
                h["author_verified"] = bool(a.get("verified"))
        feed = {"team": owner,
                "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "note": "Curated: X has no public search API, so posts are "
                        "collected by hand and matched to rosters by this script.",
                "tweets": hits}
        players = len({h["player"] for h in hits})
        print(f"  {slug:<22} {len(hits):>2} posts  {players:>2} players")
        if not dry_run:
            (OUT_DIR / f"{slug}.json").write_text(json.dumps(feed, indent=2) + "\n")
            written += 1
    if dropped_by_score:
        print(f"\nscoreboard dating dropped {len(dropped_by_score)} posts:")
        for url, why in sorted(dropped_by_score.items(), key=lambda kv: kv[1]):
            print(f"  - {why:<44} {url}")
    if rejects:
        print(f"\nrejected {len(rejects)} posts that named a player but showed "
              f"no play by him:")
        for url, why in sorted(rejects.items(), key=lambda kv: kv[1]):
            print(f"  - {why:<44} {url}")
    MEDIA_CACHE.write_text(json.dumps(media_cache, indent=1, sort_keys=True) + "\n")
    print(f"\n{'dry run - nothing written' if dry_run else f'wrote {written} feeds to {OUT_DIR}'}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pool", nargs="?", help="file of candidate X post URLs")
    ap.add_argument("--capture", type=Path,
                    help="JSON harvested from X timeline responses; skips oembed")
    ap.add_argument("--team", help="only rebuild this team's feed (slug)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--any-post", action="store_true",
                    help="keep text-only posts too (default: video posts only)")
    ap.add_argument("--verified-only", action="store_true",
                    help="emit only posts watched and confirmed in "
                         "highlights_reviewed.json (what ships)")
    ap.add_argument("--any-mention", action="store_true",
                    help="keep posts that merely name the player (default: the "
                         "post must describe a play by him)")
    a = ap.parse_args()
    urls = []
    if a.pool:
        urls = [l.strip() for l in Path(a.pool).read_text().splitlines()
                if l.strip() and not l.startswith("#")]
    return build(urls, a.team, a.dry_run, video_only=not a.any_post,
                 highlights_only=not a.any_mention, capture=a.capture,
                 verified_only=a.verified_only)


if __name__ == "__main__":
    raise SystemExit(main())
