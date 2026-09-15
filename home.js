import { api } from "./dataService.js?v=202609150609";
import { renderNav } from "./components/nav.js?v=202609150609";

const YEARS_DESC = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort().reverse();
const YEARS = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort();
let standingsData = null;
let historyData = null;
let rostersData = null;
let statsCache = {};
let usersMap = {};
let transactionsData = [];
let matchupsData = {};   // year → { week: [matchup] }
let selectedYear = "all_time";

const AVATAR_COLORS = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"];
const INACTIVE = new Set([]);
function accentColor(name) {
    return AVATAR_COLORS[(name||"?").split("").reduce((s,c)=>s+c.charCodeAt(0),0) % AVATAR_COLORS.length];
}
function avatarEl(url, name, size) {
    const sz = size || 24;
    const letter = (name||"?")[0].toUpperCase();
    if (INACTIVE.has(name)) {
        return `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:#3a3f4a;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.45)}px;font-weight:700;color:#5a6070;flex-shrink:0;">${letter}</span>`;
    }
    const color = accentColor(name);
    const fallback = `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.45)}px;font-weight:700;color:#fff;flex-shrink:0;">${letter}</span>`;
    if (url) {
        const fb = fallback.replace(/'/g,"&#39;").replace(/"/g,"&quot;");
        return `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.outerHTML='${fb}'">`;
    }
    return fallback;
}

function buildAllTimeRows() {
    const combined = {};
    YEARS.forEach(year => {
        (standingsData[year] || []).forEach(r => {
            if (!combined[r.name]) combined[r.name] = { name:r.name, wins:0, losses:0, pf:0, pa:0, seasons:0, highestPF:0 };
            const c = combined[r.name];
            c.wins += r.wins; c.losses += r.losses;
            c.pf += r.pf; c.pa += r.pa;
            c.highestPF = Math.max(c.highestPF, r.pf);
            c.seasons++;
        });
    });
    return Object.values(combined)
        .map(c => ({ ...c, avgPF: c.seasons > 0 ? c.pf / c.seasons : 0 }))
        .sort((a,b) => b.wins - a.wins || b.pf - a.pf);
}

function buildPlayoffRecords(year) {
    const records = {};
    const seasons = year === "all_time"
        ? Object.values(historyData || {})
        : [(historyData || {})[year] || {}];
    seasons.forEach(s => {
        [...(s.winners_bracket || []), ...(s.losers_bracket || [])].forEach(m => {
            if (!m.winner || !m.loser) return;
            if (!records[m.winner]) records[m.winner] = { wins:0, losses:0 };
            if (!records[m.loser])  records[m.loser]  = { wins:0, losses:0 };
            records[m.winner].wins++; records[m.loser].losses++;
        });
    });
    return records;
}

const COMPLETED_YEARS = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.completed_years) || []).slice().sort();
const PRIZE_FIRST = 250, PRIZE_SECOND = 100, PRIZE_THIRD = 50;
const SIDE_POT_PER_YEAR = 200;

function getSeasonPlacements(year) {
    const wb = ((historyData || {})[year] || {}).winners_bracket || [];
    if (!wb.length) return null;
    const maxRound = Math.max(...wb.map(m => m.round));
    const finals = wb.filter(m => m.round === maxRound).sort((a, b) => a.match - b.match);
    return { first: finals[0]?.winner, second: finals[0]?.loser, third: finals[1]?.winner };
}

function computeSidePot() {
    let pot = 0;
    const events = [];
    const champYears = {};
    for (const year of COMPLETED_YEARS) {
        const p = getSeasonPlacements(year);
        if (!p?.first) continue;
        pot += SIDE_POT_PER_YEAR;
        if (!champYears[p.first]) champYears[p.first] = [];
        champYears[p.first].push(parseInt(year));
        const yn = parseInt(year);
        if (champYears[p.first].filter(y => y >= yn - 2).length >= 2) {
            events.push({ year, winner: p.first, amount: pot });
            pot = 0;
        }
    }
    return { events, currentPot: pot };
}

function computePrizesWon() {
    const totals = {};
    const { events } = computeSidePot();
    for (const year of COMPLETED_YEARS) {
        const p = getSeasonPlacements(year);
        if (!p) continue;
        if (p.first)  totals[p.first]  = (totals[p.first]  || 0) + PRIZE_FIRST;
        if (p.second) totals[p.second] = (totals[p.second] || 0) + PRIZE_SECOND;
        if (p.third)  totals[p.third]  = (totals[p.third]  || 0) + PRIZE_THIRD;
    }
    events.forEach(e => { totals[e.winner] = (totals[e.winner] || 0) + e.amount; });
    return totals;
}

// Compute FAAB remaining for a given year per team
function computeFaabRemaining(year) {
    const BUDGET = 100;
    const spent = {};
    const result = {};
    const waivers = (transactionsData || [])
        .filter(t => t.season === year && t.type === "waiver" && t.status === "complete" && (t.waiver_bid || t.faab))
        .sort((a, b) => BigInt(a.transaction_id) < BigInt(b.transaction_id) ? -1 : 1);
    waivers.forEach(t => {
        const team = (t.teams || [])[0];
        if (!team) return;
        if (spent[team] === undefined) spent[team] = 0;
        spent[team] += (t.waiver_bid || t.faab || 0);
        result[team] = BUDGET - spent[team];
    });
    return result;
}

const POS_COLORS_HOME = { QB:"#e74c82", RB:"#3ecf8e", WR:"#4299e1", TE:"#f6ad55", K:"#9f7aea", DEF:"#64748b" };
function posColorHome(pos) { return POS_COLORS_HOME[(pos||"").toUpperCase()] || "#5a6070"; }
function teamLogoHome(abbrev) {
    if (!abbrev) return null;
    return `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${abbrev.toLowerCase()}.png`;
}

// Best player on each team's roster for the given year's stats
// For a specific year: use that year's roster + stats. Falls back to adjacent years' stats.
// For all_time: search across all years the team was active, best single-season score.
// Returns { player, score, year } or null
function bestPlayerForTeam(teamName, year) {
    const isAllTime = !year || year === "all_time";

    const allStatYears = YEARS;

    if (isAllTime) {
        // Use end-of-season roster for each year (fetched from data/YEAR/rosters.json).
        // This ensures we only credit players to a team if they were on the roster at
        // season's end — correctly handles mid-season trades (acquired or lost).
        let best = null, bestScore = -1, bestYear = null;

        for (const y of allStatYears) {
            const roster = (rostersData?.[y] || []).find(r => r.owner === teamName);
            if (!roster) continue;
            (roster.players || []).forEach(p => {
                if (!p?.player_id) return;
                const s = statsCache[y]?.[p.player_id]?.pts_half_ppr;
                if (s > 0 && s > bestScore) {
                    bestScore = s; bestYear = y; best = p;
                }
            });
        }

        return best ? { player: best, score: bestScore, year: bestYear } : null;
    }

    // Specific year: use ONLY that year's roster + that year's stats (no cross-year fallback for roster)
    const roster = (rostersData?.[year] || []).find(r => r.owner === teamName);
    if (!roster) return null;

    let best = null, bestScore = -1, bestYear = null;
    (roster.players || []).forEach(p => {
        if (!p?.player_id) return;
        const s = statsCache[year]?.[p.player_id]?.pts_half_ppr;
        if (s > 0 && s > bestScore) { bestScore = s; best = p; bestYear = year; }
    });
    return best ? { player: best, score: bestScore, year: bestYear } : null;
}

// Best single-game score for a team: { score, year, week } or null
function bestSingleGameScore(teamName, year) {
    const years = (!year || year === "all_time") ? YEARS : [year];
    let best = null;
    for (const y of years) {
        const mu = matchupsData[y] || {};
        for (const [wk, weekMatchups] of Object.entries(mu)) {
            const wkNum = Number(wk);
            if (wkNum > 14) continue; // regular season only
            (weekMatchups || []).forEach(m => {
                (m.teams || []).forEach(t => {
                    if (t.owner === teamName && t.points > 0) {
                        if (!best || t.points > best.score) {
                            best = { score: t.points, year: y, week: wkNum };
                        }
                    }
                });
            });
        }
    }
    return best;
}

// SOS = average points scored by each team's opponents across regular-season weeks
function computeSOS(yearMatchups) {
    // yearMatchups: { "1": [{matchup_id, teams:[{owner,points},...]}, ...], "2": [...], ... }
    const opp = {}; // teamName → { total: sum of opp pts, count: games }
    Object.values(yearMatchups || {}).forEach(weekMatchups => {
        (weekMatchups || []).forEach(m => {
            const teams = m.teams || [];
            if (teams.length !== 2) return;
            const [a, b] = teams;
            if (!a?.owner || !b?.owner) return;
            if (!opp[a.owner]) opp[a.owner] = { total: 0, count: 0 };
            if (!opp[b.owner]) opp[b.owner] = { total: 0, count: 0 };
            opp[a.owner].total += b.points || 0;
            opp[a.owner].count++;
            opp[b.owner].total += a.points || 0;
            opp[b.owner].count++;
        });
    });
    const result = {};
    Object.entries(opp).forEach(([name, d]) => {
        result[name] = d.count > 0 ? d.total / d.count : null;
    });
    return result;
}

function computeAllTimeSOS() {
    const opp = {};
    YEARS.forEach(year => {
        Object.values(matchupsData[year] || {}).forEach(weekMatchups => {
            (weekMatchups || []).forEach(m => {
                const teams = m.teams || [];
                if (teams.length !== 2) return;
                const [a, b] = teams;
                if (!a?.owner || !b?.owner) return;
                if (!opp[a.owner]) opp[a.owner] = { total: 0, count: 0 };
                if (!opp[b.owner]) opp[b.owner] = { total: 0, count: 0 };
                opp[a.owner].total += b.points || 0;
                opp[a.owner].count++;
                opp[b.owner].total += a.points || 0;
                opp[b.owner].count++;
            });
        });
    });
    const result = {};
    Object.entries(opp).forEach(([name, d]) => {
        result[name] = d.count > 0 ? d.total / d.count : null;
    });
    return result;
}

function buildSosRanks(rows, sosMap) {
    // Rank 1 = hardest schedule (highest avg opp PF), N = easiest
    const sorted = [...rows]
        .filter(r => sosMap?.[r.name] != null)
        .sort((a, b) => (sosMap[b.name] ?? 0) - (sosMap[a.name] ?? 0));
    const ranks = {};
    sorted.forEach((r, i) => { ranks[r.name] = i + 1; });
    return ranks;
}

function renderStandingsTable(rows, playoffRec, isAllTime, faabRemaining, sosMap) {
    const sosRanks = buildSosRanks(rows, sosMap);
    const extraHeaders = isAllTime
        ? `<th style="${TH}">Avg PF</th><th style="${TH}">Best PF</th>`
        : "";
    const faabHeader = !isAllTime ? `<th style="${TH}">FAAB Left</th>` : "";

    const header = `
        <tr style="background:#252830;">
            <th style="${TH}">#</th>
            <th style="${TH};text-align:left;min-width:140px;">Team</th>
            <th style="${TH}">RS W</th>
            <th style="${TH}">RS L</th>
            <th style="${TH}">Win%</th>
            <th style="${TH}">PF</th>
            <th style="${TH}">PA</th>
            <th style="${TH}">+/-</th>
            ${extraHeaders}
            <th style="${TH}">SOS</th>
            <th style="${TH}">PO W-L</th>
            ${faabHeader}
            <th style="${TH}">Top Player</th>
            <th style="${TH}">Top Score</th>
        </tr>`;

    const body = rows.map((r, i) => {
        const diff = (r.pf - r.pa).toFixed(1);
        const diffColor = r.pf >= r.pa ? "#3ecf8e" : "#f87171";
        const po = playoffRec[r.name];
        const poStr = po ? `${po.wins}-${po.losses}` : "—";
        const av = usersMap[r.name];
        const extraCells = isAllTime
            ? `<td style="${TD}">${r.avgPF.toFixed(1)}</td><td style="${TD}">${r.highestPF.toFixed(1)}</td>`
            : "";
        const faabLeft = !isAllTime ? faabRemaining?.[r.name] : undefined;
        const faabCell = !isAllTime
            ? `<td style="${TD};${faabLeft != null && faabLeft < 20 ? 'color:#f87171;font-weight:700;' : ''}">${faabLeft != null ? `$${faabLeft}` : "—"}</td>`
            : "";
        const bpResult = bestPlayerForTeam(r.name, isAllTime ? null : selectedYear);
        const bp = bpResult?.player;
        const bpCell = bp
            ? `<td style="${TD};text-align:left;max-width:220px;">
                <div style="display:flex;align-items:center;gap:5px;min-width:0;">
                    ${bp.team ? `<img src="${teamLogoHome(bp.team)}" style="width:14px;height:14px;object-fit:contain;flex-shrink:0;" onerror="this.style.display='none'">` : ""}
                    <span style="background:${posColorHome(bp.position)};color:#fff;font-size:9px;font-weight:800;padding:1px 5px;border-radius:3px;flex-shrink:0;">${bp.position||"?"}</span>
                    <span style="font-weight:600;color:#f0f1f3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" title="${bp.name}">${bp.name}</span>
                    ${bpResult.score > 0 ? `<div style="text-align:center;flex-shrink:0;margin-left:auto;padding-left:6px;">
                        ${isAllTime && bpResult.year ? `<div style="font-size:10px;color:#5a6070;">${bpResult.year}</div>` : ""}
                        <div style="font-weight:700;color:#f0f1f3;">${bpResult.score.toFixed(1)}</div>
                    </div>` : ""}
                </div>
              </td>`
            : `<td style="${TD}">—</td>`;

        const sos = sosMap?.[r.name];
        const sosStr = sos != null ? sosRanks[r.name] ?? "—" : "—";
        const sosCell = `<td style="${TD};color:#8b9099;">${sosStr}</td>`;

        return `<tr style="border-bottom:1px solid #2d3139;">
            <td style="${TD};color:#5a6070;font-weight:700;">${i+1}</td>
            <td style="${TD};text-align:left;">
                <div style="display:flex;align-items:center;gap:8px;">
                    ${avatarEl(av, r.name, 26)}
                    <span style="font-weight:700;color:#f0f1f3;">${r.name}</span>
                </div>
            </td>
            <td style="${TD};color:#3ecf8e;font-weight:700;">${r.wins}</td>
            <td style="${TD};color:#f87171;font-weight:700;">${r.losses}</td>
            <td style="${TD}">${(r.wins + r.losses) > 0 ? ((r.wins / (r.wins + r.losses)) * 100).toFixed(1) + "%" : "—"}</td>
            <td style="${TD}">${r.pf.toFixed(1)}</td>
            <td style="${TD}">${r.pa.toFixed(1)}</td>
            <td style="${TD};color:${diffColor};font-weight:700;">${diff > 0 ? "+" : ""}${diff}</td>
            ${extraCells}
            ${sosCell}
            <td style="${TD}">${poStr}</td>
            ${faabCell}
            ${bpCell}
            ${(() => {
                const bg = bestSingleGameScore(r.name, isAllTime ? null : selectedYear);
                if (!bg) return `<td style="${TD}">—</td>`;
                const label = isAllTime ? `<div style="font-size:10px;color:#5a6070;">${bg.year} Wk${bg.week}</div>` : `<div style="font-size:10px;color:#5a6070;">Wk ${bg.week}</div>`;
                return `<td style="${TD};text-align:center;">${label}<div style="font-weight:700;color:#f0f1f3;">${bg.score.toFixed(2)}</div></td>`;
            })()}
        </tr>`;
    }).join("");

    return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;background:#1e2027;border-radius:12px;overflow:hidden;min-width:680px;">
            <thead>${header}</thead>
            <tbody>${body}</tbody>
        </table>
    </div>`;
}

const TH = "padding:10px 12px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;font-weight:700;white-space:nowrap;border-bottom:1px solid #2d3139;";
const TD = "padding:10px 12px;text-align:center;color:#c9cdd4;white-space:nowrap;";

function updateStandings() {
    const isAllTime = selectedYear === "all_time";
    const rows = isAllTime ? buildAllTimeRows() : (standingsData[selectedYear] || []);
    const playoffRec = buildPlayoffRecords(selectedYear);
    const faabRemaining = !isAllTime ? computeFaabRemaining(selectedYear) : {};
    const sosMap = isAllTime ? computeAllTimeSOS() : computeSOS(matchupsData[selectedYear]);
    document.getElementById("home-standings-table").innerHTML = renderStandingsTable(rows, playoffRec, isAllTime, faabRemaining, sosMap);
}

// ── League Rules ──────────────────────────────────────────────

const PAYOUTS = [
    { bracket:"Playoff",     rank:"1st",  prize:"$250", pick:"12th" },
    { bracket:"Playoff",     rank:"2nd",  prize:"$100", pick:"11th" },
    { bracket:"Playoff",     rank:"3rd",  prize:"$50",  pick:"10th" },
    { bracket:"Playoff",     rank:"4th",  prize:"—",    pick:"9th" },
    { bracket:"Playoff",     rank:"5th–8th", prize:"—", pick:"5th–8th" },
    { bracket:"Consolation", rank:"9th",  prize:"—",    pick:"4th" },
    { bracket:"Consolation", rank:"10th", prize:"—",    pick:"3rd" },
    { bracket:"Consolation", rank:"11th", prize:"—",    pick:"2nd" },
    { bracket:"Consolation", rank:"12th", prize:"—",    pick:"1st" },
];

function buildFeesTable() {
    return "";   // League finances unknown — no fabricated fee history until commissioner confirms
    const ALL_YEARS = YEARS;
    const userYearsMap = {};
    ALL_YEARS.forEach(year => {
        (standingsData[year] || []).forEach(r => {
            if (!userYearsMap[r.name]) userYearsMap[r.name] = new Set();
            userYearsMap[r.name].add(year);
        });
    });

    const prizesWon = computePrizesWon();
    const { events: sidePotEvents, currentPot } = computeSidePot();

    const feeRows = Object.entries(userYearsMap).map(([name, yearsSet]) => {
        const firstYear = [...yearsSet].sort()[0];
        let totalPaid = 0;
        const yearFees = {};
        ALL_YEARS.forEach(year => {
            if (!yearsSet.has(year)) { yearFees[year] = null; return; }
            const fee = year === firstYear ? 100 : 50;
            yearFees[year] = fee;
            totalPaid += fee;
        });
        return { name, yearFees, totalPaid, totalWon: prizesWon[name] || 0, av: usersMap[name] };
    }).sort((a, b) => b.totalWon - a.totalWon || b.totalPaid - a.totalPaid);

    const totalPool = feeRows.reduce((s, r) => s + r.totalPaid, 0);
    const totalWonAll = feeRows.reduce((s, r) => s + r.totalWon, 0);

    const sidePotNote = sidePotEvents.map(e =>
        `<span style="color:#fbbf24;font-weight:700;">${e.winner}</span> claimed <span style="color:#3ecf8e;font-weight:700;">$${e.amount}</span> side pot after winning in ${e.year} (2× in 3 years)`
    ).join(" · ");

    const yearHeaders = ALL_YEARS.map(y => `<th style="${TH}">${y}</th>`).join("");

    const rows = feeRows.map(r => {
        const yearCells = ALL_YEARS.map(year => {
            const fee = r.yearFees[year];
            if (fee === null) return `<td style="${TD};color:#2d3139;">—</td>`;
            return `<td style="${TD};${fee === 100 ? 'color:#fbbf24;font-weight:700;' : 'color:#8b9099;}'}">$${fee}</td>`;
        }).join("");
        const net = r.totalWon - r.totalPaid;
        const netStr = net === 0 ? "$0" : net > 0 ? `+$${net}` : `-$${Math.abs(net)}`;
        const netColor = net > 0 ? "#3ecf8e" : net < 0 ? "#f87171" : "#8b9099";
        return `<tr style="border-bottom:1px solid #2d3139;">
            <td style="${TD};text-align:left;">
                <div style="display:flex;align-items:center;gap:8px;">
                    ${avatarEl(r.av, r.name, 22)}
                    <span style="font-weight:600;color:#f0f1f3;font-size:12px;">${r.name}</span>
                </div>
            </td>
            ${yearCells}
            <td style="${TD};color:#f87171;font-weight:700;">$${r.totalPaid}</td>
            <td style="${TD};color:#3ecf8e;font-weight:700;">${r.totalWon > 0 ? '$' + r.totalWon : '—'}</td>
            <td style="${TD};color:${netColor};font-weight:700;">${netStr}</td>
        </tr>`;
    }).join("");

    return `
        <div style="background:#1e2027;border:1px solid #2d3139;border-radius:10px;padding:16px;margin-top:16px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#5a6070;font-weight:700;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #2d3139;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <span>Fee History</span>
                <span style="color:#fbbf24;font-size:11px;text-transform:none;letter-spacing:0;">Total Collected: $${totalPool}</span>
            </div>
            ${sidePotNote ? `<div style="font-size:11px;color:#8b9099;margin-bottom:10px;padding:8px 10px;background:#252830;border-radius:6px;">${sidePotNote}</div>` : ''}
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:560px;">
                    <thead>
                        <tr style="background:#252830;">
                            <th style="${TH};text-align:left;">Manager</th>
                            ${yearHeaders}
                            <th style="${TH}">Total Paid</th>
                            <th style="${TH}">Total Won</th>
                            <th style="${TH}">Net</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                    <tfoot>
                        <tr style="background:#252830;border-top:2px solid #3d4149;">
                            <td style="${TD};text-align:left;font-weight:700;color:#5a6070;font-size:10px;text-transform:uppercase;">Total</td>
                            ${ALL_YEARS.map(() => `<td style="${TD}"></td>`).join("")}
                            <td style="${TD};color:#f87171;font-weight:700;">$${totalPool}</td>
                            <td style="${TD};color:#3ecf8e;font-weight:700;">$${totalWonAll}</td>
                            <td style="${TD};color:#5a6070;">—</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            ${currentPot > 0 ? `<div style="margin-top:10px;padding:8px 12px;background:#1a2010;border:1px solid #3ecf8e44;border-radius:6px;font-size:11px;display:flex;justify-content:space-between;align-items:center;"><span style="color:#8b9099;">Current Side Pot</span><span style="color:#3ecf8e;font-weight:700;font-size:13px;">$${currentPot}</span></div>` : ''}
        </div>`;
}

const FORMAT_ITEMS = [
    ["League Type", "Redraft"],
    ["Teams", "8"],
    ["Scoring", "PPR"],
    ["Seasons", "Since 2024"],
    ["Playoffs", "6 teams · Weeks 15–17"],
];
const STARTERS = ["QB", "QB", "RB", "RB", "RB", "WR", "WR", "WR", "WR", "TE", "TE", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX", "K", "DEF"];

function renderRules() {
    return `
    <div style="margin-bottom:32px;">
        <div style="background:#1e2027;border:1px solid #2d3139;border-radius:10px;padding:16px;margin-bottom:16px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#5a6070;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #2d3139;">League Format</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px 24px;">
                ${FORMAT_ITEMS.map(([label, val]) => `
                    <div>
                        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;font-weight:700;margin-bottom:4px;">${label}</div>
                        <div style="font-size:14px;font-weight:600;color:#f0f1f3;">${val}</div>
                    </div>`).join("")}
            </div>
            <div style="margin-top:16px;padding-top:14px;border-top:1px solid #2d3139;">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;font-weight:700;margin-bottom:8px;">Starting Lineup</div>
                <div style="display:flex;flex-wrap:wrap;gap:5px;">
                    ${STARTERS.map(p => `<span style="background:#252830;color:#c9cdd4;border-radius:5px;padding:3px 8px;font-size:11px;font-weight:600;">${p}</span>`).join("")}
                    <span style="background:#252830;color:#5a6070;border-radius:5px;padding:3px 8px;font-size:11px;font-weight:600;">13× BN</span>
                </div>
            </div>
        </div>
        <div style="padding:8px 10px;background:#252830;border-radius:8px;font-size:11px;color:#5a6070;line-height:1.5;">
            Redraft league — rosters reset each season. Prize pool &amp; entry fees are set by the commissioner — add them here when confirmed.
        </div>
        <div id="home-fees-table"></div>
    </div>`;
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();

    const container = document.getElementById("home-container");

    container.innerHTML = `
    <style>
        #home-container { max-width: 1100px; }
        .rules-grid { grid-template-columns: 1fr 1fr; }
        @media (max-width: 700px) {
            .rules-grid { grid-template-columns: 1fr !important; }
        }
    </style>
    <div id="home-rules"><div style="color:#5a6070;padding:20px 0;">Loading...</div></div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px;margin-top:4px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#5a6070;font-weight:700;">Standings</div>
        <select id="home-year-select">
            <option value="all_time" selected>All Years</option>
            ${YEARS_DESC.map(y => `<option value="${y}">${y}</option>`).join("")}
        </select>
    </div>
    <div id="home-standings-table" style="color:#5a6070;padding:20px 0;">Loading...</div>`;

    try {
        const [standings, history, leagueUsers, transactions, rostersByYear, matchupsByYear] = await Promise.all([
            api.getStandings(),
            api.getSeasonHistory(),
            api.getLeagueUsers(),
            api.getTransactions(),
            Promise.all(YEARS.map(y => api.getRosters(y).catch(() => []))),
            Promise.all(YEARS.map(y => api.getMatchups(y).catch(() => ({})))),
        ]);

        standingsData = standings;
        historyData = history;
        transactionsData = transactions || [];
        matchupsData = Object.fromEntries(YEARS.map((y, i) => [y, matchupsByYear[i] || {}]));
        rostersData  = Object.fromEntries(YEARS.map((y, i) => [y, rostersByYear[i] || []]));
        (leagueUsers || []).forEach(u => { usersMap[u.username] = u.avatar_url; });

        // Load stats for best player column (all years)
        const statYears = YEARS;
        const loaded = await Promise.all(statYears.map(y => api.getPlayerStats(y).catch(() => ({}))));
        statYears.forEach((y, i) => { statsCache[y] = loaded[i] || {}; });

        document.getElementById("home-year-select").addEventListener("change", e => {
            selectedYear = e.target.value;
            updateStandings();
        });

        document.getElementById("home-rules").innerHTML = renderRules();
        document.getElementById("home-fees-table").innerHTML = buildFeesTable();
        updateStandings();

    } catch (err) {
        console.error(err);
        container.innerHTML = `<div style="color:#f87171;padding:20px;">Failed to load home data.</div>`;
    }
}

init();
