import { api } from "./dataService.js?v=202609152103";
import { renderNav } from "./components/nav.js?v=202609152103";

renderNav();

const ROUNDS = [1, 2, 3];
const FUTURE_YEARS = [];

async function init() {
    const container = document.getElementById("content");
    if (!container) return;

    try {
        const [rosters, tradedPicks, leagueUsers, playerValues] = await Promise.all([
            api.getRosters("2026"),
            api.getTradedPicks(),
            api.getLeagueUsers(),
            api.getPlayerValues(),
        ]);

        const PAUL_YOON_AVATAR = "https://sleepercdn.com/images/v4/avatars/avatar_default_blue.webp";
        const usersMap = {};
        (leagueUsers || []).forEach(u => {
            usersMap[u.username] = u.username === "Paul_Yoon" ? PAUL_YOON_AVATAR : u.avatar_url;
        });
        const AVATAR_COLORS = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6"];
        function makeAvatarEl(name) {
            const url = usersMap[name];
            const color = AVATAR_COLORS[name.split("").reduce((s,c)=>s+c.charCodeAt(0),0) % AVATAR_COLORS.length];
            const span = document.createElement("span");
            span.style.cssText = `width:32px;height:32px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;`;
            span.textContent = name[0].toUpperCase();
            if (!url) return span;
            const img = document.createElement("img");
            img.src = url;
            img.style.cssText = "width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;";
            img.addEventListener("error", () => img.replaceWith(span));
            return img;
        }

        const teams = (rosters || [])
            .sort((a, b) => a.roster_id - b.roster_id)
            .map(r => r.owner || `Roster ${r.roster_id}`);

        // Start: every team owns all their own picks
        const ownership = {};
        FUTURE_YEARS.forEach(year => {
            ownership[year] = {};
            ROUNDS.forEach(round => {
                ownership[year][round] = {};
                teams.forEach(name => {
                    ownership[year][round][name] = name;
                });
            });
        });

        // Apply trades
        (tradedPicks || []).forEach(p => {
            const year = p.season, round = p.round, original = p.original_owner_name, current = p.owner_name;
            if (ownership[year]?.[round]?.[original] !== undefined) {
                ownership[year][round][original] = current;
            }
        });

        // Build per-team: { year: [ {round, original, own} ] }
        const picksByTeam = {};
        teams.forEach(name => { picksByTeam[name] = {}; FUTURE_YEARS.forEach(y => { picksByTeam[name][y] = []; }); });

        FUTURE_YEARS.forEach(year => {
            ROUNDS.forEach(round => {
                Object.entries(ownership[year][round]).forEach(([original, current]) => {
                    if (!picksByTeam[current]) { picksByTeam[current] = {}; FUTURE_YEARS.forEach(y => { picksByTeam[current][y] = []; }); }
                    picksByTeam[current][year].push({ round, original, own: original === current });
                });
            });
        });

        const rosterByName = {};
        (rosters || []).forEach(r => { rosterByName[r.owner || `Roster ${r.roster_id}`] = r; });

        container.innerHTML = `<style>#content{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start;}</style>`;

        teams.forEach(name => {
            const roster = rosterByName[name];
            const totalPicks = FUTURE_YEARS.reduce((sum, y) => sum + picksByTeam[name][y].length, 0);

            const card = document.createElement("div");
            card.style.cssText = "background:var(--card-bg);border:1px solid #2d3139;border-radius:12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.3);";

            // Header: avatar + name + subtitle
            const header = document.createElement("div");
            header.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #2d3139;";
            header.appendChild(makeAvatarEl(name));
            const info = document.createElement("div");
            info.style.cssText = "min-width:0;";
            const link = document.createElement("a");
            link.href = `team.html?team=${encodeURIComponent(name)}`;
            link.textContent = name;
            link.style.cssText = "font-size:14px;font-weight:700;color:#f0f1f3;text-decoration:none;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
            link.addEventListener("mouseover", () => link.style.color = "#818cf8");
            link.addEventListener("mouseout", () => link.style.color = "#f0f1f3");
            const sub = document.createElement("div");
            sub.style.cssText = "font-size:11px;color:#5a6070;margin-top:2px;";
            sub.textContent = `${roster?.players?.length || 0} players · ${totalPicks} picks`;
            info.appendChild(link);
            info.appendChild(sub);
            header.appendChild(info);
            card.appendChild(header);

            // Draft picks label
            const label = document.createElement("div");
            label.style.cssText = "font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;font-weight:700;margin-bottom:8px;";
            label.textContent = "Draft Picks";
            card.appendChild(label);

            // Year columns
            const yearRow = document.createElement("div");
            yearRow.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;";
            FUTURE_YEARS.forEach(year => {
                const col = document.createElement("div");
                col.style.cssText = "flex:1;min-width:70px;";
                const yearLabel = document.createElement("div");
                yearLabel.style.cssText = "font-size:10px;font-weight:700;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;";
                yearLabel.textContent = year;
                col.appendChild(yearLabel);
                const pills = document.createElement("div");
                pills.style.cssText = "display:flex;flex-direction:column;gap:4px;";
                const picks = picksByTeam[name][year].sort((a, b) => a.round - b.round);
                if (picks.length) {
                    picks.forEach(p => {
                        const pill = document.createElement("span");
                        pill.style.cssText = `background:${p.own ? "#252830" : "#1e1b33"};color:${p.own ? "#c9cdd4" : "#a78bfa"};border:1px solid ${p.own ? "#2d3139" : "#4c3d8a"};border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;white-space:nowrap;display:block;`;
                        pill.textContent = p.own ? `R${p.round}` : `R${p.round} - ${p.original}`;
                        pill.title = p.own ? "Own pick" : p.original + "'s pick";
                        pills.appendChild(pill);
                    });
                } else {
                    const empty = document.createElement("span");
                    empty.style.cssText = "color:#3d4350;font-size:11px;";
                    empty.textContent = "—";
                    pills.appendChild(empty);
                }
                col.appendChild(pills);
                yearRow.appendChild(col);
            });
            card.appendChild(yearRow);
            container.appendChild(card);
        });

    } catch (e) {
        console.error(e);
        container.innerHTML = "Failed to load assets.";
    }
}

init();
