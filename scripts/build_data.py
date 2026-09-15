#!/usr/bin/env python3
"""
Full data builder for the ST league site.

Fetches everything from the Sleeper API for all 7 seasons and writes a complete
data.js (window.__STATIC_DATA__) plus per-year data/{year}/{matchups,rosters,
player_season_stats}.json files.

Run from the repo root:  python3 scripts/build_data.py
"""

import json, os, sys, time
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request

# ── League IDs (year -> Sleeper league id) ───────────────────────────────────
LEAGUES = {
    "2024": "1091752429168721920",
    "2025": "1263976130885459968",
    "2026": "1400268451699818496",
}
YEARS = sorted(LEAGUES.keys())
CURRENT_YEAR = "2026"
CURRENT_LEAGUE = LEAGUES[CURRENT_YEAR]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(ROOT, "data.js")
DATA_DIR = os.path.join(ROOT, "data")
PLAYERS_CACHE = os.path.join(ROOT, "scripts", "players_cache.json")

PT = timezone(timedelta(hours=-8))

# ── HTTP ─────────────────────────────────────────────────────────────────────
def fetch(url, retries=3):
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "st-build/1.0"})
            with urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt == retries - 1:
                print(f"  WARN: failed {url}: {e}", file=sys.stderr)
                return None
            time.sleep(2 ** attempt)

_OFF_ORDER = ["QB", "RB", "WR", "TE", "K", "FB"]
def fmt_pos(p):
    positions = (p.get("fantasy_positions") or [])[:2]
    if not positions:
        return p.get("position", "?")
    sp = sorted(positions, key=lambda x: _OFF_ORDER.index(x) if x in _OFF_ORDER else 99)
    return "/".join(sp)

def fmt_ts(ms):
    dt = datetime.fromtimestamp(ms / 1000, tz=PT)
    hour = dt.hour % 12 or 12
    ampm = "AM" if dt.hour < 12 else "PM"
    return dt.strftime(f"%b %d, %Y • {hour}:%M {ampm} PT").replace(" 0", " ")

def full_name(p):
    return p.get("full_name") or (p.get("first_name", "") + " " + p.get("last_name", "")).strip()

def age_from(birth):
    if not birth:
        return None
    try:
        bd = datetime.strptime(birth, "%Y-%m-%d")
        t = datetime.now()
        return t.year - bd.year - ((t.month, t.day) < (bd.month, bd.day))
    except ValueError:
        return None

# ── Players DB (cached 24h) ──────────────────────────────────────────────────
def load_players():
    try:
        with open(PLAYERS_CACHE) as f:
            cached = json.load(f)
        age_h = (datetime.now() - datetime.fromisoformat(cached["fetched"])).total_seconds() / 3600
        if age_h < 24:
            print(f"  players cache {age_h:.1f}h old, reusing ({len(cached['players'])})")
            return cached["players"]
    except (FileNotFoundError, KeyError, ValueError):
        pass
    print("  fetching Sleeper players (~20MB)...")
    players = fetch("https://api.sleeper.app/v1/players/nfl") or {}
    if players:
        os.makedirs(os.path.dirname(PLAYERS_CACHE), exist_ok=True)
        with open(PLAYERS_CACHE, "w") as f:
            json.dump({"fetched": datetime.now().isoformat(), "players": players}, f)
        print(f"  cached {len(players)} players")
    return players

# ── Per-league raw bundle ─────────────────────────────────────────────────────
def load_league(year, lid):
    print(f"[{year}] fetching league {lid}")
    meta    = fetch(f"https://api.sleeper.app/v1/league/{lid}") or {}
    users   = fetch(f"https://api.sleeper.app/v1/league/{lid}/users") or []
    rosters = fetch(f"https://api.sleeper.app/v1/league/{lid}/rosters") or []
    uid_name = {u["user_id"]: u.get("display_name", "Unknown") for u in users}
    rid_name = {r["roster_id"]: uid_name.get(r.get("owner_id"), "Unknown") for r in rosters}

    status = meta.get("status")
    completed = status == "complete"
    pw_start = (meta.get("settings") or {}).get("playoff_week_start", 15)

    # Matchups (only meaningful once games exist)
    matchups = {}
    if status in ("complete", "in_season", "post_season"):
        for wk in range(1, 19):
            m = fetch(f"https://api.sleeper.app/v1/league/{lid}/matchups/{wk}")
            if m:
                matchups[wk] = m
            time.sleep(0.05)

    # Drafts
    drafts = fetch(f"https://api.sleeper.app/v1/league/{lid}/drafts") or []
    draft_obj = drafts[0] if drafts else None
    draft_picks = []
    if draft_obj:
        draft_picks = fetch(f"https://api.sleeper.app/v1/draft/{draft_obj['draft_id']}/picks") or []

    # Brackets
    wb = fetch(f"https://api.sleeper.app/v1/league/{lid}/winners_bracket") or []
    lb = fetch(f"https://api.sleeper.app/v1/league/{lid}/losers_bracket") or []

    # Transactions
    txns_raw = {}
    for wk in range(0, 19):
        t = fetch(f"https://api.sleeper.app/v1/league/{lid}/transactions/{wk}")
        if t:
            txns_raw[wk] = t
        time.sleep(0.05)

    return {
        "year": year, "lid": lid, "meta": meta, "status": status, "completed": completed,
        "pw_start": pw_start, "users": users, "rosters": rosters,
        "uid_name": uid_name, "rid_name": rid_name, "matchups": matchups,
        "draft_obj": draft_obj, "draft_picks": draft_picks,
        "winners_bracket": wb, "losers_bracket": lb, "txns_raw": txns_raw,
    }

# ── Section builders ──────────────────────────────────────────────────────────
def build_draft(lg, players):
    """Return list of pick dicts matching GoP draft shape (+ is_keeper).

    Slot ownership is authoritative via slot_to_roster_id when present; otherwise
    we fall back to draft_order (user_id -> slot). This league's historical drafts
    have no slot_to_roster_id and their per-pick `picked_by` is unreliable (e.g.
    2020 pick 6 is attributed to ddhk though draft_order owns it to youngli), so we
    derive the owner from draft_order and only flag a pick as traded when the
    authoritative slot map disagrees with the selector.
    """
    draft = lg["draft_obj"]
    if not draft or not lg["draft_picks"]:
        return []
    slot_to_rid = {int(k): v for k, v in (draft.get("slot_to_roster_id") or {}).items()}
    draft_order = draft.get("draft_order") or {}        # user_id -> slot
    slot_to_uid = {slot: uid for uid, slot in draft_order.items()}
    out = []
    for pk in lg["draft_picks"]:
        meta = pk.get("metadata") or {}
        pid = pk.get("player_id")
        p = players.get(str(pid), {}) if pid else {}
        name = meta.get("first_name", "") + " " + meta.get("last_name", "")
        name = name.strip() or full_name(p) or str(pid)
        pos = meta.get("position") or fmt_pos(p)
        team = meta.get("team") or p.get("team")
        slot = pk.get("draft_slot")
        if slot in slot_to_rid:
            # Reliable slot->roster map: trust picked_by as the selector.
            owner = lg["rid_name"].get(slot_to_rid[slot])
            selector = lg["uid_name"].get(pk.get("picked_by")) or owner
        else:
            # No slot map -> draft_order owns the slot; picked_by not trustworthy.
            # A slot missing from draft_order = a since-deleted manager (e.g. 2024
            # slot 6). Attribute ALL its picks to "Unknown" consistently rather than
            # scattering them via the unreliable picked_by field.
            uid = slot_to_uid.get(slot)
            owner = (lg["uid_name"].get(uid) if uid else None) or "Unknown"
            selector = owner
        original_owner = owner or "Unknown"
        picked_by = selector or original_owner
        out.append({
            "pick_no": pk.get("pick_no"),
            "round": pk.get("round"),
            "player": name,
            "position": pos,
            "team": team,
            "picked_by": picked_by,
            "original_owner": original_owner,
            "traded": bool(original_owner and picked_by and original_owner != picked_by),
            "is_keeper": bool(pk.get("is_keeper")),
            "birth_date": p.get("birth_date"),
        })
    out.sort(key=lambda x: x["pick_no"] or 0)
    return out

def build_rosters(lg, players):
    out = []
    for r in lg["rosters"]:
        owner = lg["rid_name"].get(r["roster_id"], "Unknown")
        plist = []
        for pid in (r.get("players") or []):
            p = players.get(str(pid), {})
            if not p:
                continue
            plist.append({
                "player_id": str(pid),
                "espn_id": p.get("espn_id"),
                "name": full_name(p),
                "position": fmt_pos(p),
                "team": p.get("team"),
                "birth_date": p.get("birth_date"),
                "college": p.get("college"),
                "height": p.get("height"),
                "weight": p.get("weight"),
                "years_exp": p.get("years_exp"),
                "status": p.get("status"),
                "injury_status": p.get("injury_status"),
                "search_rank": p.get("search_rank"),
            })
        out.append({"owner": owner, "roster_id": r["roster_id"], "players": plist})
    return out

def roster_record(r):
    s = r.get("settings") or {}
    pf = s.get("fpts", 0) + s.get("fpts_decimal", 0) / 100
    pa = s.get("fpts_against", 0) + s.get("fpts_against_decimal", 0) / 100
    return {
        "wins": s.get("wins", 0), "losses": s.get("losses", 0), "ties": s.get("ties", 0),
        "pf": round(pf, 2), "pa": round(pa, 2),
    }

def build_standings(lg):
    rows = []
    for r in lg["rosters"]:
        rec = roster_record(r)
        rows.append({
            "name": lg["rid_name"].get(r["roster_id"], "Unknown"),
            "wins": rec["wins"], "losses": rec["losses"],
            "pf": rec["pf"], "pa": rec["pa"],
        })
    rows.sort(key=lambda x: (-x["wins"], -x["pf"]))
    return rows

def week_points(lg):
    """week -> {roster_id: points}"""
    wp = {}
    for wk, ms in lg["matchups"].items():
        wp[wk] = {m["roster_id"]: m.get("points") for m in ms}
    return wp

def build_bracket(raw_bracket, lg, wp):
    """Resolve Sleeper bracket into GoP-shaped match list with names + points."""
    out = []
    for m in raw_bracket:
        rnd = m.get("r")
        wk = lg["pw_start"] + (rnd - 1) if rnd else None
        t1, t2 = m.get("t1"), m.get("t2")
        w, l = m.get("w"), m.get("l")
        pts = wp.get(wk, {}) if wk else {}
        row = {
            "match": m.get("m"),
            "round": rnd,
            "team1": lg["rid_name"].get(t1) if t1 else None,
            "team2": lg["rid_name"].get(t2) if t2 else None,
            "winner": lg["rid_name"].get(w) if w else None,
            "loser": lg["rid_name"].get(l) if l else None,
            "team1_pts": pts.get(t1),
            "team2_pts": pts.get(t2),
        }
        if m.get("p") is not None:
            row["place"] = m.get("p")
        out.append(row)
    out.sort(key=lambda x: (x["round"] or 0, x["match"] or 0))
    return out

def build_season_history(lg, standings, wb, lb):
    champion = None
    for m in wb:
        if m.get("place") == 1 and m.get("winner"):
            champion = m["winner"]
            break
    ranked = [dict(row, rank=i + 1) for i, row in enumerate(standings)]
    return {
        "champion": champion,
        "standings": ranked,
        "winners_bracket": wb,
        "losers_bracket": lb,
    }

def build_transactions(lg, players):
    txns = []
    season = lg["year"]
    rid_name = lg["rid_name"]
    for wk, raw in lg["txns_raw"].items():
        for t in raw:
            if t.get("status") not in ("complete", "failed"):
                continue
            tx_type = t.get("type", "free_agent")
            rids = t.get("roster_ids") or []
            teams = [rid_name.get(r, "Unknown") for r in rids]
            adds_raw = t.get("adds") or {}
            drops_raw = t.get("drops") or {}
            if tx_type == "trade":
                assets = {}
                for pid, rid in adds_raw.items():
                    owner = rid_name.get(rid, "Unknown")
                    p = players.get(str(pid), {})
                    assets.setdefault(owner, []).append({
                        "name": full_name(p) or str(pid),
                        "position": fmt_pos(p), "team": p.get("team"),
                    })
                for pick in (t.get("draft_picks") or []):
                    recv = rid_name.get(pick.get("owner_id"), "Unknown")
                    orig = rid_name.get(pick.get("roster_id"), None)
                    assets.setdefault(recv, []).append({
                        "name": f"{pick.get('season','?')} Round {pick.get('round','?')}",
                        "position": "PICK", "team": None, "original_owner": orig,
                    })
                for wb_ in (t.get("waiver_budget") or []):
                    recv = rid_name.get(wb_.get("receiver"), "Unknown")
                    assets.setdefault(recv, []).append({
                        "name": f"${wb_['amount']} FAAB", "position": "FAAB", "team": None,
                    })
                txns.append({
                    "season": season, "week": t.get("leg", 0), "created": fmt_ts(t["created"]),
                    "transaction_id": t["transaction_id"], "type": "trade",
                    "status": t.get("status", "complete"), "teams": teams,
                    "assets_received": assets,
                })
            else:
                added = [{"name": full_name(players.get(str(pid), {})) or str(pid),
                          "position": fmt_pos(players.get(str(pid), {})),
                          "team": players.get(str(pid), {}).get("team")} for pid in adds_raw]
                dropped = [{"name": full_name(players.get(str(pid), {})) or str(pid),
                            "position": fmt_pos(players.get(str(pid), {})),
                            "team": players.get(str(pid), {}).get("team")} for pid in drops_raw]
                settings = t.get("settings") or {}
                wbg = t.get("waiver_budget") or []
                txns.append({
                    "season": season, "week": t.get("leg", 0), "created": fmt_ts(t["created"]),
                    "transaction_id": t["transaction_id"], "type": tx_type,
                    "status": t.get("status", "complete"),
                    "teams": [rid_name.get(rids[0], "Unknown")] if rids else teams,
                    "added": added, "dropped": dropped,
                    "faab": wbg[0]["amount"] if wbg else 0,
                    "waiver_bid": settings.get("waiver_bid", 0),
                    "notes": (t.get("metadata") or {}).get("notes"),
                })
    return txns

def build_h2h_for_season(lg):
    """name -> {opp: {wins,losses,ties,pf,pa}} for regular-season games only."""
    h2h = {}
    def rec(a, b):
        return h2h.setdefault(a, {}).setdefault(b, {"wins": 0, "losses": 0, "ties": 0, "pf": 0.0, "pa": 0.0})
    for wk, ms in lg["matchups"].items():
        if wk >= lg["pw_start"]:
            continue
        by_mid = {}
        for m in ms:
            by_mid.setdefault(m.get("matchup_id"), []).append(m)
        for mid, pair in by_mid.items():
            if mid is None or len(pair) != 2:
                continue
            a, b = pair
            na = lg["rid_name"].get(a["roster_id"], "Unknown")
            nb = lg["rid_name"].get(b["roster_id"], "Unknown")
            pa_, pb = a.get("points") or 0, b.get("points") or 0
            ra, rb = rec(na, nb), rec(nb, na)
            ra["pf"] += pa_; ra["pa"] += pb
            rb["pf"] += pb; rb["pa"] += pa_
            if pa_ > pb:
                ra["wins"] += 1; rb["losses"] += 1
            elif pb > pa_:
                rb["wins"] += 1; ra["losses"] += 1
            else:
                ra["ties"] += 1; rb["ties"] += 1
    # round pf/pa
    for a in h2h.values():
        for d in a.values():
            d["pf"] = round(d["pf"], 2); d["pa"] = round(d["pa"], 2)
    return h2h

def merge_h2h(agg, season):
    for a, opps in season.items():
        for b, d in opps.items():
            t = agg.setdefault(a, {}).setdefault(b, {"wins": 0, "losses": 0, "ties": 0, "pf": 0.0, "pa": 0.0})
            t["wins"] += d["wins"]; t["losses"] += d["losses"]; t["ties"] += d["ties"]
            t["pf"] = round(t["pf"] + d["pf"], 2); t["pa"] = round(t["pa"] + d["pa"], 2)

def build_matchups_file(lg, players):
    """week -> [{matchup_id, teams:[{owner, roster_id, points, starters:[...]}]}]"""
    out = {}
    for wk, ms in lg["matchups"].items():
        by_mid = {}
        for m in ms:
            starters = []
            for pid in (m.get("starters") or []):
                if not pid or pid == "0":
                    continue
                p = players.get(str(pid), {})
                pts = (m.get("starters_points") or [])
                idx = (m.get("starters") or []).index(pid)
                pt = pts[idx] if idx < len(pts) else None
                starters.append({
                    "player_id": str(pid), "name": full_name(p),
                    "position": p.get("position"), "nfl_team": p.get("team"), "points": pt,
                })
            by_mid.setdefault(m.get("matchup_id"), []).append({
                "owner": lg["rid_name"].get(m["roster_id"], "Unknown"),
                "roster_id": m["roster_id"], "points": m.get("points"), "starters": starters,
            })
        out[str(wk)] = [{"matchup_id": mid, "teams": teams} for mid, teams in sorted(by_mid.items(), key=lambda kv: (kv[0] is None, kv[0]))]
    return out

def build_player_stats(year, players):
    raw = fetch(f"https://api.sleeper.app/v1/stats/nfl/regular/{year}")
    if not raw:
        return {}
    rows = {}
    for pid, st in raw.items():
        pts = st.get("pts_ppr")   # full-PPR league; key name below kept for the frontend
        if pts is None:
            continue
        p = players.get(str(pid), {})
        rows[str(pid)] = {"position": p.get("position"), "pts_half_ppr": pts}
    # rank within position
    by_pos = {}
    for pid, r in rows.items():
        by_pos.setdefault(r["position"], []).append(pid)
    for pos, pids in by_pos.items():
        pids.sort(key=lambda x: rows[x]["pts_half_ppr"], reverse=True)
        for i, pid in enumerate(pids):
            rows[pid]["rank"] = i + 1
    return rows

# ── Inject helper (for writing data.js) ───────────────────────────────────────
def write_data_js(data):
    body = json.dumps(data, indent=2, ensure_ascii=False)
    with open(DATA_JS, "w") as f:
        f.write("window.__STATIC_DATA__ = " + body + ";\n")
    print(f"  wrote {DATA_JS} ({os.path.getsize(DATA_JS)//1024} KB)")

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("Loading players...")
    players = load_players()
    if not players:
        print("ERROR: no players", file=sys.stderr); sys.exit(2)

    leagues = {y: load_league(y, LEAGUES[y]) for y in YEARS}
    cur = leagues[CURRENT_YEAR]

    # Canonicalize: a user can rename across seasons (e.g. paulsfather -> edgxrjiang).
    # Map every user_id to their most-recent display name and rewrite all name maps
    # so standings / drafts / H2H / season history use one consistent identity.
    uid_canonical = {}
    for y in YEARS:  # ascending -> latest year wins
        for u in leagues[y]["users"]:
            uid_canonical[u["user_id"]] = u.get("display_name", "Unknown")
    for y in YEARS:
        lg = leagues[y]
        lg["uid_name"] = {uid: uid_canonical.get(uid, nm) for uid, nm in lg["uid_name"].items()}
        lg["rid_name"] = {r["roster_id"]: uid_canonical.get(r.get("owner_id"), "Unknown")
                          for r in lg["rosters"]}

    draft = {}
    standings = {}
    season_history = {}
    divisions = {}
    all_txns = []
    h2h_all = {}
    h2h_seasons = {}

    for y in YEARS:
        lg = leagues[y]
        wp = week_points(lg)
        # draft
        dp = build_draft(lg, players)
        if dp:
            draft[y] = dp
        # standings (only if any games played)
        st = build_standings(lg)
        if any(r["wins"] or r["losses"] for r in st):
            standings[y] = st
        # season history (completed seasons w/ bracket)
        if lg["completed"] and lg["winners_bracket"]:
            wb = build_bracket(lg["winners_bracket"], lg, wp)
            lb = build_bracket(lg["losers_bracket"], lg, wp)
            season_history[y] = build_season_history(lg, st, wb, lb)
        # divisions (none in Darwinism) -> empty map per year
        divisions[y] = {}
        # transactions
        year_txns = build_transactions(lg, players)
        all_txns.extend(year_txns)
        # h2h
        season_h2h = build_h2h_for_season(lg)
        h2h_seasons[y] = season_h2h
        merge_h2h(h2h_all, season_h2h)
        # per-year files
        os.makedirs(os.path.join(DATA_DIR, y), exist_ok=True)
        with open(os.path.join(DATA_DIR, y, "matchups.json"), "w") as f:
            json.dump(build_matchups_file(lg, players), f)
        with open(os.path.join(DATA_DIR, y, "rosters.json"), "w") as f:
            json.dump(build_rosters(lg, players), f)
        with open(os.path.join(DATA_DIR, y, "player_season_stats.json"), "w") as f:
            json.dump(build_player_stats(y, players), f)
        print(f"  [{y}] draft={len(dp)} txns+={len(year_txns)} "
              f"champ={season_history.get(y,{}).get('champion')}")

    all_txns.sort(key=lambda x: int(x["transaction_id"]), reverse=True)

    # rosters / users = current league
    rosters = build_rosters(cur, players)
    users = cur["users"]

    # league_users = union across years
    active_uids = set(cur["uid_name"].keys())
    lu = {}
    for y in YEARS:
        for u in leagues[y]["users"]:
            uid = u["user_id"]
            av = u.get("avatar")
            # later seasons overwrite -> canonical name + freshest avatar
            lu[uid] = {
                "user_id": uid,
                "username": uid_canonical.get(uid, u.get("display_name", "Unknown")),
                "avatar_url": f"https://sleepercdn.com/avatars/thumbs/{av}" if av else None,
                "is_active": uid in active_uids,
            }
    league_users = list(lu.values())

    # Manual avatar overrides for managers with no Sleeper avatar.
    MANUAL_AVATARS = {
        # Managers with no Sleeper avatar -> local override image. None needed yet.
    }
    for u in league_users:
        if not u["avatar_url"] and u["username"] in MANUAL_AVATARS:
            u["avatar_url"] = MANUAL_AVATARS[u["username"]]

    # traded picks (current league)
    tp_raw = fetch(f"https://api.sleeper.app/v1/league/{CURRENT_LEAGUE}/traded_picks") or []
    traded_picks = []
    for p in tp_raw:
        traded_picks.append({
            "season": str(p.get("season", "?")), "round": p.get("round"),
            "roster_id": str(p.get("roster_id")), "owner_id": str(p.get("owner_id")),
            "previous_owner_id": str(p.get("previous_owner_id")),
            "owner_name": cur["rid_name"].get(p.get("owner_id"), "Unknown"),
            "original_owner_name": cur["rid_name"].get(p.get("roster_id"), "Unknown"),
            "previous_owner_name": cur["rid_name"].get(p.get("previous_owner_id"), "Unknown"),
        })

    # player_name_map (drafted + rostered players -> sleeper id)
    pnm = {}
    for y in YEARS:
        for pk in leagues[y]["draft_picks"]:
            pid = pk.get("player_id")
            if pid and players.get(str(pid)):
                pnm[full_name(players[str(pid)])] = str(pid)
    for r in cur["rosters"]:
        for pid in (r.get("players") or []):
            if players.get(str(pid)):
                pnm[full_name(players[str(pid)])] = str(pid)

    data = {
        "draft": draft,
        "rosters": rosters,
        "users": users,
        "years": YEARS,
        "completed_years": [y for y in YEARS if leagues[y].get("completed")],
        "league_users": league_users,
        "transactions": all_txns,
        "standings": standings,
        "head_to_head": {"seasons": h2h_seasons, "all_time": h2h_all},
        "traded_picks": traded_picks,
        "season_history": season_history,
        "divisions": divisions,
        "player_name_map": pnm,
        "player_values": {},
    }

    write_data_js(data)
    print("\nSummary:")
    print(f"  draft years: {sorted(draft.keys())}")
    print(f"  standings years: {sorted(standings.keys())}")
    print(f"  champions: " + ", ".join(f"{y}:{v['champion']}" for y, v in sorted(season_history.items())))
    print(f"  transactions: {len(all_txns)}")
    print(f"  league_users: {len(league_users)} ({sum(u['is_active'] for u in league_users)} active)")
    print(f"  traded_picks: {len(traded_picks)}")

if __name__ == "__main__":
    main()
