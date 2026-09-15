# ST — league site

Fourth fantasy league site, cloned from `indigo/` on 2026-09-14.
Public repo + GitHub Pages, same as the other three: <https://ddhkim-gop.github.io/st/>

## League

| Season | Sleeper league ID   | Teams | Status    |
|--------|---------------------|-------|-----------|
| 2024   | 1091752429168721920 | 12    | complete  |
| 2025   | 1263976130885459968 | 10    | complete  |
| 2026   | 1400268451699818496 | 8     | in season |

Redraft, full PPR, 6-team playoffs from week 15.
Starters: QB QB RB RB RB WR WR WR WR TE TE FLEX×5 K DEF, 5 bench.
Champions: 2024 edelgreco30, 2025 avocadoshake.

## Build

```bash
python3 scripts/build_data.py    # rewrites data.js + data/<year>/*.json
python3 scripts/bump_assets.py   # bumps ?v= cache-busting on every page
python3 -m http.server 8899      # serve
```

`bump_assets.py` stamps to the minute — two runs in the same minute produce the
same version and the browser serves the stale file. Wait for the minute to turn.

## Divergence from indigo

Indigo hardcoded its own seasons (2023–2026, half-PPR, 12 teams, dynasty) in
~20 places. Those are now driven by the build:

- `data.js` gains `years` and `completed_years`; every page derives its year
  list and dropdown options from them instead of literal arrays.
- `build_data.py` reads `pts_ppr` (was `pts_half_ppr`) and still writes it under
  the `pts_half_ppr` key, so the frontend needed no change.
- `isStartup` is always true — redraft, so every draft is a full draft, not a
  dynasty rookie draft. `totalTeams` is derived per draft from `draft_slot`
  (the league shrank 12 → 10 → 8), not fixed at 12.
- Team page "seasons played" and the regular-season record come from
  `standings` (includes the season in progress) and so match the Standings page;
  playoff rate still divides by completed seasons only.
- `home.js`'s league-format card was rewritten from this league's actual Sleeper
  settings. It is still hardcoded — update it if the league settings change.

## Highlights

Team pages carry a Latest Highlights panel fed by `assets/highlights/<team>.json`,
built by `scripts/build_highlights.py` from a pool of candidate X post URLs.

Events come from the **shared poller in `gameofphones`**, not a second daemon:
`scripts/poll_highlights.py` there lists this league in `LEAGUE_IDS`, and events
are keyed by player with every league that rosters him tagged under `owners`
as `{league, owner}`. One real NFL play, N leagues.

Clip *finding* stays manual by design — X search needs an authenticated session
a headless cron cannot do, so candidate URLs are collected interactively and
`ingest_highlights.py` does the deterministic rest. Posts are screened on text
and watched before landing in a feed: naming a player is not enough, since
rankings graphics, podcasts and betting slates all embed video and name players
they never show.

## Known gaps

- The "Picks" tab and future-pick trading are dynasty features; this league has
  no traded picks, so they render empty.
- Prize pool / entry fees are unknown and deliberately left blank.
- `PAUL_YOON_AVATAR` overrides remain in four files; that manager is not in this
  league, so they are inert no-ops.
- Highlight feeds are currently empty: the pool copied from indigo is week-1
  footage and `build_highlights.py` windows to the current week only.
