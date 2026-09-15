import { api } from "./dataService.js?v=202609150609";
import { renderNav } from "./components/nav.js?v=202609150609";

renderNav();

const INACTIVE_USERS = new Set(['edgxrjiang', 'riqi', 'shmyung', 'urmummma', 'JUNNNNAY']);
const FUTURE_YEARS = [];
const ROUNDS = [1, 2, 3];
const PAUL_YOON_AVATAR = "https://sleepercdn.com/images/v4/avatars/avatar_default_blue.webp";
const AVATAR_COLORS = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"];
const POS_ORDER = ["QB","RB","WR","TE","K","DEF"];

function posColor(pos) {
    return {QB:"#e74c82",RB:"#3ecf8e",WR:"#4299e1",TE:"#f6ad55",K:"#9f7aea",DEF:"#38b2ac"}[pos] || "#5a6070";
}
function accentFor(name) {
    return AVATAR_COLORS[name.split("").reduce((s,c)=>s+c.charCodeAt(0),0) % AVATAR_COLORS.length];
}
function ordinal(n) {
    const s=["th","st","nd","rd"], v=n%100;
    return n+(s[(v-20)%10]||s[v]||s[0]);
}

async function init() {
    const params = new URLSearchParams(window.location.search);
    const teamName = params.get("team");
    const container = document.getElementById("team-container");
    if (!container) return;

    if (!teamName) {
        container.innerHTML = `<p style="color:#5a6070;padding:20px;">No team specified.</p>`;
        return;
    }

    container.innerHTML = `<p style="color:#5a6070;padding:20px;">Loading...</p>`;

    try {
        const ALL_YEARS = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort();
        const [rosters, leagueUsers, tradedPicks, allTransactions, seasonHistory,
               draftsByYear, playerValues] = await Promise.all([
            api.getRosters(ALL_YEARS[ALL_YEARS.length - 1]),
            api.getLeagueUsers(),
            api.getTradedPicks(),
            api.getTransactions(),
            api.getSeasonHistory(),
            Promise.all(ALL_YEARS.map(y => api.getDraft(y).catch(() => []))),
            api.getPlayerValues(),
        ]);
        const draftByYear = Object.fromEntries(ALL_YEARS.map((y, i) => [y, draftsByYear[i]]));

        // Avatar
        (leagueUsers || []).forEach(u => {
            if (u.username === "Paul_Yoon") u.avatar_url = PAUL_YOON_AVATAR;
        });
        const userObj = (leagueUsers || []).find(u => u.username === teamName);
        const avatarUrl = userObj?.avatar_url;
        const accent = accentFor(teamName);

        // ── Compute cross-season stats ────────────────────────────────────────
        const HIST_YEARS = ALL_YEARS;
        let totalRegWins = 0, totalRegLosses = 0;
        let playoffApps = 0, championships = 0, firstRdByes = 0;
        let playoffWins = 0, playoffLosses = 0;
        const tradesBySeason = {};
        let completedSeasons = 0;
        // Seasons the manager actually appears in, including the season in progress.
        const allStandings = (window.__STATIC_DATA__ && window.__STATIC_DATA__.standings) || {};
        const seasonsPlayed = ALL_YEARS.filter(y => (allStandings[y] || []).some(r => r.name === teamName)).length;
        // Regular-season record spans every season incl. the one in progress,
        // matching the Standings page. Bracket stats below stay on completed seasons.
        ALL_YEARS.forEach(y => {
            const row = (allStandings[y] || []).find(r => r.name === teamName);
            if (!row) return;
            totalRegWins   += row.wins   || 0;
            totalRegLosses += row.losses || 0;
        });

        for (const yr of HIST_YEARS) {
            const s = seasonHistory[yr];
            if (!s) continue;
            const standing = (s.standings || []).find(t => t.name === teamName);
            if (!standing) continue;
            completedSeasons++;

            const bracket = s.winners_bracket || [];
            const inBracket = bracket.some(m => m.team1 === teamName || m.team2 === teamName);
            if (inBracket) playoffApps++;
            if (s.champion === teamName) championships++;

            // First-round bye: not in round 1 but appears in round 2+
            const round1Teams = new Set(bracket.filter(m => m.round === 1).flatMap(m => [m.team1, m.team2]));
            const round2Teams = new Set(bracket.filter(m => m.round >= 2).flatMap(m => [m.team1, m.team2]));
            if (!round1Teams.has(teamName) && round2Teams.has(teamName)) firstRdByes++;

            // Playoff record
            bracket.forEach(m => {
                if (m.winner === teamName) playoffWins++;
                if (m.loser  === teamName) playoffLosses++;
            });
        }

        // Trades by season
        ALL_YEARS.forEach(yr => {
            tradesBySeason[yr] = allTransactions.filter(tx =>
                tx.type === "trade" && tx.season === yr &&
                (tx.teams || []).includes(teamName)
            ).length;
        });
        const totalTrades = Object.values(tradesBySeason).reduce((s,v)=>s+v,0);

        // Transactions (non-trade: waiver + FA) by season
        const txBySeason = {};
        ALL_YEARS.forEach(yr => {
            txBySeason[yr] = allTransactions.filter(tx =>
                (tx.type === "waiver" || tx.type === "free_agent") &&
                tx.season === yr && tx.status === "complete" &&
                (tx.teams || []).includes(teamName)
            ).length;
        });
        const totalTx = Object.values(txBySeason).reduce((s,v)=>s+v,0);

        // Transaction rank per season
        const txRankBySeason = {};
        ALL_YEARS.forEach(yr => {
            const counts = {};
            allTransactions.filter(tx =>
                (tx.type === "waiver" || tx.type === "free_agent") &&
                tx.season === yr && tx.status === "complete"
            ).forEach(tx => { (tx.teams || []).forEach(t => { counts[t] = (counts[t]||0) + 1; }); });
            const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
            const idx = sorted.findIndex(([t]) => t === teamName);
            txRankBySeason[yr] = idx >= 0 ? idx + 1 : null;
        });

        // Top trade partners (all years)
        const partnerCount = {};
        allTransactions.filter(tx => tx.type === "trade" && (tx.teams || []).includes(teamName))
            .forEach(tx => {
                (tx.teams || []).forEach(t => {
                    if (t !== teamName) partnerCount[t] = (partnerCount[t]||0) + 1;
                });
            });
        const topPartners = Object.entries(partnerCount).sort((a,b)=>b[1]-a[1]).slice(0,6);

        // ── Current roster ────────────────────────────────────────────────────
        const myRoster = (rosters || []).find(r => r.owner === teamName);
        const players  = myRoster?.players || [];

        // Group + sort players
        const grouped = {};
        players.filter(p => p && p.name).forEach(p => {
            const pos = p.position || "OTHER";
            if (!grouped[pos]) grouped[pos] = [];
            grouped[pos].push(p);
        });
        Object.keys(grouped).forEach(pos => {
            grouped[pos].sort((a,b) => {
                const av = (playerValues[a.name]?.ktc ?? 0);
                const bv = (playerValues[b.name]?.ktc ?? 0);
                if (av !== bv) return bv - av; // KTC descending
                return (a.search_rank??999999) - (b.search_rank??999999);
            });
        });
        const sortedPos = POS_ORDER.filter(p => grouped[p])
            .concat(Object.keys(grouped).filter(p => !POS_ORDER.includes(p)));

        // ── Current picks ─────────────────────────────────────────────────────
        // Build ownership map from traded picks
        const ownership = {};
        FUTURE_YEARS.forEach(year => {
            ownership[year] = {};
            ROUNDS.forEach(round => {
                ownership[year][round] = {};
                (rosters || []).forEach(r => {
                    const name = r.owner || `Roster ${r.roster_id}`;
                    ownership[year][round][name] = name; // default: own pick
                });
            });
        });
        (tradedPicks || []).forEach(p => {
            const yr = p.season, rd = p.round, orig = p.original_owner_name, curr = p.owner_name;
            if (ownership[yr]?.[rd]?.[orig] !== undefined) {
                ownership[yr][rd][orig] = curr;
            }
        });

        // My picks: picks currently owned by me
        const myPicks = [];
        FUTURE_YEARS.forEach(year => {
            ROUNDS.forEach(round => {
                Object.entries(ownership[year][round]).forEach(([orig, curr]) => {
                    if (curr === teamName) myPicks.push({ year, round, orig, isOwn: orig === teamName });
                });
            });
        });

        // ── Render ────────────────────────────────────────────────────────────
        const playoffRate = completedSeasons ? Math.round(playoffApps / completedSeasons * 100) : 0;
        const regPct = (totalRegWins + totalRegLosses) > 0
            ? (totalRegWins / (totalRegWins + totalRegLosses) * 100).toFixed(1)
            : null;

        // Avatar element html
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.outerHTML='<span style=\\'width:56px;height:56px;border-radius:50%;background:${accent};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;flex-shrink:0;\\'>${teamName[0].toUpperCase()}</span>'">`
            : `<span style="width:56px;height:56px;border-radius:50%;background:${accent};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;flex-shrink:0;">${teamName[0].toUpperCase()}</span>`;

        function statBlock(label, value, sub) {
            return `<div style="display:flex;flex-direction:column;gap:2px;min-width:0;overflow:hidden;">
                <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;white-space:nowrap;">${label}</div>
                <div style="display:flex;align-items:baseline;gap:4px;white-space:nowrap;">
                    <span style="font-size:17px;font-weight:800;color:${value === '0' || value === '0%' ? '#3ecf8e' : '#f0f1f3'};white-space:nowrap;">${value}</span>
                    ${sub ? `<span style="font-size:10px;color:#5a6070;white-space:nowrap;">${sub}</span>` : ''}
                </div>
            </div>`;
        }

        // Trade rank per season
        const tradeRankBySeason = {};
        ALL_YEARS.forEach(yr => {
            const teamTradeCounts = {};
            allTransactions.filter(tx => tx.type === "trade" && tx.season === yr)
                .forEach(tx => { (tx.teams || []).forEach(t => { teamTradeCounts[t] = (teamTradeCounts[t]||0) + 0.5; }); });
            Object.keys(teamTradeCounts).forEach(t => { teamTradeCounts[t] = Math.round(teamTradeCounts[t]); });
            const sorted = Object.entries(teamTradeCounts).sort((a,b) => b[1]-a[1]);
            const idx = sorted.findIndex(([t]) => t === teamName);
            tradeRankBySeason[yr] = idx >= 0 ? idx + 1 : null;
        });

        // Transaction bars
        const maxTx = Math.max(...Object.values(txBySeason), 1);
        const txBars = ALL_YEARS.slice().reverse().map(yr => {
            const n = txBySeason[yr] || 0;
            const pct = Math.round(n / maxTx * 100);
            const rank = txRankBySeason[yr];
            const rankHtml = rank ? `<div style="font-size:10px;color:#5a6070;width:28px;text-align:right;flex-shrink:0;">#${rank}</div>` : `<div style="width:28px;"></div>`;
            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                <div style="font-size:12px;color:#8b9099;width:32px;flex-shrink:0;">${yr}</div>
                <div style="flex:1;background:#2d3139;border-radius:3px;height:8px;">
                    <div style="width:${pct}%;background:#4299e1;height:8px;border-radius:3px;transition:width .3s;"></div>
                </div>
                <div style="font-size:12px;color:#8b9099;width:16px;text-align:right;flex-shrink:0;">${n}</div>
                ${rankHtml}
            </div>`;
        }).join("");

        // Trade bars
        const maxTrades = Math.max(...Object.values(tradesBySeason), 1);
        const tradeBars = ALL_YEARS.slice().reverse().map(yr => {
            const n = tradesBySeason[yr] || 0;
            const pct = Math.round(n / maxTrades * 100);
            const rank = tradeRankBySeason[yr];
            const rankHtml = rank ? `<div style="font-size:10px;color:#5a6070;width:28px;text-align:right;flex-shrink:0;">#${rank}</div>` : `<div style="width:28px;"></div>`;
            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                <div style="font-size:12px;color:#8b9099;width:32px;flex-shrink:0;">${yr}</div>
                <div style="flex:1;background:#2d3139;border-radius:3px;height:8px;">
                    <div style="width:${pct}%;background:#3ecf8e;height:8px;border-radius:3px;transition:width .3s;"></div>
                </div>
                <div style="font-size:12px;color:#8b9099;width:16px;text-align:right;flex-shrink:0;">${n}</div>
                ${rankHtml}
            </div>`;
        }).join("");

        // Partner rows
        const partnerAvatars = {};
        (leagueUsers || []).forEach(u => { partnerAvatars[u.username] = u.avatar_url; });
        const partnerRows = topPartners.map(([partner, count]) => {
            const pAvatar = partnerAvatars[partner];
            const pAccent = accentFor(partner);
            const pAvatarHtml = pAvatar
                ? `<img src="${pAvatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`
                : `<span style="width:32px;height:32px;border-radius:50%;background:${pAccent};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;">${partner[0].toUpperCase()}</span>`;
            return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #2d3139;">
                ${pAvatarHtml}
                <span style="font-size:13px;font-weight:600;color:#f0f1f3;flex:1;">${partner}</span>
                <span style="font-size:12px;color:#5a6070;">${count} trade${count===1?'':'s'}</span>
            </div>`;
        }).join("");

        // KTC value color helper
        function ktcColor(v) {
            if (v >= 8000) return "#3ecf8e";
            if (v >= 6000) return "#4299e1";
            if (v >= 4000) return "#a78bfa";
            if (v >= 2000) return "#f6ad55";
            return "#5a6070";
        }
        function fmtApy(apy) {
            if (!apy) return null;
            if (apy >= 1000000) return `$${(apy/1000000).toFixed(1).replace(/\.0$/,'')}M`;
            if (apy >= 1000) return `$${Math.round(apy/1000)}K`;
            return `$${apy}`;
        }

        // Roster rows
        const rosterHtml = sortedPos.map(pos => {
            const header = `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;margin:12px 0 4px;">${pos}</div>`;
            const rows = grouped[pos].map(p => {
                const badge = `<span style="background:${posColor(p.position)};color:#fff;font-size:10px;font-weight:800;padding:2px 0;border-radius:4px;width:30px;text-align:center;flex-shrink:0;">${p.position||'?'}</span>`;
                const rookieBadge = p.years_exp === 0 ? `<span style="font-size:9px;font-weight:700;color:#f6ad55;background:rgba(246,173,85,.15);padding:1px 5px;border-radius:3px;">R</span>` : '';
                const teamLogo = p.team ? `<img src="https://sleepercdn.com/images/team_logos/nfl/${p.team.toLowerCase()}.jpg" style="width:18px;height:18px;object-fit:contain;opacity:.8;" onerror="this.style.display='none'">` : '';
                const ageStr = p.birth_date ? (() => { const b = new Date(p.birth_date); return ((Date.now()-b)/(365.25*24*60*60*1000)).toFixed(1); })() : (p.age || '');
                return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#252830;border-radius:8px;margin-bottom:3px;">
                    ${badge}
                    <span style="font-size:13px;font-weight:600;color:#f0f1f3;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}${rookieBadge}</span>
                    ${teamLogo}
                    ${ageStr ? `<span style="font-size:11px;color:#5a6070;flex-shrink:0;">${ageStr}</span>` : ''}
                </div>`;
            }).join("");
            return header + rows;
        }).join("");

        // Picks html
        const pickLabel = (yr, rd, orig, isOwn) => {
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#252830;border-radius:8px;margin-bottom:3px;overflow:hidden;">
                <span style="background:#5a5be6;color:#fff;font-size:10px;font-weight:800;padding:2px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0;">${yr} R${rd}</span>
                <span style="font-size:12px;font-weight:600;color:#f0f1f3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${isOwn ? 'Own pick' : orig + "'s pick"}</span>
            </div>`;
        };

        // Build picks grouped by year+round, with headers and empty spacers
        const ordinal = r => r === 1 ? '1st' : r === 2 ? '2nd' : '3rd';
        let picksHtml = '';
        FUTURE_YEARS.forEach(yr => {
            ROUNDS.forEach(rd => {
                const slotPicks = myPicks.filter(p => p.year === yr && p.round === rd);
                picksHtml += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;margin:10px 0 3px;">${yr} · ${ordinal(rd)} Round</div>`;
                if (slotPicks.length) {
                    picksHtml += slotPicks.map(p => pickLabel(p.year, p.round, p.orig, p.isOwn)).join('');
                } else {
                    picksHtml += `<div style="height:28px;"></div>`;
                }
            });
        });

        // ── Draft Analysis ────────────────────────────────────────────────────
        const currentRosterNames = new Set((rosters.find(r=>r.owner===teamName)?.players||[]).map(p=>p.name));

        // Build set of all player names ever transacted by this team
        const tradedAwayNames = new Set();
        const droppedNames2 = new Set();
        allTransactions.forEach(tx => {
            if (!(tx.teams||[]).includes(teamName)) return;
            if (tx.type === "trade") {
                Object.entries(tx.assets_received || {}).forEach(([rcv, assets]) => {
                    if (rcv !== teamName) {
                        (assets||[]).forEach(a => { if (a.name) tradedAwayNames.add(a.name); });
                    }
                });
            } else if (tx.type === "waiver" || tx.type === "free_agent") {
                (tx.dropped||[]).forEach(a => { if (a.name) droppedNames2.add(a.name); });
            }
        });

        function playerStatus(name) {
            if (currentRosterNames.has(name)) return "roster";
            if (tradedAwayNames.has(name)) return "traded";
            return "dropped";
        }

        function posColor2(pos) {
            return {QB:"#e74c82",RB:"#3ecf8e",WR:"#4299e1",TE:"#f6ad55",K:"#9f7aea",DEF:"#38b2ac"}[pos] || "#5a6070";
        }

        // Draft tier labels for startup (2023) vs rookie drafts
        function startupTier(round) {
            if (round <= 3) return {label:"Franchise Core", color:"#f6ad55"};
            if (round <= 8) return {label:"Starter", color:"#3ecf8e"};
            if (round <= 15) return {label:"Depth", color:"#4299e1"};
            return {label:"Late Flier", color:"#5a6070"};
        }
        function rookieTier(round, pickInRound, totalTeams) {
            const pct = pickInRound / totalTeams;
            if (round === 1 && pct <= 0.33) return {label:"Top Pick", color:"#f6ad55"};
            if (round === 1 && pct <= 0.67) return {label:"Mid 1st", color:"#a78bfa"};
            if (round === 1) return {label:"Late 1st", color:"#4299e1"};
            if (round === 2) return {label:"2nd Round", color:"#3ecf8e"};
            return {label:"3rd Round", color:"#8b9099"};
        }

        function revisitedGrade(picks) {
            if (!picks.length) return null;
            const statuses = picks.map(p => playerStatus(p.player));
            const onRoster = statuses.filter(s => s === "roster").length;
            const pct = onRoster / picks.length;
            if (pct >= 0.75) return {grade:"A", color:"#3ecf8e"};
            if (pct >= 0.5)  return {grade:"B", color:"#a78bfa"};
            if (pct >= 0.25) return {grade:"C", color:"#f6ad55"};
            return {grade:"D", color:"#e74c82"};
        }

        function recapScore(picks, isStartup) {
            if (!picks.length) return null;
            // Weight: 60% roster retention, 40% pick position value
            const statuses = picks.map(p => playerStatus(p.player));
            const onRoster = statuses.filter(s => s === "roster").length;
            const retentionPct = onRoster / picks.length;
            // Pick position value: avg of (1 - pickInRound/totalTeams) across all picks
            const totalTeams = Math.max(1, ...picks.map(p => p.draft_slot || 0)) || 12;
            let pickVal = 0;
            picks.forEach(p => {
                const pickInRound = ((p.pick_no - 1) % totalTeams) + 1;
                pickVal += 1 - (pickInRound - 1) / totalTeams;
            });
            pickVal = pickVal / picks.length;
            const raw = retentionPct * 0.6 + pickVal * 0.4;
            return Math.round(raw * 10 * 10) / 10; // 0-10
        }

        function buildDraftYearHtml(year) {
            const allPicks = (draftByYear[year] || []).filter(p => p.picked_by === teamName);
            if (!allPicks.length) return `<div style="color:#5a6070;font-size:13px;padding:12px 0;">No picks in this draft.</div>`;
            const isStartup = true;  // redraft league: every draft is a full draft
            const totalTeams = Math.max(1, ...(draftByYear[year] || []).map(p => p.draft_slot || 0)) || 12;
            const revisitYear = parseInt(year) + 2;
            const canRevisit = revisitYear <= parseInt(ALL_YEARS[ALL_YEARS.length - 1] || year);

            // Group by round
            const byRound = {};
            allPicks.forEach(p => {
                if (!byRound[p.round]) byRound[p.round] = [];
                byRound[p.round].push(p);
            });

            // Status counts
            const onRoster = allPicks.filter(p => playerStatus(p.player) === "roster").length;
            const traded = allPicks.filter(p => playerStatus(p.player) === "traded").length;
            const dropped = allPicks.filter(p => playerStatus(p.player) === "dropped").length;
            const hitRate = Math.round(onRoster / allPicks.length * 100);

            // Pick rows
            const pickRows = Object.keys(byRound).sort((a,b)=>+a-+b).map(rd => {
                const roundPicks = byRound[rd];
                const tier = isStartup ? startupTier(+rd) : rookieTier(+rd, ((roundPicks[0].pick_no-1)%totalTeams)+1, totalTeams);
                const roundHeader = `<div style="display:flex;align-items:center;gap:8px;margin:14px 0 6px;">
                    <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;">Round ${rd}</span>
                    <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${tier.color}22;color:${tier.color};">${tier.label}</span>
                </div>`;
                const rows = roundPicks.map(p => {
                    const pickInRound = ((p.pick_no - 1) % totalTeams) + 1;
                    const status = playerStatus(p.player);
                    const statusBadge = status === "roster"
                        ? `<span style="font-size:10px;font-weight:700;color:#3ecf8e;background:#3ecf8e18;padding:2px 6px;border-radius:4px;white-space:nowrap;">On Roster</span>`
                        : status === "traded"
                        ? `<span style="font-size:10px;font-weight:700;color:#4299e1;background:#4299e118;padding:2px 6px;border-radius:4px;white-space:nowrap;">Traded</span>`
                        : `<span style="font-size:10px;font-weight:700;color:#5a6070;background:#2d3139;padding:2px 6px;border-radius:4px;white-space:nowrap;">Released</span>`;
                    const wasTraded = p.traded ? `<span style="font-size:10px;color:#f6ad55;margin-left:4px;" title="Pick was traded">↔</span>` : '';
                    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#252830;border-radius:8px;margin-bottom:3px;">
                        <span style="background:${posColor2(p.position)};color:#fff;font-size:10px;font-weight:800;padding:2px 0;border-radius:4px;width:30px;text-align:center;flex-shrink:0;">${p.position||'?'}</span>
                        <span style="font-size:12px;font-weight:600;color:#f0f1f3;flex:1;">${p.player}${wasTraded}</span>
                        <span style="font-size:11px;color:#5a6070;flex-shrink:0;">${year.slice(2)}.${String(pickInRound).padStart(2,'0')}</span>
                        ${statusBadge}
                    </div>`;
                }).join("");
                return roundHeader + rows;
            }).join("");

            // Recap summary text
            const topPicks = allPicks.filter(p => isStartup ? p.round <= 3 : p.round === 1);
            const topOnRoster = topPicks.filter(p => playerStatus(p.player) === "roster");
            const recapText = isStartup
                ? `Selected ${allPicks.length} players across ${Object.keys(byRound).length} rounds. Early picks (R1–R3): ${topPicks.map(p=>p.player).join(", ") || "none"}. ${topOnRoster.length} of ${topPicks.length} top picks remain on the roster today.`
                : `Selected ${allPicks.length} rookie${allPicks.length!==1?'s':''} — ${allPicks.map(p=>`${p.player} (${p.position})`).join(", ")}. ${onRoster} of ${allPicks.length} are still on the roster.`;
            const score = recapScore(allPicks, isStartup);

            // Revisited section
            let revisitedHtml = '';
            if (canRevisit) {
                const grade = revisitedGrade(allPicks);
                const revisitedText = isStartup
                    ? `${revisitYear - parseInt(year)} years on: ${onRoster} of ${allPicks.length} drafted players remain (${hitRate}% retention). ${traded} were traded for value, ${dropped} were released.`
                    : `${revisitYear - parseInt(year)} years after this rookie draft: ${onRoster} of ${allPicks.length} are still contributing. ${traded > 0 ? traded + " were traded away." : ""} ${dropped > 0 ? dropped + " were released." : ""}`.trim();
                const gColor = grade ? grade.color : "#5a6070";
                revisitedHtml = `
                <div style="background:#252830;border:1px solid #2d3139;border-radius:10px;padding:16px;margin-top:16px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">Draft Revisited · ${revisitYear}</div>
                        ${grade ? `<span style="font-size:28px;font-weight:900;color:${gColor};">${grade.grade}</span>` : ''}
                    </div>
                    <div style="display:flex;gap:24px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #2d3139;">
                        <div><div style="font-size:22px;font-weight:800;color:#3ecf8e;">${onRoster}</div><div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">On Roster</div></div>
                        <div><div style="font-size:22px;font-weight:800;color:#4299e1;">${traded}</div><div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Traded</div></div>
                        <div><div style="font-size:22px;font-weight:800;color:#5a6070;">${dropped}</div><div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Released</div></div>
                        <div><div style="font-size:22px;font-weight:800;color:#f0f1f3;">${hitRate}%</div><div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Retention</div></div>
                    </div>
                    <div style="font-size:13px;color:#c9cdd4;line-height:1.7;">${revisitedText}</div>
                </div>`;
            }

            const scoreColor = score >= 7 ? "#3ecf8e" : score >= 5 ? "#f6ad55" : "#e74c82";
            const recapCard = `
            <div style="background:#252830;border:1px solid #2d3139;border-radius:10px;padding:16px;margin-bottom:16px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">Draft Recap</div>
                    ${score !== null ? `<div style="display:flex;align-items:baseline;gap:4px;"><span style="font-size:26px;font-weight:900;color:${scoreColor};">${score}</span><span style="font-size:13px;color:#5a6070;font-weight:600;">/10</span></div>` : ''}
                </div>
                <div style="font-size:13px;color:#c9cdd4;line-height:1.7;">${recapText}</div>
            </div>`;

            return isStartup
                ? `${recapCard}${pickRows}${revisitedHtml}`
                : `${pickRows}${recapCard}${revisitedHtml}`;
        }

        const draftYears = ALL_YEARS.slice().reverse();
        const activeYears = draftYears.filter(yr => (draftByYear[yr]||[]).some(p => p.picked_by === teamName));

        const draftSections = activeYears.map((yr, i) =>
            `<div class="draft-tab-content" id="draft-tab-${yr}" style="display:${i===0?'block':'none'};">${buildDraftYearHtml(yr)}</div>`
        ).join('');

        const draftTabButtons = activeYears.map((yr, i) =>
            `<button data-year="${yr}" onclick="switchDraftTab(this)" class="draft-tab-btn${i===0?' draft-tab-active':''}" style="background:none;border:none;padding:7px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#8b9099;transition:background .15s,color .15s;">${yr}</button>`
        ).join('');

        // ── Compact draft summary card (for col 3) ───────────────────────────
        const draftSummaryRows = draftYears.map(yr => {
            const allPicks = (draftByYear[yr] || []).filter(p => p.picked_by === teamName);
            if (!allPicks.length) return '';
            const isStartup = true;  // redraft league
            const score = recapScore(allPicks, isStartup);
            const scoreColor = score >= 7 ? "#3ecf8e" : score >= 5 ? "#f6ad55" : "#e74c82";
            const revisitYear = parseInt(yr) + 2;
            const canRevisit = revisitYear <= parseInt(ALL_YEARS[ALL_YEARS.length - 1] || yr);
            const grade = canRevisit ? revisitedGrade(allPicks) : null;
            const onRosterCnt = allPicks.filter(p => playerStatus(p.player) === "roster").length;
            const retentionPct = Math.round(onRosterCnt / allPicks.length * 100);
            return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #2d3139;">
                <div style="font-size:13px;font-weight:700;color:#f0f1f3;width:36px;flex-shrink:0;">${yr}</div>
                <div style="font-size:11px;color:#5a6070;flex:1;">${isStartup ? "Startup" : "Rookie"}</div>
                ${score !== null ? `<div style="display:flex;align-items:baseline;gap:2px;">
                    <span style="font-size:18px;font-weight:900;color:${scoreColor};">${score}</span>
                    <span style="font-size:11px;color:#5a6070;">/10</span>
                </div>` : '<div style="font-size:13px;color:#5a6070;">—</div>'}
                ${grade ? `<div style="font-size:20px;font-weight:900;color:${grade.color};width:24px;text-align:right;">${grade.grade}</div>` : `<div style="font-size:13px;color:#5a6070;width:24px;text-align:right;">—</div>`}
                <div style="font-size:11px;color:#5a6070;width:38px;text-align:right;flex-shrink:0;">${retentionPct}%</div>
            </div>`;
        }).filter(Boolean).join('');

        const draftSummaryCard = draftSummaryRows ? `
        <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <div style="font-size:14px;font-weight:700;color:#f0f1f3;">Draft Summary</div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:4px;padding-bottom:6px;border-bottom:1px solid #2d3139;">
            <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;width:42px;text-align:right;">Score</div>
            <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;width:24px;text-align:right;">Grade</div>
            <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;width:38px;text-align:right;">Keep%</div>
          </div>
          ${draftSummaryRows}
        </div>` : '';

        const draftHtml = draftTabButtons ? `
        <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;margin-top:16px;">
            <div style="font-size:14px;font-weight:700;color:#f0f1f3;margin-bottom:14px;">Draft History</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:16px;border-bottom:1px solid #2d3139;padding-bottom:12px;">
                ${draftTabButtons}
            </div>
            <style>
                .draft-tab-btn:hover { color:#f0f1f3 !important; background:#252830 !important; }
                .draft-tab-active { color:#f0f1f3 !important; background:#252830 !important; }
            </style>
            ${draftSections}
        </div>` : '';

        container.innerHTML = `
        <style>
          .team-page-outer { max-width:960px; }
          .team-page-wrap { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; align-items:start; }
          @media (max-width:750px) { .team-page-wrap { grid-template-columns:1fr 1fr; } }
          @media (max-width:500px) { .team-page-wrap { grid-template-columns:1fr; } }
          /* News left, highlight reel right - equal halves on desktop, stacked on mobile */
          .team-top-wrap { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; align-items:stretch; }
          @media (max-width:600px) { .team-top-wrap { grid-template-columns:1fr; } }
          .team-top-wrap .top-card { background:#1e2027; border:1px solid #2d3139; border-radius:12px;
            padding:16px 20px; display:flex; flex-direction:column; min-width:0; max-height:520px; }
          .team-top-wrap twitter-widget, .team-top-wrap iframe { max-width:100% !important; }
          .team-col { display:flex; flex-direction:column; gap:16px; min-width:0; }
          .team-col-equal { display:flex; flex-direction:column; min-width:0; align-self:stretch; }
          .team-col-equal .equal-card { flex:1; }
          .team-stats-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px 8px; }
          @media (max-width:400px) { .team-stats-grid { grid-template-columns:1fr 1fr; } }
          .team-header-wrap { display:flex; align-items:center; gap:14px; margin-bottom:20px; flex-wrap:wrap; }
        </style>

        <div class="team-page-outer">
        <!-- Back nav -->
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
          <a href="teams.html#rosters" style="background:#1e2027;border:1px solid #2d3139;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;color:#8b9099;text-decoration:none;" onmouseover="this.style.color='#f0f1f3';this.style.background='#252830'" onmouseout="this.style.color='#8b9099';this.style.background='#1e2027'">Rosters</a>
          <a href="teams.html#picks" style="background:#1e2027;border:1px solid #2d3139;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;color:#8b9099;text-decoration:none;" onmouseover="this.style.color='#f0f1f3';this.style.background='#252830'" onmouseout="this.style.color='#8b9099';this.style.background='#1e2027'">Picks</a>
        </div>
        <div class="filter-bar" style="margin-bottom:20px;">
          <select onchange="if(this.value)window.location.href='team.html?team='+encodeURIComponent(this.value)">
            <option value="">View a team…</option>
            ${(rosters||[]).filter(r=>r.owner&&!INACTIVE_USERS.has(r.owner)).sort((a,b)=>a.owner.localeCompare(b.owner)).map(r=>`<option value="${r.owner}"${r.owner===teamName?' selected':''}>${r.owner}</option>`).join('')}
          </select>
        </div>
        <!-- Header -->
        <div class="team-header-wrap">
          ${avatarHtml}
          <div>
            <div style="font-size:22px;font-weight:800;color:#f0f1f3;">${teamName}</div>
            ${seasonsPlayed ? `<div style="font-size:12px;color:#5a6070;margin-top:3px;">${seasonsPlayed} season${seasonsPlayed!==1?'s':''} played</div>` : ''}
          </div>
        </div>

        <!-- Roster news (left) + highlight reel (right) -->
        <div class="team-top-wrap">
          <div class="top-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div style="font-size:14px;font-weight:700;color:#f0f1f3;">Latest Roster News</div>
              <div id="team-news-count" style="font-size:12px;color:#5a6070;">Loading…</div>
            </div>
            <div id="team-news-body" style="flex:1;overflow-y:auto;padding-right:6px;">
              <div style="color:#5a6070;font-size:12px;">Loading news…</div>
            </div>
          </div>

          <div class="top-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div style="font-size:14px;font-weight:700;color:#f0f1f3;">Latest Highlights</div>
              <div id="team-reel-note" style="font-size:12px;color:#5a6070;">Loading…</div>
            </div>
            <div id="team-reel-body" style="flex:1;overflow-y:auto;padding-right:6px;min-height:0;">
              <div style="color:#5a6070;font-size:12px;">Loading posts…</div>
            </div>
          </div>

        </div>

        <div class="team-page-wrap">

          <!-- COL 1: Roster -->
          <div class="team-col-equal">
            <div class="equal-card" style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
              <div style="font-size:14px;font-weight:700;color:#f0f1f3;margin-bottom:4px;">Current Roster</div>
              <div style="font-size:12px;color:#5a6070;margin-bottom:8px;">${players.length} players</div>
              ${rosterHtml}
            </div>
          </div>

          <!-- COL 2: Draft Picks -->
          <div class="team-col-equal">
            <div class="equal-card" style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
              <div style="font-size:14px;font-weight:700;color:#f0f1f3;margin-bottom:4px;">Draft Picks</div>
              <div style="font-size:12px;color:#5a6070;margin-bottom:8px;">${myPicks.length} picks</div>
              ${picksHtml}
            </div>
          </div>

          <!-- COL 3: Stats + activity + partners -->
          <div class="team-col">

            <!-- Stat grid -->
            <div class="team-stats-grid" style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:16px;">
              ${statBlock("Championships", String(championships))}
              ${statBlock("Playoff Apps", String(playoffApps))}
              ${statBlock("Reg. Season", `${totalRegWins}–${totalRegLosses}`, regPct ? `${regPct}%` : '')}
              ${statBlock("Playoffs", `${playoffWins}–${playoffLosses}`, playoffApps ? `${Math.round(playoffWins/(playoffWins+playoffLosses||1)*100)}%` : '')}
              ${statBlock("Playoff Rate", `${playoffRate}%`)}
              ${statBlock("First Rd Byes", String(firstRdByes))}
            </div>

            <!-- Transaction activity -->
            <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <div style="font-size:14px;font-weight:700;color:#f0f1f3;">Transactions by season</div>
                <div style="font-size:12px;color:#5a6070;">${totalTx} moves</div>
              </div>
              ${txBars}
            </div>

            <!-- Trade activity -->
            <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <div style="font-size:14px;font-weight:700;color:#f0f1f3;">Trade activity by season</div>
                <div style="font-size:12px;color:#5a6070;">${totalTrades} trades</div>
              </div>
              ${tradeBars}
            </div>

            <!-- Top trade partners -->
            ${topPartners.length ? `
            <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <div style="font-size:14px;font-weight:700;color:#f0f1f3;">Top trade partners</div>
                <div style="font-size:12px;color:#5a6070;">${Object.keys(partnerCount).length} teams</div>
              </div>
              ${partnerRows}
            </div>` : ''}

            ${draftSummaryCard}

          </div><!-- /col 3 -->
        </div><!-- /team-page-wrap -->

        ${draftHtml}

        </div><!-- /team-page-outer -->`;

        loadTeamNews(players);


        loadTeamReel(teamName);
    } catch(err) {
        console.error(err);
        container.innerHTML = `<p style="color:#e74c82;padding:20px;">Error loading team: ${err.message}</p>`;
    }
}

// ── Latest highlights ────────────────────────────────────────────────────────
// A feed of X posts showing players on this roster make a play, from
// assets/highlights/<team>.json. Curated rather than fetched: X has no public
// search API. Naming a player is not enough - rankings graphics, podcasts and
// betting slates all embed video and name players they never show - so posts
// are screened on their text and then watched before they land in the file.
//
// Rendered as our own card around a native <video>. X's widget is not used:
// 42 of the 43 shipped clips are monetized amplify video, which the widget
// covers with a "Watch on X" button instead of playing in place, and every
// element being ours keeps the panel uniform.
async function loadTeamReel(teamName) {
    const body = document.getElementById("team-reel-body");
    const note = document.getElementById("team-reel-note");
    if (!body) return;
    const slug = String(teamName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

    let feed = null;
    try {
        const r = await fetch(`assets/highlights/${slug}.json`, { cache: "no-cache" });
        if (r.ok) feed = await r.json();
    } catch (e) { feed = null; }

    const tweets = (feed && Array.isArray(feed.tweets)) ? feed.tweets : [];
    if (!tweets.length) {
        if (note) note.textContent = "";
        body.innerHTML = `<div style="color:#5a6070;font-size:12px;line-height:1.6;">
            No highlights for this roster yet.<br>
            <span style="color:#454b58;">A post only lands here if the video actually
            shows the player making a play &mdash; not a rankings graphic, a podcast
            or a betting slate that merely names him.</span>
        </div>`;
        return;
    }
    if (note) note.textContent = `${tweets.length} posts`;

    // Modelled on X's *embed* (publish.twitter.com), not the app timeline: name
    // and blue check on one line, "@handle · Follow" stacked beneath, X mark top
    // right, then text, media, and a date footer. The widget itself cannot be
    // used - 42 of 43 clips are monetized amplify video, which X's embed refuses
    // to play in place and replaces with a "Watch on X" button. Avatar and mp4
    // still come from X's servers, so only the chrome is ours.
    const XS = {
        bg: "#0b0d10", text: "#e7e9ea", dim: "#71767b", line: "#3b424c", blue: "#1d9bf0",
        // Single quotes: this string goes inside a double-quoted style="..."
        // attribute, and double quotes here terminated the attribute early -
        // silently dropping every declaration after font-family, which is why
        // the cards rendered with no padding at all.
        font: `'TwitterChirp','Helvetica Neue',Helvetica,Arial,sans-serif`
    };
    const check = `<svg viewBox="0 0 22 22" width="14" height="14" aria-label="Verified"
        style="flex:0 0 14px;" fill="${XS.blue}"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816
        -.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687
        -.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44
        S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272
        -1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896
        -.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817
        .356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688
        .47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439
        .54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44
        c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681
        s.075-1.299-.163-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662
        14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>`;
    const xmark = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
        fill="${XS.text}"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817
        L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084
        4.126H5.117z"/></svg>`;
    // The post's own numbers, in X's order. Icons are X's glyphs; nothing here
    // is clickable, because a static page cannot reply or like on your behalf.
    const nfmt = (n) => {
        n = Number(n || 0);
        if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
        if (n >= 1e4) return Math.round(n / 1e3) + "K";
        if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
        return String(n);
    };
    const GLYPH = {
        replies: "M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.14 6.01l1.86-.04v2.35l5.058-2.8c1.95-1.08 3.16-3.13 3.16-5.36 0-3.39-2.74-6.13-6.129-6.13z",
        reposts: "M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z",
        likes: "M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z",
        views: "M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z"
    };
    const statRow = (st) => {
        if (!st) return "";
        const cell = (key, n) => `<span style="display:flex;align-items:center;gap:5px;">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
                 fill="currentColor" style="flex:0 0 14px;"><path d="${GLYPH[key]}"/></svg>
            ${nfmt(n)}</span>`;
        return `<div style="display:flex;align-items:center;justify-content:space-between;
                            gap:8px;margin-top:10px;padding-top:9px;
                            border-top:1px solid ${XS.line};font-size:12px;
                            color:${XS.dim};">
            ${cell("replies", st.replies)}${cell("reposts", st.reposts)}
            ${cell("likes", st.likes)}${cell("views", st.views)}
        </div>`;
    };
    const longDate = (iso) => {
        if (!iso) return "";
        const d = new Date(iso + "T12:00:00Z");
        return isNaN(d) ? iso
            : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    };

    body.innerHTML = tweets.map((t, i) => {
        const isX = !!t.url && /(?:^|\/\/|\.)(?:x|twitter)\.com\//i.test(t.url);
        // Brief description of the play for the tag line. The source text (ESPN
        // headline or tweet) already names the player, so strip a leading name so
        // it reads as the action ("powers in for a Ravens TD"), and trim length.
        const briefDesc = (() => {
            let s = (t.text || "").replace(/\s+/g, " ").trim();
            for (const nm of String(t.player || "").split("&").map(x => x.trim())) {
                if (nm && s.toLowerCase().startsWith(nm.toLowerCase()))
                    s = s.slice(nm.length).replace(/^[\s:.,–-]+/, "");
            }
            s = s.replace(/\s+#\w+/g, "").trim();      // drop trailing hashtags
            return s.length > 100 ? s.slice(0, 98).replace(/\s+\S*$/, "") + "…" : s;
        })();
        const tag = `
          <div style="margin:0 2px 5px;">
            <div style="display:flex;gap:7px;align-items:baseline;">
              <span style="font-size:11px;font-weight:700;color:#8b919c;">${esc(t.player || "")}</span>
              <span style="font-size:11px;color:#5a6070;">${esc(t.meta || "")}</span>
              ${t.game_time ? `<span style="font-size:11px;color:#4299e1;font-weight:600;">${esc(t.game_time)}</span>` : ""}
            </div>
            ${briefDesc ? `<div style="font-size:11.5px;color:#6b7280;line-height:1.35;
                          margin-top:2px;">${esc(briefDesc)}</div>` : ""}
          </div>`;
        if (!t.video) {
            // No direct mp4 resolved. Rather than fall back to X's widget -
            // which will not play these clips in place anyway - keep the card
            // and link out, so the panel stays one consistent design.
            return `<div style="margin-bottom:14px;">${tag}
              <div style="border:1px solid ${XS.line};border-radius:12px;
                          background:${XS.bg};font-family:${XS.font};padding:11px 12px;">
                <a href="${esc(t.url)}" target="_blank" rel="noopener"
                   style="font-size:13px;color:${XS.blue};text-decoration:none;">
                  View post on X →</a>
              </div></div>`;
        }
        const handle = esc(t.author || "");
        const name = esc(t.author_name || t.author || "");
        // Card chrome depends on source (isX computed above): X keeps the post
        // chrome (@handle · Follow, X mark); others link to the source, show its
        // host, and use a neutral "watch at source" corner mark.
        const srcHref = esc(t.url || "");
        const profileHref = isX ? `https://x.com/${handle}` : srcHref;
        const host = (t.url || "").replace(/^https?:\/\//, "").split("/")[0]
                                  .replace(/^www\./, "") || name;
        const extMark = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
            fill="none" stroke="${XS.dim}" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>`;
        const avatar = t.avatar
            ? `<img src="${esc(t.avatar)}" alt="" loading="lazy"
                    style="width:38px;height:38px;border-radius:50%;flex:0 0 38px;
                           object-fit:cover;background:${XS.line};">`
            : `<div style="width:38px;height:38px;border-radius:50%;flex:0 0 38px;
                           background:${XS.line};"></div>`;
        return `<div style="margin:0 2px 16px;">${tag}
          <div style="border:1px solid ${XS.line};border-radius:14px;background:${XS.bg};
                      font-family:${XS.font};padding:13px 14px 11px;">
            <div style="display:flex;gap:9px;align-items:flex-start;">
              <a href="${profileHref}" target="_blank" rel="noopener"
                 style="line-height:0;">${avatar}</a>
              <div style="min-width:0;flex:1;">
                <div style="display:flex;align-items:center;gap:4px;">
                  <a href="${profileHref}" target="_blank" rel="noopener"
                     style="font-size:13.5px;font-weight:700;color:${XS.text};
                            text-decoration:none;white-space:nowrap;overflow:hidden;
                            text-overflow:ellipsis;">${name}</a>
                  ${t.author_verified ? check : ""}
                </div>
                <div style="font-size:12.5px;color:${XS.dim};margin-top:1px;
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${isX
                    ? `@${handle} · <a href="https://x.com/${handle}" target="_blank"
                         rel="noopener" style="color:${XS.blue};text-decoration:none;
                         font-weight:400;">Follow</a>`
                    : esc(host)}
                </div>
              </div>
              <a href="${srcHref}" target="_blank" rel="noopener"
                 title="${isX ? 'View on X' : 'Watch at ' + esc(name)}"
                 style="line-height:0;flex:0 0 15px;">${isX ? xmark : extMark}</a>
            </div>
            ${(t.text && isX) ? `<div style="font-size:13px;line-height:1.45;color:${XS.text};
                                    margin:10px 0 0;white-space:pre-wrap;
                                    word-break:break-word;">${esc(t.text)}</div>` : ""}
            <div style="margin-top:10px;border:1px solid ${XS.line};border-radius:12px;
                        overflow:hidden;">
              <video class="reel-video" data-i="${i}" controls playsinline preload="none"
                     ${t.poster ? `poster="${esc(t.poster)}"` : ""}
                     style="width:100%;display:block;background:#000;
                            aspect-ratio:16/9;max-height:min(70vh,420px);object-fit:contain;">
                <source src="${esc(t.video)}" type="video/mp4">
              </video>
            </div>
            <a href="${esc(t.url)}" target="_blank" rel="noopener"
               style="display:block;margin-top:10px;font-size:12px;color:${XS.dim};
                      text-decoration:none;">${esc(longDate(t.date))}</a>
            ${statRow(t.stats)}
          </div></div>`;
    }).join("");

    // preload="none" is what defers the download. The <source> stays in the
    // markup: attaching it on the play event meant a real click had nothing to
    // load and the player sat dead.
    body.querySelectorAll("video.reel-video").forEach((v) => {
        const t = tweets[Number(v.dataset.i)] || {};
        // Most of these clips are shot on a phone - 1126x1398 is typical - so a
        // fixed 16/9 box pillarboxes them into a sliver. The poster is the same
        // shape as the video and loads without preloading the clip, so it can
        // set the real ratio up front.
        if (v.poster) {
            const probe = new Image();
            probe.onload = () => {
                if (probe.naturalWidth && probe.naturalHeight) {
                    v.style.aspectRatio = `${probe.naturalWidth} / ${probe.naturalHeight}`;
                }
            };
            probe.src = v.poster;
        }
        v.addEventListener("loadedmetadata", () => {
            if (v.videoWidth && v.videoHeight) {
                v.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
            }
        });
        v.addEventListener("play", () => {
            body.querySelectorAll("video.reel-video").forEach((o) => {
                if (o !== v && !o.paused) o.pause();
            });
        });
        v.addEventListener("error", () => {
            const d = document.createElement("div");
            d.style.cssText = "font-size:13px;color:#71767b;padding:16px 0;";
            d.innerHTML = `Clip unavailable — <a href="${esc(t.url)}" target="_blank"
                rel="noopener" style="color:#1d9bf0;">watch on X →</a>`;
            v.replaceWith(d);
        });
    });

}

// ── Roster news (Sleeper player news, aggregated + sorted newest-first) ──────
const NEWS_SOURCE_LABEL = { rotoballer:"RotoBaller", rotowire:"RotoWire", fantasy_pros:"FantasyPros" };
function newsDate(ts){ if(!ts) return ""; return new Date(ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function loadTeamNews(players){
    const body = document.getElementById("team-news-body");
    const countEl = document.getElementById("team-news-count");
    if(!body) return;
    const withId = (players||[]).filter(p => p && p.player_id && p.name);
    const results = await Promise.all(withId.map(p =>
        fetch(`https://api.sleeper.com/players/nfl/${p.player_id}/news`)
            .then(r => r.ok ? r.json() : [])
            .then(items => (Array.isArray(items)?items:[]).map(it => ({ ...it, _player: p })))
            .catch(() => [])
    ));
    const all = results.flat().filter(it => it && it.published);
    all.sort((a,b) => (b.published||0) - (a.published||0));
    if(!all.length){
        body.innerHTML = `<div style="color:#5a6070;font-size:12px;">No recent news.</div>`;
        if(countEl) countEl.textContent = "";
        return;
    }
    if(countEl) countEl.textContent = `${all.length} update${all.length===1?'':'s'}`;
    body.innerHTML = all.map((it, i) => {
        const p = it._player, m = it.metadata || {};
        const src = NEWS_SOURCE_LABEL[it.source] || it.source || "";
        const url = m.url || "";
        const title = esc(m.title || "");
        const headline = url ? `<a href="${url}" target="_blank" rel="noopener" style="color:#f0f1f3;text-decoration:none;">${title}</a>` : title;
        const pill = `<span style="background:${posColor(p.position)};color:#fff;font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;flex-shrink:0;">${esc(p.position||'?')}</span>`;
        return `<div style="padding:9px 0;${i?'border-top:1px solid #2d3139;':''}">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                ${pill}
                <span style="font-size:12px;font-weight:700;color:#c7cbd1;">${esc(p.name)}</span>
            </div>
            <div style="font-size:13px;font-weight:600;line-height:1.4;color:#f0f1f3;">${headline}</div>
            ${m.description ? `<div style="font-size:12px;color:#8b9099;margin-top:2px;line-height:1.4;">${esc(m.description)}</div>` : ""}
            <div style="font-size:11px;color:#5a6070;margin-top:3px;">${src ? `<span style="color:#4299e1;font-weight:600;">${esc(src)}</span> · ` : ""}${newsDate(it.published)}</div>
        </div>`;
    }).join("");
}

init();

window.switchDraftTab = function(btn) {
    const yr = btn.dataset.year;
    document.querySelectorAll('.draft-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.draft-tab-btn').forEach(b => b.classList.remove('draft-tab-active'));
    const target = document.getElementById('draft-tab-' + yr);
    if (target) target.style.display = 'block';
    btn.classList.add('draft-tab-active');
};
