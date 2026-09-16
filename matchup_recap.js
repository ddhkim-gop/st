import { api } from "./dataService.js?v=202609152103";
import { renderNav } from "./components/nav.js?v=202609152103";

renderNav();

const YEARS = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort();
const PLAYOFF_START = 15;
const PLAYOFF_WEEK_NAMES = {
    [PLAYOFF_START]:   "Playoffs · Round 1",
    [PLAYOFF_START+1]: "Playoffs · Semifinals",
    [PLAYOFF_START+2]: "Playoffs · Championship",
};

let matchupsCache = {};
let selectedYear = YEARS[YEARS.length - 1];   // default to the current season

function weekLabel(w) {
    const n = parseInt(w);
    return PLAYOFF_WEEK_NAMES[n] || `Week ${n}`;
}

// ── Narrative generation ──────────────────────────────────────────────────────

function topPlayer(starters) {
    return starters.reduce((best, s) => s.points > best.points ? s : best, starters[0]);
}

function zeroers(starters) {
    return starters.filter(s => s.points === 0 && s.position !== "K");
}

function marginTag(margin) {
    if (margin < 5)  return "nail-biter";
    if (margin < 15) return "close";
    if (margin < 30) return "comfortable";
    if (margin < 50) return "decisive";
    return "dominant";
}

const CLOSE_OPENERS = [
    "It came down to the wire.",
    "This one wasn't decided until the final whistle.",
    "A close call that could have gone either way.",
    "Barely enough to survive.",
];
const BLOWOUT_OPENERS = [
    "No drama here.",
    "A statement win from start to finish.",
    "This one was over early.",
    "Dominant performance top to bottom.",
];
const MID_OPENERS = [
    "A solid win with room to spare.",
    "Enough firepower to get the job done.",
    "A workmanlike victory.",
    "Consistent production secured the W.",
];

function pick(arr, seed) {
    return arr[Math.abs(seed) % arr.length];
}

function strHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
}

function generateRecap(matchup, weekStr) {
    const [a, b] = matchup.teams;
    if (!a || !b) return "No data available.";

    const winner = a.points > b.points ? a : b;
    const loser  = a.points > b.points ? b : a;
    const margin = Math.abs(a.points - b.points).toFixed(2);
    const tag    = marginTag(parseFloat(margin));
    const seed   = strHash(`${winner.owner}${loser.owner}${weekStr}`);

    const winTop  = topPlayer(winner.starters);
    const loseTop = topPlayer(loser.starters);
    const isPlayoff = parseInt(weekStr) >= PLAYOFF_START;

    let opener;
    if (tag === "nail-biter" || tag === "close") opener = pick(CLOSE_OPENERS, seed);
    else if (tag === "dominant" || tag === "decisive") opener = pick(BLOWOUT_OPENERS, seed + 1);
    else opener = pick(MID_OPENERS, seed + 2);

    const playoffNote = isPlayoff ? " in the playoffs" : "";

    let body = `${winner.owner} defeated ${loser.owner}${playoffNote} by ${margin} points `
        + `(${winner.points.toFixed(2)}–${loser.points.toFixed(2)}). `;

    body += `${winTop.name} led ${winner.owner}'s lineup with ${winTop.points.toFixed(1)} points. `;

    if (loseTop.points >= winTop.points) {
        body += `${loser.owner} actually had the top scorer of the matchup — ${loseTop.name} with ${loseTop.points.toFixed(1)} — but couldn't get enough support elsewhere. `;
    } else {
        body += `${loseTop.name} was ${loser.owner}'s best option at ${loseTop.points.toFixed(1)} points. `;
    }

    const zeros = zeroers(loser.starters);
    if (zeros.length >= 2) {
        body += `${loser.owner} was hurt by ${zeros.length} zero-point performances including ${zeros[0].name} and ${zeros[1].name}. `;
    } else if (zeros.length === 1) {
        body += `A zero from ${zeros[0].name} didn't help ${loser.owner}'s cause. `;
    }

    const winZeros = zeroers(winner.starters);
    if (winZeros.length >= 1) {
        body += `${winner.owner} even overcame a scoreless outing from ${winZeros[0].name}. `;
    }

    if (tag === "nail-biter") {
        body += `A couple of extra points from either side could have changed the outcome.`;
    } else if (tag === "dominant") {
        body += `The result was never really in doubt.`;
    }

    return `${opener} ${body}`;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderMatchupCard(matchup, weekStr) {
    const [a, b] = matchup.teams || [];
    if (!a || !b) return "";
    const winner = a.points > b.points ? a : b;
    const loser  = a.points > b.points ? b : a;
    const margin = Math.abs(a.points - b.points).toFixed(2);
    const recap  = generateRecap(matchup, weekStr);

    return `
    <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:18px 20px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
            <span style="font-size:15px;font-weight:800;color:#f0f1f3;">${winner.owner}</span>
            <span style="font-size:13px;font-weight:700;color:#3ecf8e;">${winner.points.toFixed(2)}</span>
            <span style="font-size:11px;color:#5a6070;margin:0 2px;">vs</span>
            <span style="font-size:13px;font-weight:700;color:#5a6070;">${loser.points.toFixed(2)}</span>
            <span style="font-size:15px;font-weight:700;color:#8b9099;">${loser.owner}</span>
            <span style="margin-left:auto;font-size:11px;color:#5a6070;background:#252830;border-radius:6px;padding:3px 8px;">
                ${margin} pts
            </span>
        </div>
        <p style="font-size:13px;line-height:1.65;color:#c9cdd4;margin:0;">${recap}</p>
    </div>`;
}

function renderWeekSection(weekStr, matchups) {
    return `
    <div style="margin-bottom:32px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
                    color:#5a6070;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #2d3139;">
            ${weekLabel(weekStr)}
        </div>
        ${matchups.map(m => renderMatchupCard(m, weekStr)).join("")}
    </div>`;
}

function renderAll(data, filterWeek) {
    const board = document.getElementById("recap-board");
    if (!board) return;
    const weeks = Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b));
    const filtered = filterWeek === "all" ? weeks : weeks.filter(w => w === filterWeek);
    if (!filtered.length) {
        board.innerHTML = `<div style="color:#5a6070;padding:40px 0;text-align:center;">No data.</div>`;
        return;
    }
    board.innerHTML = filtered.map(w => renderWeekSection(w, data[w])).join("");
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function loadYear(year) {
    if (matchupsCache[year]) return matchupsCache[year];
    const data = await api.getMatchups(year);
    matchupsCache[year] = data;
    return data;
}

function buildWeekOptions(data) {
    const weeks = Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b));
    return `<option value="all">All Weeks</option>`
        + weeks.map(w => `<option value="${w}">${weekLabel(w)}</option>`).join("");
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    const container = document.getElementById("recap-container");

    container.innerHTML = `
    <style>
        #recap-container { max-width: 860px; }
    </style>
    <div class="filter-bar" style="margin-bottom:24px;display:flex;gap:10px;flex-wrap:wrap;">
        <select id="rc-year">${YEARS.map(y => `<option value="${y}">${y}</option>`).join("")}</select>
        <select id="rc-week"><option value="all">All Weeks</option></select>
    </div>
    <div id="recap-board"><div style="color:#5a6070;padding:40px 0;text-align:center;">Loading…</div></div>
    `;

    const yearSel = document.getElementById("rc-year");
    const weekSel = document.getElementById("rc-week");

    async function onYearChange(year) {
        selectedYear = year;
        weekSel.innerHTML = `<option value="all">Loading…</option>`;
        weekSel.disabled = true;
        document.getElementById("recap-board").innerHTML =
            `<div style="color:#5a6070;padding:40px 0;text-align:center;">Loading ${year}…</div>`;
        try {
            const data = await loadYear(year);
            weekSel.innerHTML = buildWeekOptions(data);
            weekSel.disabled = false;
            renderAll(data, "all");
        } catch (err) {
            document.getElementById("recap-board").innerHTML =
                `<div style="color:#f87171;padding:20px 0;">Error loading matchups: ${err.message}</div>`;
        }
    }

    yearSel.addEventListener("change", e => onYearChange(e.target.value));
    weekSel.addEventListener("change", e => {
        const data = matchupsCache[selectedYear];
        if (data) renderAll(data, e.target.value);
    });

    onYearChange(selectedYear);
}

init();
