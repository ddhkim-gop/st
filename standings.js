import { api } from "./dataService.js?v=202609150609";
import { renderNav } from "./components/nav.js?v=202609150609";

let standings = null;
let transactions = null;
let seasonHistory = null;
let leagueUsers = [];
let divisionsData = {};
let allPlayerStats = {};
let allDraftData = {};
let playerNameMap = {};
let currentView = "all_time";
let currentPage = location.hash === "#report_card" ? "report_card" : "standings";

const FAAB_BUDGET = 100;
const YEARS = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort().reverse();
const STAT_YEARS = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.completed_years) || []).slice().sort(); // completed seasons with full stats

function computeFaabRemaining(year) {
    const spent = {};
    const result = {};
    const waivers = (transactions || [])
        .filter(t => t.season === year && t.type === "waiver" && t.status === "complete" && (t.waiver_bid || t.faab))
        .sort((a, b) => BigInt(a.transaction_id) < BigInt(b.transaction_id) ? -1 : 1);
    waivers.forEach(t => {
        const team = (t.teams || [])[0];
        if (!team) return;
        if (spent[team] === undefined) spent[team] = 0;
        spent[team] += (t.waiver_bid || t.faab || 0);
        result[team] = FAAB_BUDGET - spent[team];
    });
    return result;
}

const INACTIVE = new Set(['edgxrjiang', 'riqi', 'shmyung', 'urmummma', 'JUNNNNAY']);
function avatarEl(name, size) {
    const sz = size || 24;
    const letter = (name||"?")[0].toUpperCase();
    if (INACTIVE.has(name)) {
        return `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:#3a3f4a;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.45)}px;font-weight:700;color:#5a6070;flex-shrink:0;">${letter}</span>`;
    }
    const u = leagueUsers.find(u => u.username === name);
    const url = u?.avatar_url;
    if (url) {
        const color = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"][(name||"?").split("").reduce((s,c)=>s+c.charCodeAt(0),0) % 8];
        const fb = `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.45)}px;font-weight:700;color:#fff;flex-shrink:0;">${letter}</span>`.replace(/'/g,"&#39;").replace(/"/g,"&quot;");
        return `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.outerHTML='${fb}'">`;
    }
    const clr = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"][(name||"?").split("").reduce((s,c)=>s+c.charCodeAt(0),0) % 8];
    return `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:${clr};display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.45)}px;font-weight:700;color:#fff;flex-shrink:0;">${letter}</span>`;
}

function buildTxStats(txData) {
    const stats = {};
    (txData || []).forEach(t => {
        if (t.status === "failed") return;
        if (t.type === "commissioner") return;
        const year = t.season;
        if (!stats[year]) stats[year] = {};
        (t.teams || []).forEach(name => {
            if (!stats[year][name]) stats[year][name] = { total: 0, trades: 0, waivers: 0, fa: 0 };
            stats[year][name].total++;
            if (t.type === "trade")       stats[year][name].trades++;
            if (t.type === "waiver")      stats[year][name].waivers++;
            if (t.type === "free_agent")  stats[year][name].fa++;
        });
    });
    return stats;
}

function buildPlayoffRecords(historyData, year) {
    const records = {};
    const season = (historyData || {})[year] || {};
    function processMatch(m) {
        if (!m.winner || !m.loser) return;
        if (!records[m.winner]) records[m.winner] = { wins: 0, losses: 0 };
        if (!records[m.loser])  records[m.loser]  = { wins: 0, losses: 0 };
        records[m.winner].wins++;
        records[m.loser].losses++;
    }
    (season.winners_bracket || []).forEach(processMatch);
    (season.losers_bracket  || []).forEach(processMatch);
    return records;
}

function buildAllTimePlayoffRecords(historyData) {
    const records = {};
    Object.values(historyData || {}).forEach(season => {
        function processMatch(m) {
            if (!m.winner || !m.loser) return;
            if (!records[m.winner]) records[m.winner] = { wins: 0, losses: 0 };
            if (!records[m.loser])  records[m.loser]  = { wins: 0, losses: 0 };
            records[m.winner].wins++;
            records[m.loser].losses++;
        }
        (season.winners_bracket || []).forEach(processMatch);
        (season.losers_bracket  || []).forEach(processMatch);
    });
    return records;
}

function buildAllTime(standingsData, txStats) {
    const combined = {};
    const seasonCounts = {};

    YEARS.forEach(year => {
        (standingsData[year] || []).forEach(row => {
            if (!combined[row.name]) {
                combined[row.name] = {
                    name: row.name, wins: 0, losses: 0, pf: 0, pa: 0,
                    total: 0, trades: 0, waivers: 0, fa: 0, highestPF: 0
                };
                seasonCounts[row.name] = 0;
            }
            const c = combined[row.name];
            c.wins    += row.wins;
            c.losses  += row.losses;
            c.pf      += row.pf;
            c.pa      += row.pa;
            c.highestPF = Math.max(c.highestPF, row.pf);
            seasonCounts[row.name]++;

            const tx = txStats[year]?.[row.name] || {};
            c.total   += tx.total   || 0;
            c.trades  += tx.trades  || 0;
            c.waivers += tx.waivers || 0;
            c.fa      += tx.fa      || 0;
        });
    });

    return Object.values(combined).map(r => ({
        ...r,
        seasons: seasonCounts[r.name] || 1,
        avgPF: r.pf / (seasonCounts[r.name] || 1),
    })).sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}

// ── Report Card logic ──────────────────────────────────────────────────────

function buildDraftGrades() {
    // Grade each team on drafted players present on their END-OF-SEASON ROSTER
    // (regardless of who originally drafted them — trades factor in naturally).
    // Surplus = player's actual pts − avg pts for that draft round.
    const endRosters = computeEndOfSeasonRosters();
    const result = {};

    STAT_YEARS.forEach(year => {
        const yearDraft = allDraftData[year] || [];
        if (!yearDraft.length) return;
        const stats = allPlayerStats[year] || {};

        // Build name → { round, pts } for every drafted player this year
        const draftedPlayers = {};
        yearDraft.forEach(pick => {
            const pid = playerNameMap[pick.player];
            const pts = pid && stats[pid] ? stats[pid].pts_half_ppr : null;
            if (pts != null) draftedPlayers[pick.player] = { round: pick.round, pts };
        });

        // Round average across all drafted players
        const roundAvg = {};
        Object.values(draftedPlayers).forEach(({ round, pts }) => {
            if (!roundAvg[round]) roundAvg[round] = { sum: 0, count: 0 };
            roundAvg[round].sum += pts;
            roundAvg[round].count++;
        });
        Object.keys(roundAvg).forEach(r => {
            roundAvg[r].avg = roundAvg[r].sum / roundAvg[r].count;
        });

        // For each team: find drafted players on their end-of-season roster
        const teamSurplus = {};
        const yearRosters = endRosters[year] || {};
        Object.entries(yearRosters).forEach(([team, playerNames]) => {
            playerNames.forEach(name => {
                const dp = draftedPlayers[name];
                if (!dp) return; // not a player drafted this year
                const expected = roundAvg[dp.round]?.avg || 0;
                if (!teamSurplus[team]) teamSurplus[team] = { sum: 0, count: 0 };
                teamSurplus[team].sum += dp.pts - expected;
                teamSurplus[team].count++;
            });
        });

        result[year] = {};
        Object.entries(teamSurplus).forEach(([team, d]) => {
            result[year][team] = d.count > 0 ? d.sum / d.count : 0;
        });
    });
    return result;
}

function buildTradeGrades() {
    // Returns { manager: { totalNetValue, count } }
    const result = {};
    (transactions || [])
        .filter(t => t.type === "trade" && t.status === "complete" && STAT_YEARS.includes(t.season))
        .forEach(t => {
            const stats = allPlayerStats[t.season] || {};
            t.teams.forEach(team => {
                if (!result[team]) result[team] = { totalNetValue: 0, count: 0 };
                const received = (t.assets_received?.[team] || []).filter(a => a.position !== "PICK");
                const given = t.teams
                    .filter(ot => ot !== team)
                    .flatMap(ot => (t.assets_received?.[ot] || []).filter(a => a.position !== "PICK"));

                const ptsFor = (arr) => arr.reduce((sum, p) => {
                    const pid = playerNameMap[p.name];
                    return sum + (pid && stats[pid] ? stats[pid].pts_half_ppr : 0);
                }, 0);

                const ptsReceived = ptsFor(received);
                const ptsGiven = ptsFor(given);
                const total = received.length + given.length;
                const net = total > 0 ? (ptsReceived - ptsGiven) / total : 0;
                result[team].totalNetValue += net;
                result[team].count++;
            });
        });
    return result;
}

function buildWaiverGrades() {
    // Returns { manager: { hits, total } } — "hit" = waiver add scored above median
    const claims = [];
    (transactions || [])
        .filter(t => t.type === "waiver" && t.status === "complete" && STAT_YEARS.includes(t.season))
        .forEach(t => {
            const stats = allPlayerStats[t.season] || {};
            const team = (t.teams || [])[0];
            if (!team) return;
            (t.added || []).forEach(p => {
                if (p.position === "K" || p.position === "DEF") return;
                const pid = playerNameMap[p.name];
                const pts = pid && stats[pid] ? stats[pid].pts_half_ppr : null;
                claims.push({ team, pts });
            });
        });

    const validPts = claims.filter(c => c.pts != null).map(c => c.pts).sort((a, b) => a - b);
    const median = validPts.length ? validPts[Math.floor(validPts.length / 2)] : 0;

    const result = {};
    claims.forEach(({ team, pts }) => {
        if (!result[team]) result[team] = { hits: 0, total: 0 };
        result[team].total++;
        if (pts != null && pts > median) result[team].hits++;
    });
    return result;
}

function computeEndOfSeasonRosters() {
    // Reconstruct each team's roster at end of each completed season
    // using draft picks + transactions processed in order
    const result = {}; // { year: { team: Set<playerName> } }

    STAT_YEARS.forEach(year => {
        const rosters = {};
        result[year] = rosters;

        // Seed with draft picks
        (allDraftData[year] || []).forEach(pick => {
            if (!rosters[pick.picked_by]) rosters[pick.picked_by] = new Set();
            rosters[pick.picked_by].add(pick.player);
        });

        // Apply transactions chronologically
        const yearTx = (transactions || [])
            .filter(t => t.season === year && t.status === "complete")
            .sort((a, b) => {
                const ai = BigInt(a.transaction_id || 0);
                const bi = BigInt(b.transaction_id || 0);
                return ai < bi ? -1 : ai > bi ? 1 : 0;
            });

        yearTx.forEach(t => {
            if (t.type === "trade") {
                (t.teams || []).forEach(team => {
                    if (!rosters[team]) rosters[team] = new Set();
                    (t.assets_received?.[team] || []).forEach(asset => {
                        if (asset.position === "PICK") return;
                        rosters[team].add(asset.name);
                        (t.teams || []).filter(ot => ot !== team).forEach(ot => {
                            rosters[ot]?.delete(asset.name);
                        });
                    });
                });
            } else if (t.type === "waiver" || t.type === "free_agent") {
                const team = (t.teams || [])[0];
                if (!team) return;
                if (!rosters[team]) rosters[team] = new Set();
                (t.added   || []).forEach(p => rosters[team].add(p.name));
                (t.dropped || []).forEach(p => rosters[team].delete(p.name));
            }
        });
    });

    return result;
}

function computeRosterValues() {
    // For each team, sum pts_half_ppr of their end-of-season roster per year, then average
    const endRosters = computeEndOfSeasonRosters();
    const result = {}; // { manager: { yearValues: {year: pts}, avgValue } }

    STAT_YEARS.forEach(year => {
        const stats = allPlayerStats[year] || {};
        Object.entries(endRosters[year] || {}).forEach(([team, playerNames]) => {
            if (!result[team]) result[team] = { yearValues: {}, avgValue: 0 };
            let total = 0;
            playerNames.forEach(name => {
                const pid = playerNameMap[name];
                if (pid && stats[pid]) total += stats[pid].pts_half_ppr;
            });
            result[team].yearValues[year] = total;
        });
    });

    Object.values(result).forEach(m => {
        const vals = Object.values(m.yearValues).filter(v => v > 0);
        m.avgValue = vals.length > 0 ? vals.reduce((a,b) => a+b) / vals.length : 0;
    });

    return result;
}

function computeManagerStats() {
    const draftGrades = buildDraftGrades();
    const tradeGrades = buildTradeGrades();
    const waiverGrades = buildWaiverGrades();
    const managers = {};

    YEARS.forEach(year => {
        const seasonStandings = (standings || {})[year] || [];
        const season = (seasonHistory || {})[year] || {};
        const winners = season.winners_bracket || [];
        const champMatch  = winners.find(m => m.place === 1);
        const place3Match = winners.find(m => m.place === 3);
        const champ    = champMatch?.winner;
        const finalist = champMatch?.loser;
        const third    = place3Match?.winner;
        const playoffTeams = new Set(winners.flatMap(m => [m.winner, m.loser].filter(Boolean)));

        seasonStandings.forEach((row, idx) => {
            const name = row.name;
            if (!managers[name]) {
                managers[name] = {
                    name, seasons: 0, completedSeasons: 0,
                    totalWins: 0, totalLosses: 0, totalPF: 0, totalPA: 0,
                    first: 0, second: 0, third: 0, playoffAppearances: 0,
                    seeds: [], pyLuck: 0,
                    draftSurpluses: [],
                    tradeValue: 0, tradeCount: 0,
                    waiverHits: 0, waiverTotal: 0,
                };
            }
            const m = managers[name];
            const isCompleted = STAT_YEARS.includes(year);
            m.seasons++;
            if (isCompleted) m.completedSeasons++;
            m.totalWins    += row.wins;
            m.totalLosses  += row.losses;
            m.totalPF      += row.pf;
            m.totalPA      += row.pa;
            if (name === champ)    m.first++;
            if (name === finalist) m.second++;
            if (name === third)    m.third++;
            if (isCompleted && playoffTeams.has(name)) m.playoffAppearances++;
            m.seeds.push(idx + 1);

            // Pythagorean luck (actual wins vs expected from PF/PA ratio)
            const games = row.wins + row.losses;
            const pyWins = games > 0 ? (row.pf ** 2) / (row.pf ** 2 + row.pa ** 2) * games : 0;
            m.pyLuck += row.wins - pyWins;

            // Draft surplus for this year
            const ds = draftGrades[year]?.[name];
            if (ds !== undefined) m.draftSurpluses.push(ds);
        });
    });

    // Merge trade and waiver grades
    Object.values(managers).forEach(m => {
        const tg = tradeGrades[m.name];
        if (tg) { m.tradeValue = tg.totalNetValue; m.tradeCount = tg.count; }
        const wg = waiverGrades[m.name];
        if (wg) { m.waiverHits = wg.hits; m.waiverTotal = wg.total; }
    });

    return Object.values(managers);
}

function normalize(val, min, max) {
    if (max === min) return 50;
    return Math.max(0, Math.min(100, (val - min) / (max - min) * 100));
}

function scoreToGrade(score) {
    if (score >= 93) return "A+";
    if (score >= 90) return "A";
    if (score >= 87) return "A-";
    if (score >= 83) return "B+";
    if (score >= 80) return "B";
    if (score >= 77) return "B-";
    if (score >= 73) return "C+";
    if (score >= 70) return "C";
    if (score >= 67) return "C-";
    if (score >= 60) return "D";
    return "F";
}

function gradeColor(grade) {
    if (!grade || grade === "—") return "#5a6070";
    const g = grade[0];
    if (g === "A") return "#3ecf8e";
    if (g === "B") return "#60a5fa";
    if (g === "C") return "#fbbf24";
    if (g === "D") return "#f97316";
    return "#f87171";
}

function computeGrades(allManagers) {
    const pick = (fn) => allManagers.map(fn);

    const playoffRates  = pick(m => m.completedSeasons > 0 ? m.playoffAppearances / m.completedSeasons : 0);
    const winRates      = pick(m => (m.totalWins + m.totalLosses) > 0 ? m.totalWins / (m.totalWins + m.totalLosses) : 0);
    const champRates    = pick(m => m.seasons > 0 ? m.first / m.seasons : 0);
    const avgSeeds      = pick(m => m.seeds.length > 0 ? m.seeds.reduce((a,b) => a+b) / m.seeds.length : 12);
    const pyLucks       = pick(m => m.pyLuck);
    const draftScores   = pick(m => m.draftSurpluses.length > 0 ? m.draftSurpluses.reduce((a,b) => a+b) / m.draftSurpluses.length : 0);
    const tradeScores   = pick(m => m.tradeCount > 0 ? m.tradeValue / m.tradeCount : 0);
    const waiverRates   = pick(m => m.waiverTotal > 0 ? m.waiverHits / m.waiverTotal : 0);

    const mm = arr => [Math.min(...arr), Math.max(...arr)];
    const [prMin, prMax] = mm(playoffRates);
    const [wrMin, wrMax] = mm(winRates);
    const [crMin, crMax] = mm(champRates);
    const [asMin, asMax] = mm(avgSeeds);
    const [plMin, plMax] = mm(pyLucks);
    const [dsMin, dsMax] = mm(draftScores);
    const [tsMin, tsMax] = mm(tradeScores);
    const [waMin, waMax] = mm(waiverRates);

    return allManagers.map((m, i) => {
        const playoffScore  = normalize(playoffRates[i], prMin, prMax);
        const winScore      = normalize(winRates[i], wrMin, wrMax);
        const champScore    = normalize(champRates[i], crMin, crMax);
        const seedScore     = normalize(-avgSeeds[i], -asMax, -asMin); // lower seed = better
        const luckScore     = normalize(pyLucks[i], plMin, plMax);
        const draftScore    = normalize(draftScores[i], dsMin, dsMax);
        const tradeScore    = normalize(tradeScores[i], tsMin, tsMax);
        const waiverScore   = normalize(waiverRates[i], waMin, waMax);

        const hasDraft  = m.draftSurpluses.length > 0;
        const hasTrade  = m.tradeCount > 0;
        const hasWaiver = m.waiverTotal > 0;

        const composite =
            champScore   * 0.45 +
            seedScore    * 0.15 +
            winScore     * 0.15 +
            playoffScore * 0.10 +
            (hasTrade  ? tradeScore  : 50) * 0.06 +
            (hasDraft  ? draftScore  : 50) * 0.05 +
            (hasWaiver ? waiverScore : 50) * 0.04;

        return {
            ...m,
            playoffRate:   playoffRates[i],
            winRate:       winRates[i],
            avgSeed:       avgSeeds[i],
            draftSurpAvg:  draftScores[i],
            tradeValueAvg: tradeScores[i],
            waiverRate:    waiverRates[i],
            composite,
            draftGrade:   hasDraft  ? scoreToGrade(draftScore)  : "—",
            tradeGrade:   hasTrade  ? scoreToGrade(tradeScore)  : "—",
            waiverGrade:  hasWaiver ? scoreToGrade(waiverScore) : "—",
        };
    });
}

function metricCell(label, value, color) {
    const c = color || "#f0f1f3";
    return `
        <div style="background:#252830;border-radius:8px;padding:10px 12px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;margin-bottom:4px;">${label}</div>
            <div style="font-size:16px;font-weight:700;color:${c};">${value}</div>
        </div>
    `;
}

function gradeCell(label, grade) {
    const c = gradeColor(grade);
    return `
        <div style="background:#252830;border-radius:8px;padding:10px 12px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;margin-bottom:4px;">${label}</div>
            <div style="font-size:20px;font-weight:800;color:${c};">${grade || "—"}</div>
        </div>
    `;
}

function gradeWeightRow(label, pct, desc) {
    const barW = Math.round(pct * 3.5); // max 70px for 20%
    return `
        <div style="background:#252830;border-radius:8px;padding:10px 12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
                <span style="font-size:12px;font-weight:700;color:#c9cdd4;">${label}</span>
                <span style="font-size:12px;font-weight:800;color:#3ecf8e;">${pct}%</span>
            </div>
            <div style="height:4px;background:#1e2027;border-radius:2px;margin-bottom:6px;">
                <div style="height:4px;width:${barW}px;max-width:100%;background:#3ecf8e;border-radius:2px;"></div>
            </div>
            <div style="font-size:10px;color:#5a6070;">${desc}</div>
        </div>
    `;
}

function renderReportCard() {
    const allManagers = computeManagerStats();
    const computed    = computeGrades(allManagers);
    const rosterVals  = computeRosterValues();

    // Merge roster values onto each manager
    computed.forEach(m => {
        const rv = rosterVals[m.name] || { avgValue: 0, yearValues: {} };
        m.rosterValue     = rv.avgValue;
        m.rosterYearVals  = rv.yearValues;
    });

    // Active = in current year's standings
    const currentYear = YEARS[0];   // YEARS is newest-first
    const activeNow = new Set(((standings || {})[currentYear] || []).map(r => r.name));
    const active   = computed.filter(m =>  activeNow.has(m.name)).sort((a, b) => b.composite - a.composite);
    const inactive = computed.filter(m => !activeNow.has(m.name)).sort((a, b) => b.composite - a.composite);
    const allSorted = [...active, ...inactive];

    // Rank-based grading by roster value: top → A+, bottom → F
    const GRADE_SCALE = ["A+","A","A-","B+","B","B-","C+","C","C-","D+","D","F"];
    allSorted.forEach((m, i) => {
        const pct = allSorted.length > 1 ? i / (allSorted.length - 1) : 0;
        m.grade    = GRADE_SCALE[Math.round(pct * (GRADE_SCALE.length - 1))];
        m.isActive = activeNow.has(m.name);
    });

    let html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;">`;

    allSorted.forEach(m => {
        const playoffPct   = (m.playoffRate * 100).toFixed(0) + "%";
        const winPct       = (m.winRate * 100).toFixed(1) + "%";
        const avgSeedStr   = m.avgSeed.toFixed(1);
        const pfPerGame    = (m.totalWins + m.totalLosses) > 0
            ? (m.totalPF / (m.totalWins + m.totalLosses)).toFixed(1) : "—";
        const pyLuck       = m.pyLuck.toFixed(1);
        const pyLuckStr    = m.pyLuck >= 0 ? `+${pyLuck}` : pyLuck;
        const pyLuckColor  = m.pyLuck > 2 ? "#3ecf8e" : m.pyLuck < -2 ? "#f87171" : "#c9cdd4";
        const playoffColor = m.playoffRate >= 0.75 ? "#3ecf8e" : m.playoffRate >= 0.5 ? "#60a5fa" : "#f87171";

        const gc = m.isActive ? gradeColor(m.grade) : "#5a6070";

        // Podium row — always shown for consistent card height
        const podiumParts = [
            `<span style="font-size:13px;font-weight:700;color:${m.first  ? '#f0f1f3' : '#3a3d47'};">🥇<span style="color:${m.first  ? '#fbbf24' : '#3a3d47'};">×${m.first  || 0}</span></span>`,
            `<span style="font-size:13px;font-weight:700;color:${m.second ? '#f0f1f3' : '#3a3d47'};">🥈<span style="color:${m.second ? '#c8d6e5' : '#3a3d47'};">×${m.second || 0}</span></span>`,
            `<span style="font-size:13px;font-weight:700;color:${m.third  ? '#f0f1f3' : '#3a3d47'};">🥉<span style="color:${m.third  ? '#cd9b5a' : '#3a3d47'};">×${m.third  || 0}</span></span>`,
        ];
        const podiumRow = `<div style="display:flex;gap:12px;align-items:center;background:#252830;border-radius:8px;padding:8px 12px;margin-bottom:12px;">${podiumParts.join("")}</div>`;

        const inactiveBadge = !m.isActive
            ? `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;margin-bottom:8px;">Inactive</div>`
            : "";

        html += `
            <div class="card" style="padding:20px;background:#1e2027;border-color:#2d3139;${!m.isActive ? "opacity:0.7;" : ""}">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                    ${avatarEl(m.name, 40)}
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:15px;font-weight:700;color:#f0f1f3;">${m.name}</div>
                        <div style="font-size:11px;color:#5a6070;">${m.seasons} season${m.seasons !== 1 ? "s" : ""}</div>
                        <div style="font-size:11px;color:#5a6070;">${m.totalWins}W-${m.totalLosses}L</div>
                    </div>
                    <div style="text-align:center;background:${gc}1a;border:1.5px solid ${gc};border-radius:10px;padding:6px 14px;flex-shrink:0;">
                        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${gc};opacity:0.8;margin-bottom:2px;">Overall</div>
                        <div style="font-size:24px;font-weight:800;color:${gc};line-height:1;">${m.grade}</div>
                    </div>
                </div>
                ${inactiveBadge}
                ${podiumRow}
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #2d3139;">Category Grades</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
                    ${gradeCell("Draft", m.draftGrade)}
                    ${gradeCell("Trades", m.tradeGrade)}
                    ${gradeCell("Waivers", m.waiverGrade)}
                </div>
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #2d3139;">Season Stats</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    ${metricCell("Roster Value", m.rosterValue > 0 ? Math.round(m.rosterValue).toLocaleString() + " pts" : "—", "#a78bfa")}
                    ${metricCell("Playoff Rate", playoffPct, playoffColor)}
                    ${metricCell("Win Rate", winPct)}
                    ${metricCell("Avg Seed", avgSeedStr)}
                    ${metricCell("PF/Game", pfPerGame)}
                    ${metricCell("Luck Index", pyLuckStr, pyLuckColor)}
                </div>
            </div>
        `;
    });

    html += `</div>
        <div style="margin-top:24px;background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:18px 20px;">
            <div style="font-size:13px;font-weight:700;color:#f0f1f3;margin-bottom:4px;">How the Overall Grade is computed</div>
            <div style="font-size:11px;color:#5a6070;margin-bottom:14px;">
                Managers are ranked by a weighted composite score. All metrics are normalized relative to peers (0–100), then blended:
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;">
                ${gradeWeightRow("Championships", 45, "Titles won relative to peers")}
                ${gradeWeightRow("Avg Seeding", 15, "Regular season finish (lower = better)")}
                ${gradeWeightRow("Win Rate", 15, "Overall W/L percentage")}
                ${gradeWeightRow("Playoff Rate", 10, "Playoff appearances (8/12 spots)")}
                ${gradeWeightRow("Trade Value", 6, "Net points gained via trades")}
                ${gradeWeightRow("Draft Surplus", 5, "Points above expected by draft slot")}
                ${gradeWeightRow("Waiver Hit Rate", 4, "Waiver adds above median scorer")}
            </div>
            <div style="font-size:11px;color:#5a6070;line-height:1.6;border-top:1px solid #2d3139;padding-top:12px;">
                Top manager = A+, bottom = F, rest distributed evenly across the scale. Inactive managers appear at the bottom.
                Category grades (Draft / Trades / Waivers) are relative sub-grades shown for context.
                Luck Index = actual wins − Pythagorean expected wins (PF²÷(PF²+PA²)).
            </div>
        </div>
    `;
    return html;
}

// ── Standings table logic ──────────────────────────────────────────────────

function renderTable(rows, txStats, year, playoffRecords, isAllTime) {
    if (!rows || !rows.length) return `<div class="s-empty">No data for this period.</div>`;

    const yearTx = txStats[year] || {};

    const enriched = rows.map((r, i) => {
        const tx = yearTx[r.name] || {};
        return {
            rank:     i + 1,
            name:     r.name,
            wins:     r.wins,
            losses:   r.losses,
            ties:     r.ties || 0,
            pf:       r.pf,
            pa:       r.pa,
            avgPF:    r.avgPF,
            highestPF: r.highestPF,
            seasons:  r.seasons,
            total:    r.total   ?? tx.total   ?? 0,
            trades:   r.trades  ?? tx.trades  ?? 0,
            waivers:  r.waivers ?? tx.waivers ?? 0,
            fa:       r.fa      ?? tx.fa      ?? 0,
            playoff:  playoffRecords[r.name] || null,
        };
    });

    const faabByTeam = (!isAllTime) ? computeFaabRemaining(year) : {};

    const allTimeExtraCols = isAllTime ? `
        <th>Avg PF</th>
        <th>Best PF</th>
        <th>Playoff W-L</th>
        <th>Seasons</th>
    ` : `<th>Playoff W-L</th><th>FAAB Left</th>`;

    let html = `
        <div class="s-table-wrap">
        <table class="s-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th class="left">Team</th>
                    <th>RS W</th>
                    <th>RS L</th>
                    <th>Win%</th>
                    <th>PF</th>
                    <th>PA</th>
                    <th>+/-</th>
                    ${allTimeExtraCols}
                    <th>Transactions</th>
                    <th>Trades</th>
                    <th>Waivers</th>
                    <th>FA</th>
                </tr>
            </thead>
            <tbody>
    `;

    enriched.forEach(r => {
        const diff = (r.pf - r.pa).toFixed(1);
        const diffColor = r.pf > r.pa ? "#3ecf8e" : "#f87171";
        const playoffStr = r.playoff ? `${r.playoff.wins}-${r.playoff.losses}` : "—";
        const faabLeft = faabByTeam[r.name];
        const faabStyle = faabLeft != null && faabLeft < 20 ? "color:#f87171;font-weight:700;" : "";

        const extraCols = isAllTime ? `
            <td class="num">${r.avgPF != null ? r.avgPF.toFixed(1) : "—"}</td>
            <td class="num">${r.highestPF != null ? r.highestPF.toFixed(1) : "—"}</td>
            <td class="num">${playoffStr}</td>
            <td class="num">${r.seasons ?? "—"}</td>
        ` : `<td class="num">${playoffStr}</td><td class="num" style="${faabStyle}">${faabLeft != null ? `$${faabLeft}` : "—"}</td>`;

        html += `
            <tr>
                <td class="rank">${r.rank}</td>
                <td class="team-name">
                    <div style="display:flex;align-items:center;gap:8px;">
                        ${avatarEl(r.name, 26)}
                        <span>${r.name}</span>
                    </div>
                </td>
                <td class="num wins">${r.wins}</td>
                <td class="num losses">${r.losses}</td>
                <td class="num">${(r.wins + r.losses) > 0 ? ((r.wins / (r.wins + r.losses)) * 100).toFixed(1) + "%" : "—"}</td>
                <td class="num">${r.pf.toFixed(1)}</td>
                <td class="num">${r.pa.toFixed(1)}</td>
                <td class="num" style="color:${diffColor};font-weight:700;">${diff > 0 ? "+" : ""}${diff}</td>
                ${extraCols}
                <td class="num">${r.total}</td>
                <td class="num">${r.trades}</td>
                <td class="num">${r.waivers}</td>
                <td class="num">${r.fa}</td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;
    return html;
}

function renderDivisions(allRows, txStats, year, playoffRecords) {
    const divMap = divisionsData[year] || {};
    const hasDivs = Object.keys(divMap).length > 0;

    if (!hasDivs) {
        return renderTable(allRows, txStats, year, playoffRecords, false);
    }

    const div1 = allRows.filter(r => divMap[r.name] === 1).sort((a, b) => b.wins - a.wins || b.pf - a.pf);
    const div2 = allRows.filter(r => divMap[r.name] === 2).sort((a, b) => b.wins - a.wins || b.pf - a.pf);
    const unassigned = allRows.filter(r => divMap[r.name] == null);

    const DIV_LABEL = `
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
            color:#5a6070;padding:10px 12px 6px;margin-top:12px;border-bottom:1px solid #2d3139;">
    `;

    let html = "";
    if (div1.length) html += `${DIV_LABEL}Division 1</div>` + renderTable(div1, txStats, year, playoffRecords, false);
    if (div2.length) html += `${DIV_LABEL}Division 2</div>` + renderTable(div2, txStats, year, playoffRecords, false);
    if (unassigned.length) html += `${DIV_LABEL}Other</div>` + renderTable(unassigned, txStats, year, playoffRecords, false);
    return html;
}

function render() {
    const board = document.getElementById("s-board");
    const label = document.getElementById("s-label");
    const yearSelect = document.getElementById("s-select");

    const yearSelectBar = document.getElementById("year-select-bar");
    if (currentPage === "report_card") {
        if (yearSelect) yearSelect.style.display = "none";
        if (yearSelectBar) yearSelectBar.style.display = "none";
        label.textContent = "Manager Report Card";
        board.innerHTML = renderReportCard();
        return;
    }

    if (yearSelect) yearSelect.style.display = "";
    if (yearSelectBar) yearSelectBar.style.display = "";
    const txStats = buildTxStats(transactions);

    if (currentView === "all_time") {
        label.textContent = "All Years Standings";
        const rows = buildAllTime(standings, txStats);
        const playoffRecords = buildAllTimePlayoffRecords(seasonHistory);
        board.innerHTML = renderTable(rows, {}, "all_time", playoffRecords, true);
    } else {
        label.textContent = `${currentView} Season`;
        const rows = standings[currentView] || [];
        const playoffRecords = buildPlayoffRecords(seasonHistory, currentView);
        board.innerHTML = renderDivisions(rows, txStats, currentView, playoffRecords);
    }
}

function updateUrl() {
    const params = new URLSearchParams();
    if (currentView !== "all_time") params.set("year", currentView);
    const search = params.toString() ? "?" + params.toString() : "";
    const hash   = currentPage !== "standings" ? "#" + currentPage : "";
    history.replaceState(null, "", location.pathname + search + hash);
}

function switchPage(page) {
    currentPage = page;
    document.querySelectorAll(".page-tab").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`tab-${page}`);
    if (activeBtn) activeBtn.classList.add("active");
    updateUrl();
    render();
}


async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();

    const container = document.getElementById("standings-container");

    container.innerHTML = `
    <style>
        #standings-container { max-width: 1050px; margin: 0; }

        .s-label {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 16px;
            color: #f0f1f3;
        }

        .s-table-wrap { overflow-x: auto; }

        .s-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            background: #1e2027;
            border-radius: 12px;
            overflow: hidden;
        }
        .s-table thead th {
            text-align: center;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #5a6070;
            padding: 10px 10px;
            border-bottom: 1px solid #2d3139;
            white-space: nowrap;
            background: #252830;
            font-weight: 700;
        }
        .s-table thead th.left { text-align: left; }

        .s-table tbody tr {
            border-bottom: 1px solid #2d3139;
            transition: background 0.1s;
        }
        .s-table tbody tr:last-child { border-bottom: none; }
        .s-table tbody tr:hover { background: #252830; }

        .s-table td {
            padding: 10px 10px;
            text-align: center;
            vertical-align: middle;
        }

        td.rank {
            font-size: 12px;
            color: #5a6070;
            font-weight: 700;
            width: 32px;
        }
        td.team-name {
            text-align: left;
            font-weight: 700;
            font-size: 14px;
            color: #f0f1f3;
            white-space: nowrap;
        }
        td.wins   { color: #3ecf8e; font-weight: 700; }
        td.losses { color: #f87171; font-weight: 700; }
        td.num    { color: #c9cdd4; }

        .s-empty {
            color: #5a6070;
            padding: 40px 0;
            text-align: center;
        }

        .page-tab {
            background: none;
            border: none;
            padding: 7px 14px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            color: #8b9099;
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
            font-family: inherit;
        }
        .page-tab:hover { color: #f0f1f3; background: #1e2027; }
        .page-tab.active { color: #f0f1f3; background: #1e2027; }
    </style>

    <div class="s-controls" id="s-controls"></div>
    <div class="s-label" id="s-label"></div>
    <div id="s-board">Loading...</div>
    `;

    try {
        const ALL_YEARS = YEARS.slice().sort();
        const [
            standingsData, txData, historyData, usersData, divsData,
            nameMap, statsByYear, draftByYear,
        ] = await Promise.all([
            api.getStandings(),
            api.getTransactions(),
            api.getSeasonHistory(),
            api.getLeagueUsers(),
            api.getDivisions(),
            api.getPlayerNameMap(),
            Promise.all(ALL_YEARS.map(y => api.getPlayerStats(y).catch(() => ({})))),
            Promise.all(ALL_YEARS.map(y => api.getDraft(y).catch(() => []))),
        ]);

        standings     = standingsData;
        transactions  = txData;
        seasonHistory = historyData;
        leagueUsers   = usersData;
        divisionsData = divsData;
        playerNameMap = nameMap;
        ALL_YEARS.forEach((y, i) => {
            allPlayerStats[y] = statsByYear[i];
            allDraftData[y]   = draftByYear[i];
        });

        const controls = document.getElementById("s-controls");

        // Restore year from URL
        const params = new URLSearchParams(location.search);
        const yearParam = params.get("year");
        if (yearParam && (YEARS.includes(yearParam) || yearParam === "all_time")) {
            currentView = yearParam;
        }

        controls.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;">
                <button class="page-tab${currentPage === 'standings' ? ' active' : ''}" id="tab-standings">Standings</button>
                <button class="page-tab${currentPage === 'report_card' ? ' active' : ''}" id="tab-report_card">Manager Report Card</button>
            </div>
            <div id="year-select-bar" class="filter-bar" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
                <select id="s-select">
                    <option value="all_time">All Years</option>
                    ${YEARS.map(y => `<option value="${y}">${y}</option>`).join("")}
                </select>
            </div>
        `;
        document.getElementById("tab-standings").addEventListener("click", () => switchPage("standings"));
        document.getElementById("tab-report_card").addEventListener("click", () => switchPage("report_card"));
        document.getElementById("s-select").value = currentView;
        document.getElementById("s-select").addEventListener("change", (e) => {
            currentView = e.target.value;
            updateUrl();
            render();
        });

        render();

    } catch (err) {
        console.error(err);
        document.getElementById("s-board").innerHTML = "Failed to load standings.";
    }
}

init();
