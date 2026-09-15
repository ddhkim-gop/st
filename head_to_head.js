import { api } from "./dataService.js?v=202609150609";
import { renderNav } from "./components/nav.js?v=202609150609";

const YEARS_DESC = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort().reverse();
let data = null;
let currentView = "all_time";
let usersMap = {}; // username → avatar_url

const AVATAR_COLORS_H2H = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"];
function accentColorH2H(name) {
    return AVATAR_COLORS_H2H[(name||"?").split("").reduce((s,c)=>s+c.charCodeAt(0),0) % AVATAR_COLORS_H2H.length];
}
const INACTIVE = new Set(['edgxrjiang', 'riqi', 'shmyung', 'urmummma']);

function getTeams(dataset) {
    const set = new Set();
    Object.keys(dataset).forEach(a => {
        set.add(a);
        Object.keys(dataset[a]).forEach(b => set.add(b));
    });
    return [...set].sort((a, b) => {
        const aInactive = INACTIVE.has(a) ? 1 : 0;
        const bInactive = INACTIVE.has(b) ? 1 : 0;
        if (aInactive !== bInactive) return aInactive - bInactive;
        return a.localeCompare(b);
    });
}

function recordCell(d, colInactive) {
    const dimStyle = colInactive ? "opacity:0.35;" : "";
    if (!d) return `<td class="cell-pad" style="${dimStyle}"><div class="cell-empty">—</div></td>`;
    const { wins, losses, ties } = d;
    const total = wins + losses + ties;
    const pct = total > 0 ? wins / total : 0;
    const hue = Math.round(pct * 120);
    const bg = `hsla(${hue}, 58%, 22%, 1)`;
    const color = `hsl(${hue}, 80%, 72%)`;
    const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    return `<td class="cell-pad" style="${dimStyle}" title="${d.pf?.toFixed(0)} PF / ${d.pa?.toFixed(0)} PA">
        <div class="cell-record" style="background:${bg};color:${color}">${record}</div>
    </td>`;
}

function renderMatrix(dataset) {
    const teams = getTeams(dataset);
    if (!teams.length) return `<div class="h2h-empty">No data for this period.</div>`;

    let html = `<div class="matrix-wrap"><table class="matrix">`;

    // Header row
    html += `<thead><tr><th class="corner"></th>`;
    teams.forEach(t => html += `<th class="col-head${INACTIVE.has(t) ? " col-inactive" : ""}"><div>${t}</div></th>`);
    html += `</tr></thead><tbody>`;

    // Data rows
    teams.forEach(a => {
        let w = 0, l = 0, ti = 0, pf = 0, pa = 0;
        teams.forEach(b => {
            if (a === b) return;
            const d = dataset[a]?.[b];
            if (d) { w += d.wins; l += d.losses; ti += d.ties; pf += d.pf || 0; pa += d.pa || 0; }
        });
        const overall = ti > 0 ? `${w}-${l}-${ti}` : `${w}-${l}`;

        html += `<tr class="${INACTIVE.has(a) ? 'inactive-row' : ''}">`;
        const avatarUrl = usersMap[a];
        const _h2hColor = accentColorH2H(a);
        const avatarHtml = INACTIVE.has(a)
            ? `<span style="width:22px;height:22px;border-radius:50%;background:#3a3f4a;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#5a6070;flex-shrink:0;">${a[0].toUpperCase()}</span>`
            : avatarUrl
            ? `<img src="${avatarUrl}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.outerHTML='<span style=\'width:22px;height:22px;border-radius:50%;background:${_h2hColor};display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0;\'>${a[0].toUpperCase()}</span>'">`
            : `<span style="width:22px;height:22px;border-radius:50%;background:${_h2hColor};display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0;">${a[0].toUpperCase()}</span>`;
        html += `<td class="row-head">
            <div style="display:flex;align-items:center;justify-content:flex-start;gap:7px;">
                ${avatarHtml}
                <div>
                    <div class="row-name">${a}</div>
                    <div class="row-record">${overall} · ${pf.toFixed(0)} PF · ${pa.toFixed(0)} PA</div>
                </div>
            </div>
        </td>`;

        teams.forEach(b => {
            if (a === b) {
                html += `<td class="cell-self${INACTIVE.has(b) ? ' col-inactive-cell' : ''}">●</td>`;
            } else {
                html += recordCell(dataset[a]?.[b], INACTIVE.has(b));
            }
        });

        html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    return html;
}

function render() {
    const board = document.getElementById("h2h-board");


    let dataset;
    if (currentView === "all_time") {
        dataset = data.all_time || {};
    } else {
        dataset = data.seasons?.[currentView] || {};
    }

    board.innerHTML = renderMatrix(dataset);
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();

    const container = document.getElementById("h2h-container");

    container.innerHTML = `
    <style>
        #h2h-container { max-width: 100%; overflow-x: auto; }
        #h2h-controls .filter-bar { margin-bottom: 0; }

.matrix-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }

        .matrix {
            border-collapse: separate;
            border-spacing: 0;
            font-size: 13px;
            white-space: nowrap;
        }
        .matrix th, .matrix td {
            padding: 0;
            text-align: center;
        }
        .matrix td.row-head {
            text-align: left !important;
        }

        .corner {
            width: 300px;
            position: sticky;
            left: 0;
            z-index: 2;
            background: #161820;
        }

        .col-head {
            height: 120px;
            vertical-align: bottom;
            padding-bottom: 6px;
        }
        .col-head div {
            writing-mode: vertical-rl;
            transform: rotate(180deg);
            font-size: 13px;
            font-weight: 700;
            color: #f0f1f3;
            padding: 4px 8px;
        }
        .col-head.col-inactive div { opacity: 0.35; }

        .row-head {
            text-align: left;
            padding: 4px 20px 4px 0;
            min-width: 285px;
            position: sticky;
            left: 0;
            z-index: 1;
            background: #161820;
        }
        .row-name {
            font-size: 15px;
            font-weight: 700;
            color: #f0f1f3;
            line-height: 1.2;
        }
        .row-record {
            font-size: 11px;
            color: #8b9099;
            margin-top: 1px;
        }

        .cell-pad { padding: 5px 4px; }

        .cell-record {
            width: 51px;
            height: 30px;
            font-size: 11px;
            font-weight: 700;
            border-radius: 5px;
            cursor: default;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .cell-self {
            color: #2d3139;
            font-size: 18px;
            padding: 5px 4px;
        }
        .cell-empty {
            color: #2d3139;
            width: 51px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
        }
        .col-inactive-cell { opacity: 0.35; }

        .matrix tbody tr:hover .row-name { color: #818cf8; }
        .inactive-row { opacity: 0.35; }
        .inactive-row td, .col-head.inactive { font-style: italic; }

        .h2h-empty {
            color: #5a6070;
            padding: 40px 0;
            text-align: center;
        }
    </style>

    <div class="h2h-controls" id="h2h-controls"></div>
    <div id="h2h-board">Loading...</div>
    `;

    try {
        const [h2hData, leagueUsers] = await Promise.all([
            api.getHeadToHead(),
            api.getLeagueUsers(),
        ]);
        data = h2hData;
        const PAUL_YOON_AVATAR = "https://sleepercdn.com/images/v4/avatars/avatar_default_blue.webp";
        (leagueUsers || []).forEach(u => { usersMap[u.username] = u.username === "Paul_Yoon" ? PAUL_YOON_AVATAR : u.avatar_url; });

        const controls = document.getElementById("h2h-controls");
        controls.innerHTML = `
            <div class="filter-bar">
                <select id="h2h-select">
                    <option value="all_time">All Years</option>
                    ${YEARS_DESC.map(y => `<option value="${y}">${y}</option>`).join("")}
                </select>
            </div>
        `;
        document.getElementById("h2h-select").addEventListener("change", (e) => {
            currentView = e.target.value;
            render();
        });
        render();

    } catch (err) {
        console.error(err);
        document.getElementById("h2h-board").innerHTML = "Failed to load H2H data.";
    }
}

init();
