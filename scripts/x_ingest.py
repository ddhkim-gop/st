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
# yt_fetch.py's team Shorts: same record shape, plus "youtube" (video id).
YT_STORE = Path.home() / "Library" / "Caches" / "fantasy-football" / "yt" / "posts.json"
OEMBED = HERE / ".highlights_oembed_cache.json"
MEDIA = HERE / ".highlights_media_cache.json"
VIDEO = HERE / ".highlights_video_cache.json"
REVIEWED = HERE / "highlights_reviewed.json"
POOL = HERE / "highlights_pool.txt"
AUTHORS = HERE / "highlights_authors.json"
DAYS = 8
TD_CUE = re.compile(r"touchdown|\btd\b|end ?zone|pay ?dirt|six\b|6️⃣|to the house|house call", re.I)


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


def latest_td(summ: dict, at: datetime, team: str, minutes: int = 15,
              only: bool = False) -> dict | None:
    """The team's last touchdown in the `minutes` before its own post. With
    `only`, None unless it is the team's ONLY touchdown in that span - a Short
    lands 10-45 minutes after its play, long enough for a second score."""
    best, n = None, 0
    for pl in summ.get("plays") or []:
        t = pl["text"].lower()
        if "touchdown" not in t or "nullified" in t or "no play" in t:
            continue
        if pl.get("off") != E._team(team):
            continue
        w = _ts(pl["wall"])
        if at - timedelta(minutes=minutes) <= w <= at + timedelta(minutes=1):
            best, n = pl, n + 1
    return None if only and n != 1 else best


def handle_names(text: str, union: list[str]) -> list[str]:
    """Players tagged by X handle rather than named: "@lutherburden3" is
    Luther Burden. A handle counts when it contains the player's full name
    run together (8+ letters, so short names can't match by accident)."""
    out = []
    for h in re.findall(r"[@#](\w{4,})", text):         # @lutherburden3, #kylemonangai
        hl = h.lower()
        for n in union:
            key = re.sub(r"[^a-z]", "", " ".join(
                x for x in n.lower().split() if x not in {"jr", "jr.", "sr", "ii", "iii", "iv"}))
            if len(key) >= 8 and key in hl:
                out.append(n)
    return out


def td_just_before(summ: dict, team: str, at: datetime) -> dict | None:
    """A team's post with no name and no TD word ("Got 'emmmmmmm 😏"), made
    within 2.5 minutes after that team scored, is that touchdown: between a TD
    and the next snap come the PAT, the kickoff and a commercial break."""
    best = None
    for pl in summ.get("plays") or []:
        t = pl["text"]
        if "TOUCHDOWN" not in t or "NULLIFIED" in t or pl.get("off") != E._team(team):
            continue
        w = _ts(pl["wall"])
        if timedelta(0) <= at - w <= timedelta(seconds=150):
            best = pl
    return best


def named_td_before(summ: dict, names: list[str], at: datetime,
                    minutes: int = 15) -> dict | None:
    """The named player's touchdown in the 15 minutes before a team post: a
    shout-out ("Case Keenum, ladies and gentlemen") trails the score by a few
    minutes, and his later snaps are rarely what gets posted."""
    pats = [r for r in (E._pbp_name_re(n) for n in names) if r]
    best = None
    for pl in summ.get("plays") or []:
        t = pl["text"]
        if "TOUCHDOWN" not in t or "NULLIFIED" in t:
            continue
        w = _ts(pl["wall"])
        if at - timedelta(minutes=minutes) <= w <= at + timedelta(minutes=1) and \
                any(r.search(t.split("TOUCHDOWN")[0]) for r in pats):
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


TWO_PT = re.compile(r"two[- ]point|2[- ]?point|2[- ]?pt\b|2-pointer", re.I)
_EMOJI_ETC = re.compile(r"[#@]\w+|[^\w\s']", re.U)


def other_first_name(text: str, name: str) -> bool:
    """True when the post names someone else with this surname: "Brian
    Robinson gets in the end zone" is not Bijan Robinson. Only a Titlecase
    word counts as a first name - "KING HENRY" is still Derrick Henry."""
    parts = [x for x in name.split() if x.lower().strip(".") not in {"jr", "sr", "ii", "iii", "iv"}]
    if len(parts) < 2:
        return False
    first, last = parts[0], parts[-1]
    for m in re.finditer(rf"\b([A-Z][a-z]+)\.?\s+{re.escape(last)}\b", text):
        if m.group(1).lower() not in {first.lower(), first.lower()[:1]}:
            return True
    return False


# What team accounts call a player instead of his name ("CMC finds his way 💪").
NICKNAMES = {"cmc": "Christian McCaffrey", "arsb": "Amon-Ra St. Brown",
             "jsn": "Jaxon Smith-Njigba", "ajb": "A.J. Brown"}


# First names that are everyday words ("this WILL be fun", "the CHASE is on").
_WORD_NAMES = {"will", "mark", "chase", "grant", "hunter", "miles", "frank", "drew",
               "rich", "king", "sage", "chance", "major", "price", "trey"}


def team_short_names(text: str, union: list[str], team_of: dict, team: str) -> list[str]:
    """Rostered players a team account names by nickname, or by a first name
    ("TYQUAN TD!!!", "TD THEOOO") that no other rostered player on that team
    shares. Only a play that player actually made can then be matched."""
    t = text.lower()
    out = [n for k, n in NICKNAMES.items() if n in union and re.search(rf"\b{k}\b", t)]
    mine = [n for n in union if E._team(team_of.get(n)) == E._team(team)]
    firsts: dict[str, list[str]] = {}
    for n in mine:
        f = n.split()[0].lower().rstrip(".")
        if len(f) >= 4:
            firsts.setdefault(f, []).append(n)
    for f, ns in firsts.items():
        if len(ns) == 1 and f not in _WORD_NAMES and \
                re.search(rf"\b{re.escape(f)}{re.escape(f[-1])}*\b", t):   # THEOOO
            out.append(ns[0])
    return out


def name_only(text: str, names: list[str]) -> bool:
    """A post that is the player's name and little else ("LUTHER BURDEN
    😤😤"): once the names, tags and emoji are gone, two words or fewer."""
    t = _EMOJI_ETC.sub(" ", text)
    for n in names:
        for part in n.split():
            t = re.sub(rf"\b{re.escape(part)}\b", " ", t, flags=re.I)
    return len(t.split()) <= 2


FOOTAGE = Path.home() / "Library" / "Caches" / "fantasy-football" / "footage.json"


def field_share(src: str) -> list[float] | None:
    """Share of each sampled frame (one a second) that looks like a football
    field. None if the video couldn't be read."""
    import colorsys
    import subprocess
    try:
        r = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", src, "-vf", "fps=1,scale=48:48",
                            "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           capture_output=True, timeout=180, stdin=subprocess.DEVNULL)
    except Exception:
        return None
    b, fs = r.stdout, 48 * 48 * 3
    if r.returncode or len(b) < fs:
        return None
    out = []
    for i in range(0, len(b) - fs + 1, fs):
        g = 0
        for j in range(i, i + fs, 3):
            h, s, v = colorsys.rgb_to_hsv(b[j] / 255, b[j + 1] / 255, b[j + 2] / 255)
            # Any turf green, washed-out included (MetLife's reads gray-green).
            # A green team graphic (Jets "FG") can pass; a dropped play is worse.
            g += 0.15 <= h <= 0.5 and s >= 0.12 and 0.15 <= v <= 0.9
        out.append(g / (48 * 48))
    return out


def has_footage(p: dict, cache: dict) -> bool:
    """False for a team's graphic - "TOUCHDOWN / THORNTON" title cards, a
    "FIRST DOWN" bumper, a posted fit pic - which shows no field in any frame.
    A play shows the field for seconds. X posts only: their mp4s download
    directly, while reading a Short's frames takes a YouTube request per video
    (300 in a row got this Mac bot-checked, 2026-10-04) and a vertical crop
    hides most of the field. Verdicts are cached per post; one that can't be
    read is let through and tried again next run."""
    key = p["url"]
    if p.get("youtube") or not p.get("video"):
        return True
    if key in cache:
        return cache[key]
    shares = field_share(p["video"])
    if shares is None:
        return True
    cache[key] = sum(s >= 0.08 for s in shares) >= 2
    FOOTAGE.write_text(json.dumps(cache))     # saved as it goes: a first pass is slow
    return cache[key]

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    posts = {**_load(STORE, {}), **{"yt:" + k: v for k, v in _load(YT_STORE, {}).items()}}
    if not posts:
        print("x_ingest: no collected X/YouTube posts")
        return 0
    teams = rosters()
    union = sorted({p["name"] for r in teams.values() for p in r})
    team_of = {p["name"]: p.get("team") for r in teams.values() for p in r}
    games = Games(E.current_week())

    oe, mc, vc = _load(OEMBED, {}), _load(MEDIA, {}), _load(VIDEO, {})
    rv, authors = _load(REVIEWED, {}), _load(AUTHORS, {})
    footage = _load(FOOTAGE, {})
    keep, reject = rv.setdefault("keep", {}), rv.get("reject", {})
    pool = {u for u in POOL.read_text().split() if u.startswith("http")} \
        if POOL.exists() else set()     # URLs only, never stray words

    since = datetime.now(timezone.utc) - timedelta(days=DAYS)
    added = approved = 0
    accepted: set[str] = set()
    for p in sorted(posts.values(), key=lambda x: x["created"]):
        url, text, at = p["url"], p["text"], _ts(p["created"])
        if at < since or url in reject or E.NEGATIVE_RE.search(text):
            continue
        who = sorted(set(n for n in union if mentions(text, n)) | set(handle_names(text, union))
                     | (set(team_short_names(text, union, team_of, p["team"])) if p.get("team") else set()))
        if p.get("team"):                   # a team account posts its own players
            who = [n for n in who if E._team(team_of.get(n)) == E._team(p["team"])]
        who = [n for n in who if not other_first_name(text, n)]
        if TWO_PT.search(text) and not TD_CUE.search(text):
            who = []                        # the conversion, not the touchdown
        team = p.get("team") or (team_of.get(who[0]) if who else "")
        summ = games.for_team(team, at) if team else {}
        loc = {}
        yt = bool(p.get("youtube"))
        if summ and who:
            loc = E.match_play(text, who, summ, p["created"])
            if not loc.get("play_key") and p.get("team"):
                # A Short trails its play by 10-45 min: only the named
                # player's TD is safe to pin that far back, not "his last snap".
                # ...and only when the Short says TD or is little but his name
                # ("Aaron Jones Sr. 🤝 Antoine Winfield Jr." is not a play).
                # Otherwise a Short of him within 20 min of his own TD is that TD
                # (49ers "CMC finds his way 💪", 11 min after his score).
                pl = ((named_td_before(summ, who, at, minutes=45)
                       if (TD_CUE.search(text) or name_only(text, who))
                       else named_td_before(summ, who, at, minutes=20)) if yt else
                      named_td_before(summ, who, at) or latest_play_naming(summ, who, at))
                if pl:
                    loc = {"played_at": pl["wall"], "game_time": f"Q{pl['q']} {pl['clock']}",
                           "play_key": f"{summ['id']}:{pl['id']}", "game_id": summ["id"]}
        elif summ and p.get("team"):
            if yt:
                pl = latest_td(summ, at, p["team"], minutes=45, only=True) \
                    if TD_CUE.search(text) else None
            else:
                pl = (latest_td(summ, at, p["team"]) if TD_CUE.search(text)
                      else td_just_before(summ, p["team"], at))
            if pl:
                loc = {"played_at": pl["wall"], "game_time": f"Q{pl['q']} {pl['clock']}",
                       "play_key": f"{summ['id']}:{pl['id']}", "game_id": summ["id"]}
        loc.pop("ambiguous", None)
        # A clip goes up soon after its play: a Short 10-45 min, an X post
        # minutes. One posted hours later ("Aaron Jones Sr. 🤝 Antoine Winfield
        # Jr.", 3h48m after the run it matched) is a moment, not that play.
        if loc.get("played_at") and at - _ts(loc["played_at"]) > timedelta(
                minutes=60 if yt else 45):
            loc = {}
        if loc.get("play_key"):
            named_last = {n.split()[-1].lower(): n for n in who}
            extra = [n for n in rostered_in_play(summ, loc["play_key"], union, team_of)
                     # ESPN's "B.Robinson" is Bijan and Brian alike: a same-surname
                     # teammate the post did not name is not added.
                     if n in who or n.split()[-1].lower() not in named_last]
            who = sorted(set(who) | set(extra))
        if not who or not has_footage(p, footage):
            continue
        accepted.add(url)
        added += url not in pool
        pool.add(url)
        oe[url] = {"url": url, "author": p["handle"],
                   "author_url": (f"https://www.youtube.com/@{p['handle']}" if yt
                                  else f"https://x.com/{p['handle']}"), "text": text,
                   "date": p["created"][:10], "faves": p.get("faves", 0),
                   "secs": p.get("secs", 0)}
        media = {"youtube": p["youtube"]} if yt else {"video": p["video"]}
        mc[url] = {**media, **({"poster": p["poster"]} if p.get("poster") else {}),
                   "published": p["created"], **loc}
        vc[url] = True
        authors[p["handle"]] = {"name": p.get("name") or p["handle"],
                                "avatar": p.get("avatar") or "",
                                "verified": bool(p.get("verified"))}
        note = f"{' & '.join(who)} - {text[:110]} (auto: {'YouTube' if yt else 'X'})"
        if loc.get("play_key") and (url not in keep or str(keep[url]).endswith(
                ("(auto: X)", "(auto: YouTube)"))):
            approved += keep.get(url) != note
            keep[url] = note
        elif not loc.get("play_key") and str(keep.get(url, "")).endswith(
                ("(auto: X)", "(auto: YouTube)")):
            keep.pop(url)                   # no longer tied to a play
        if a.dry_run:
            print(f"  {p['created'][5:16]} @{p['handle']:<14} {loc.get('game_time','--'):9} "
                  f"{' & '.join(who)[:30]:30} | {text[:50]}")

    # Posts this script filed before but no longer accepts (a rule tightened,
    # e.g. the Brian/Bijan Robinson fix) come back out, auto-approval included -
    # left in the pool, the builder's own surname match would re-file them.
    owned = {p["url"] for p in posts.values()}
    dropped = 0
    for url in owned - accepted:
        if url in pool or str(keep.get(url, "")).endswith(("(auto: X)", "(auto: YouTube)")):
            pool.discard(url)
            if str(keep.get(url, "")).endswith(("(auto: X)", "(auto: YouTube)")):
                keep.pop(url)
            dropped += 1
    # A stale auto-approval whose credit changed is rewritten, not kept.
    print(f"x_ingest: {len(posts)} collected, {added} new to this league, "
          f"{approved} tied to a play and approved, {dropped} withdrawn")
    FOOTAGE.write_text(json.dumps(footage))      # shared by all leagues
    if a.dry_run:
        return 0
    for path, val in ((OEMBED, oe), (MEDIA, mc), (VIDEO, vc), (AUTHORS, authors)):
        path.write_text(json.dumps(val, indent=1, sort_keys=True) + "\n")
    REVIEWED.write_text(json.dumps(rv, indent=1, ensure_ascii=False) + "\n")
    POOL.write_text("\n".join(sorted(pool)) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
