import { api } from "./dataService.js?v=202609150609";
import { renderNav } from "./components/nav.js?v=202609150609";

function el(id) {
    return document.getElementById(id);
}

function applyStyles() {
    const style = document.createElement("style");
    style.innerHTML = `
        body {
            background: #f3f4f6 !important;
            color: #111827 !important;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .card {
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 12px;
            margin: 10px 0;
        }

        .draft-board {
            display: flex;
            gap: 16px;
            overflow-x: auto;
        }

        .draft-round {
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 12px;
            min-width: 280px;
        }

        .pick-card {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            padding: 10px;
            margin-bottom: 10px;
        }

        .player {
            font-weight: 700;
        }

        .meta {
            font-size: 13px;
            color: #374151;
        }

        .owner {
            font-size: 12px;
            color: #6b7280;
            margin-top: 6px;
        }

        .team-pill {
            display: inline-block;
            background: #e5e7eb;
            padding: 2px 6px;
            border-radius: 6px;
            margin-right: 4px;
            font-size: 12px;
        }
    `;
    document.head.appendChild(style);
}

async function buildRosterMap() {
    const rosters = await api.getRosters("2026");

    const map = {};

    Object.values(rosters).forEach(r => {
        // THIS is what Transactions effectively relies on
        map[r.roster_id] = r.owner || r.owner_id || r.name;
    });

    return map;
}

function groupByRound(picks) {
    const grouped = {};

    picks.forEach(p => {
        const r = p.round || 0;
        if (!grouped[r]) grouped[r] = [];
        grouped[r].push(p);
    });

    return grouped;
}

async function load(year) {
    const container = el("draft-container");
    container.innerHTML = "Loading...";

    const [picks, rosterMap] = await Promise.all([
        api.getDraft(year),
        buildRosterMap()
    ]);

    let html = `<div class="draft-board">`;

    Object.keys(groupByRound(picks))
        .sort((a, b) => Number(a) - Number(b))
        .forEach(round => {

            html += `<div class="draft-round"><h3>Round ${round}</h3>`;

            groupByRound(picks)[round]
                .sort((a, b) => (a.pick_no || 0) - (b.pick_no || 0))
                .forEach(p => {

                    const owner =
                        rosterMap[p.owner_id] ||
                        rosterMap[String(p.owner_id)] ||
                        "Unknown";

                    html += `
                        <div class="pick-card">
                            <div>#${p.pick_no}</div>

                            <div class="player">${p.player}</div>

                            <div class="meta">
                                ${p.position || ""}${p.team ? " • " + p.team : ""}
                            </div>

                            <div class="owner">
                                Picked by: ${owner}
                            </div>

                            <div class="owner">
                                Original owner: ${owner}
                            </div>
                        </div>
                    `;
                });

            html += `</div>`;
        });

    html += `</div>`;
    container.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", () => {
    renderNav();
    applyStyles();

    const select = document.getElementById("yearSelect");
    load(select.value);

    select.addEventListener("change", () => load(select.value));
});