#!/usr/bin/env python3
"""
Auto-refresh script for Game of Phones fantasy site.
Fetches current transactions and rosters from Sleeper API,
updates data.js if anything changed.
Exit code 0 = changes written; exit code 1 = no changes.
"""

import json, re, sys, time
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError

# ── League IDs ────────────────────────────────────────────────────────────────
LEAGUES = {
    "2024": "1091752429168721920",
    "2025": "1263976130885459968",
    "2026": "1400268451699818496",
}
CURRENT_YEAR = "2026"
CURRENT_LEAGUE = LEAGUES[CURRENT_YEAR]

DATA_JS = "data.js"          # relative to repo root (script runs from there)
PLAYERS_CACHE = "scripts/players_cache.json"

PT = timezone(timedelta(hours=-8))   # Pacific Standard; close enough for display

# ── Helpers ───────────────────────────────────────────────────────────────────
def fetch(url, retries=3):
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "gameofphones-refresh/1.0"})
            with urlopen(req, timeout=20) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt == retries - 1:
                print(f"  WARN: failed to fetch {url}: {e}", file=sys.stderr)
                return None
            time.sleep(2 ** attempt)

_OFF_ORDER = ["QB", "RB", "WR", "TE", "K", "FB"]
def fmt_pos(p):
    positions = (p.get("fantasy_positions") or [])[:2]
    if not positions:
        return p.get("position", "?")
    sorted_pos = sorted(positions, key=lambda x: _OFF_ORDER.index(x) if x in _OFF_ORDER else 99)
    return "/".join(sorted_pos)

def fmt_ts(ms):
    """Convert Sleeper ms timestamp to 'Jun 07, 2026 • 11:45 PM PT'"""
    dt = datetime.fromtimestamp(ms / 1000, tz=PT)
    hour = dt.hour % 12 or 12
    ampm = "AM" if dt.hour < 12 else "PM"
    return dt.strftime(f"%b %d, %Y • {hour}:%M {ampm} PT").replace(" 0", " ")

def ordinal_round(n):
    suffix = {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")
    return suffix

# ── Load players cache (fetch from Sleeper if stale / missing) ────────────────
def load_players():
    import os
    try:
        with open(PLAYERS_CACHE) as f:
            cached = json.load(f)
        fetched_dt = datetime.fromisoformat(cached.get("fetched", "2000-01-01"))
        age_hours = (datetime.now() - fetched_dt).total_seconds() / 3600
        if age_hours < 24:
            print(f"  Using cached players ({age_hours:.1f}h old)")
            return cached["players"]
    except (FileNotFoundError, KeyError, ValueError):
        pass

    print("  Fetching Sleeper players (~20MB)...")
    players = fetch("https://api.sleeper.app/v1/players/nfl")
    if not players:
        # Fall back to stale cache
        try:
            with open(PLAYERS_CACHE) as f:
                return json.load(f)["players"]
        except Exception:
            return {}

    os.makedirs(os.path.dirname(PLAYERS_CACHE), exist_ok=True)
    with open(PLAYERS_CACHE, "w") as f:
        json.dump({"fetched": datetime.now().isoformat(), "players": players}, f)
    print(f"  Cached {len(players)} players")
    return players

# ── Build roster_id → username map ───────────────────────────────────────────
def build_roster_map(league_id):
    users_raw  = fetch(f"https://api.sleeper.app/v1/league/{league_id}/users") or []
    rosters_raw = fetch(f"https://api.sleeper.app/v1/league/{league_id}/rosters") or []

    uid_to_name = {u["user_id"]: u["display_name"] for u in users_raw}
    rid_to_name = {}
    for r in rosters_raw:
        name = uid_to_name.get(r.get("owner_id"), "Unknown")
        rid_to_name[r["roster_id"]] = name

    return rid_to_name, rosters_raw, uid_to_name

# ── Fetch + format transactions ───────────────────────────────────────────────
def fetch_transactions(league_id, season, rid_to_name, players):
    txns = []
    for week in range(0, 19):
        raw = fetch(f"https://api.sleeper.app/v1/league/{league_id}/transactions/{week}")
        if not raw:
            continue
        for t in raw:
            if t.get("status") not in ("complete", "failed"):
                continue
            tx_type = t.get("type", "free_agent")
            rids = t.get("roster_ids") or []
            teams = [rid_to_name.get(r, "Unknown") for r in rids]

            adds_raw  = t.get("adds") or {}
            drops_raw = t.get("drops") or {}

            added   = []
            dropped = []

            if tx_type == "trade":
                # Build per-team assets received
                # adds: {player_id: receiving_roster_id}
                assets_received = {}
                for pid, rid in adds_raw.items():
                    owner = rid_to_name.get(rid, "Unknown")
                    p = players.get(str(pid), {})
                    assets_received.setdefault(owner, []).append({
                        "name": p.get("full_name") or p.get("first_name", "") + " " + p.get("last_name", ""),
                        "position": fmt_pos(p),
                        "team": p.get("team"),
                    })
                # Draft picks traded
                for pick in (t.get("draft_picks") or []):
                    receiver_owner = rid_to_name.get(pick.get("owner_id"), "Unknown")
                    original_owner = rid_to_name.get(pick.get("roster_id"), None)
                    round_label = f"{pick.get('season','?')} Round {pick.get('round','?')}"
                    assets_received.setdefault(receiver_owner, []).append({
                        "name": round_label,
                        "position": "PICK",
                        "team": None,
                        "original_owner": original_owner,
                    })
                # FAAB exchanged
                for wb in (t.get("waiver_budget") or []):
                    receiver_owner = rid_to_name.get(wb.get("receiver"), "Unknown")
                    assets_received.setdefault(receiver_owner, []).append({
                        "name": f"${wb['amount']} FAAB",
                        "position": "FAAB",
                        "team": None,
                    })
                txns.append({
                    "season": season,
                    "week": t.get("leg", 0),
                    "created": fmt_ts(t["created"]),
                    "transaction_id": t["transaction_id"],
                    "type": "trade",
                    "status": t.get("status", "complete"),
                    "teams": teams,
                    "assets_received": assets_received,
                })
            else:
                for pid in adds_raw:
                    p = players.get(str(pid), {})
                    added.append({
                        "name": p.get("full_name") or (p.get("first_name","") + " " + p.get("last_name","")).strip() or str(pid),
                        "position": fmt_pos(p),
                        "team": p.get("team"),
                    })
                for pid in drops_raw:
                    p = players.get(str(pid), {})
                    dropped.append({
                        "name": p.get("full_name") or (p.get("first_name","") + " " + p.get("last_name","")).strip() or str(pid),
                        "position": fmt_pos(p),
                        "team": p.get("team"),
                    })
                settings = t.get("settings") or {}
                wb = t.get("waiver_budget") or []
                faab_spent = wb[0]["amount"] if wb else 0
                txns.append({
                    "season": season,
                    "week": t.get("leg", 0),
                    "created": fmt_ts(t["created"]),
                    "transaction_id": t["transaction_id"],
                    "type": tx_type,
                    "status": t.get("status", "complete"),
                    "teams": [rid_to_name.get(rids[0], "Unknown")] if rids else teams,
                    "added": added,
                    "dropped": dropped,
                    "faab": faab_spent,
                    "waiver_bid": settings.get("waiver_bid", 0),
                    "notes": (t.get("metadata") or {}).get("notes"),
                })

    # Sort newest first (by transaction_id descending — they're snowflake IDs)
    txns.sort(key=lambda x: int(x["transaction_id"]), reverse=True)
    return txns

# ── Build enriched rosters ────────────────────────────────────────────────────
def build_rosters(rosters_raw, rid_to_name, players):
    result = []
    for r in rosters_raw:
        owner = rid_to_name.get(r["roster_id"], "Unknown")
        player_list = []
        for pid in (r.get("players") or []):
            p = players.get(str(pid), {})
            if not p:
                continue
            full_name = p.get("full_name") or (p.get("first_name","") + " " + p.get("last_name","")).strip()
            positions = p.get("fantasy_positions") or []
            pos = fmt_pos(p)
            birth = p.get("birth_date")
            # age is NOT baked — it drifts with the calendar (birthdays) and would
            # trigger pushes unrelated to Sleeper data. Frontend derives it from birth_date.
            player_list.append({
                "player_id": str(pid),
                "espn_id": p.get("espn_id"),
                "name": full_name,
                "position": pos,
                "team": p.get("team"),
                "birth_date": birth,
                "college": p.get("college"),
                "height": p.get("height"),
                "weight": p.get("weight"),
                "years_exp": p.get("years_exp"),
                "status": p.get("status"),
                "injury_status": p.get("injury_status"),
                "search_rank": p.get("search_rank"),
            })
        result.append({
            "owner": owner,
            "roster_id": r["roster_id"],
            "players": player_list,
        })
    return result

# ── Inject a section into data.js ─────────────────────────────────────────────
def inject_section(content, key, new_json):
    """Replace the value of "key": ... in data.js using brace/bracket balancing."""
    pattern = f'"{key}":'
    idx = content.find(pattern)
    if idx < 0:
        return content, False

    val_start = idx + len(pattern)
    # Skip whitespace
    while val_start < len(content) and content[val_start] in " \t\n\r":
        val_start += 1

    opener = content[val_start]
    if opener not in ("{", "["):
        return content, False

    closer = "}" if opener == "{" else "]"
    depth = 0
    for i in range(val_start, len(content)):
        if content[i] == opener:
            depth += 1
        elif content[i] == closer:
            depth -= 1
            if depth == 0:
                val_end = i + 1
                break
    else:
        return content, False

    new_content = content[:val_start] + new_json + content[val_end:]
    changed = new_content != content
    return new_content, changed

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("Loading players...")
    players = load_players()
    if not players:
        print("ERROR: could not load player data", file=sys.stderr)
        sys.exit(2)

    print("Fetching league data for", CURRENT_YEAR)
    rid_to_name, rosters_raw, uid_to_name = build_roster_map(CURRENT_LEAGUE)
    print(f"  {len(rid_to_name)} rosters, {len(uid_to_name)} users")

    print("Fetching transactions...")
    txns_2026 = fetch_transactions(CURRENT_LEAGUE, CURRENT_YEAR, rid_to_name, players)

    # Read + parse the full data object. We rewrite the WHOLE file with the same
    # formatting build_data.py uses (indent=2), so when nothing actually changed the
    # output is byte-identical to what's on disk -> git sees no diff -> no commit.
    with open(DATA_JS) as f:
        content = f.read()
    data = json.loads(content[content.index("{"):content.rindex("}") + 1])

    # Keep prior years' transactions as-is; refresh only the current year.
    old_txns = [t for t in data.get("transactions", []) if t.get("season") != CURRENT_YEAR]
    all_txns = txns_2026 + old_txns
    all_txns.sort(key=lambda x: int(x["transaction_id"]), reverse=True)  # match build_data ordering
    print(f"  {len(txns_2026)} {CURRENT_YEAR} transactions, {len(old_txns)} prior")

    print("Building enriched rosters...")
    rosters = build_rosters(rosters_raw, rid_to_name, players)

    print("Fetching traded picks...")
    traded_picks_raw = fetch(f"https://api.sleeper.app/v1/league/{CURRENT_LEAGUE}/traded_picks") or []
    traded_picks = []
    for p in traded_picks_raw:
        owner_name    = rid_to_name.get(p.get("owner_id"),          "Unknown")
        orig_name     = rid_to_name.get(p.get("roster_id"),         "Unknown")
        prev_name     = rid_to_name.get(p.get("previous_owner_id"), "Unknown")
        traded_picks.append({
            "season":              str(p.get("season", "?")),
            "round":               p.get("round"),
            "roster_id":           str(p.get("roster_id")),
            "owner_id":            str(p.get("owner_id")),
            "previous_owner_id":   str(p.get("previous_owner_id")),
            "owner_name":          owner_name,
            "original_owner_name": orig_name,
            "previous_owner_name": prev_name,
        })
    print(f"  {len(traded_picks)} traded picks")

    # Update only the live sections, preserving key order, then re-dump the whole file.
    data["transactions"] = all_txns
    data["rosters"]      = rosters
    data["traded_picks"] = traded_picks
    new_content = "window.__STATIC_DATA__ = " + json.dumps(data, indent=2, ensure_ascii=False) + ";\n"

    if new_content == content:
        print("No changes detected.")
        sys.exit(1)   # signal to workflow: nothing to commit

    with open(DATA_JS, "w") as f:
        f.write(new_content)

    # Bump data.js version string in all HTML files so browsers re-fetch
    import glob, re as _re
    new_ver = datetime.now().strftime("%Y%m%d%H%M")
    bumped = []
    for html_path in glob.glob("*.html"):
        with open(html_path) as f:
            html = f.read()
        new_html = _re.sub(r'data\.js\?v=[^"\']+', f'data.js?v={new_ver}', html)
        if new_html != html:
            with open(html_path, "w") as f:
                f.write(new_html)
            bumped.append(html_path)
    if bumped:
        print(f"  Bumped data.js version to {new_ver} in: {', '.join(sorted(bumped))}")

    print(f"Updated: {len(txns_2026)} {CURRENT_YEAR} transactions, rosters, {len(traded_picks)} traded picks")
    sys.exit(0)   # signal to workflow: commit needed

if __name__ == "__main__":
    main()
