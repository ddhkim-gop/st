import { api } from "./dataService.js?v=202609152103";
import { renderNav } from "./components/nav.js?v=202609152103";

const YEARS_DESC = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort().reverse();
const YEARS = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort();
const FUTURE_YEARS = [];
const ROUNDS = [1, 2, 3];
const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

let allTransactions = [];
let playerValuesCache = {};
let playerValuesCacheNorm = {}; // normalized name → key for fuzzy lookup

function normName(n) {
    return n.toLowerCase()
        .replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '')
        .replace(/[^a-z\s]/g, '')
        .trim();
}

function pvLookup(name) {
    if (playerValuesCache[name]) return playerValuesCache[name];
    const norm = normName(name);
    const key = playerValuesCacheNorm[norm];
    return key ? playerValuesCache[key] : {};
}

// ESPN team logo URL
function teamLogoUrl(abbrev) {
    if (!abbrev) return null;
    return `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${abbrev.toLowerCase()}.png`;
}

function calcAgeDecimal(birthDate) {
    if (!birthDate) return null;
    const birth = new Date(birthDate);
    const now = new Date();
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    return ((now - birth) / msPerYear).toFixed(1);
}
let statsCache = {};
let usersMap = {};
const espnIdCache = {};



const POS_COLORS = {
    QB:  "#e74c82",
    RB:  "#3ecf8e",
    WR:  "#4299e1",
    TE:  "#f6ad55",
    K:   "#9f7aea",
    DEF: "#64748b",
};
function posColor(pos) { return POS_COLORS[(pos||"").toUpperCase()] || "#5a6070"; }

const STAT_YEARS_DESC = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort().reverse();
function playerValueScore(p) {
    // Sort by most recent season's points desc, walking back through earlier years
    const pid = p.player_id;
    for (const yr of STAT_YEARS_DESC) {
        const v = statsCache[yr]?.[pid]?.pts_half_ppr;
        if (v > 0) return v;
    }
    return 0;
}

function posRankStr(p) {
    const pid = p.player_id;
    for (const yr of STAT_YEARS_DESC) {
        const s = statsCache[yr]?.[pid];
        if (s?.rank > 0) return `${s.position || p.position}${s.rank}`;
    }
    return null;
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();
    ensurePopover();

    const container = document.getElementById("teams-container");
    container.innerHTML = `<div style="color:#8b9099;padding:20px;">Loading...</div>`;

    const [rosters, tradedPicks, leagueUsers, txData, playerValues] = await Promise.all([
        api.getRosters("2026"),
        api.getTradedPicks(),
        api.getLeagueUsers(),
        api.getTransactions(),
        api.getPlayerValues(),
    ]);
    allTransactions = txData || [];
    playerValuesCache = playerValues || {};
    playerValuesCacheNorm = {};
    for (const key of Object.keys(playerValuesCache)) {
        playerValuesCacheNorm[normName(key)] = key;
    }
    await loadPlayerStats();

    const PAUL_YOON_AVATAR = "https://sleepercdn.com/images/v4/avatars/avatar_default_blue.webp";
        (leagueUsers || []).forEach(u => { usersMap[u.username] = u.username === "Paul_Yoon" ? PAUL_YOON_AVATAR : u.avatar_url; });

    // Team dropdown
    const INACTIVE_USERS_SET = new Set(['edgxrjiang', 'riqi', 'shmyung', 'urmummma', 'JUNNNNAY']);
    const activeRosters = (rosters || []).filter(r => r.owner && !INACTIVE_USERS_SET.has(r.owner))
        .sort((a,b) => a.owner.localeCompare(b.owner));
    const dropdownWrap = document.getElementById("teams-dropdown-wrap");
    if (dropdownWrap) {
        const sel = document.createElement("select");
        sel.innerHTML = `<option value="">View a team…</option>` +
            activeRosters.map(r => `<option value="${r.owner}">${r.owner}</option>`).join("");
        sel.addEventListener("change", e => {
            if (e.target.value) window.location.href = `team.html?team=${encodeURIComponent(e.target.value)}`;
        });
        dropdownWrap.appendChild(sel);
    }

    // Compute picks ownership per team
    const ownership = {};
    FUTURE_YEARS.forEach(year => {
        ownership[year] = {};
        ROUNDS.forEach(round => {
            ownership[year][round] = {};
            (rosters || []).forEach(r => {
                const name = r.owner || `Roster ${r.roster_id}`;
                ownership[year][round][name] = name;
            });
        });
    });
    (tradedPicks || []).forEach(p => {
        const year = p.season, round = p.round, original = p.original_owner_name, current = p.owner_name;
        if (ownership[year]?.[round]?.[original] !== undefined) {
            ownership[year][round][original] = current;
        }
    });
    const pickCountByTeam = {};
    FUTURE_YEARS.forEach(year => {
        ROUNDS.forEach(round => {
            Object.entries(ownership[year][round]).forEach(([, current]) => {
                pickCountByTeam[current] = (pickCountByTeam[current] || 0) + 1;
            });
        });
    });

    container.innerHTML = "";

    (rosters || []).forEach(team => {
        const ownerName = team.owner || `Roster ${team.roster_id}`;
        const card = document.createElement("div");
        card.className = "card";
        card.style.cssText = "background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:16px;";

        // Team header with avatar
        const avatarUrl = usersMap[ownerName];

        const activePlayers = (team.players || []).filter(p => p && p.name);
        const playerCount = activePlayers.length;
        const pickCount = pickCountByTeam[ownerName] || 0;

        const ages = activePlayers.map(p => {
            if (p.birth_date) {
                const birth = new Date(p.birth_date);
                return (Date.now() - birth) / (365.25 * 24 * 60 * 60 * 1000);
            }
            return p.age ? Number(p.age) : null;
        }).filter(a => a !== null);
        const avgAge = ages.length ? (ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1) : null;

        const header = document.createElement("div");
        header.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #2d3139;";

        // Pick a consistent accent color from the username (same palette Sleeper uses)
        const AVATAR_COLORS_T = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"];
        const accentColor = AVATAR_COLORS_T[ownerName.split("").reduce((s,c)=>s+c.charCodeAt(0),0) % AVATAR_COLORS_T.length];
        const INACTIVE_USERS_T = new Set(['edgxrjiang', 'riqi', 'shmyung', 'urmummma', 'JUNNNNAY']);

        // Build avatar element
        let avatarEl;
        if (INACTIVE_USERS_T.has(ownerName)) {
            avatarEl = document.createElement("span");
            avatarEl.style.cssText = "width:32px;height:32px;border-radius:50%;background:#3a3f4a;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#5a6070;flex-shrink:0;";
            avatarEl.textContent = ownerName[0].toUpperCase();
        } else if (avatarUrl) {
            avatarEl = document.createElement("img");
            avatarEl.src = avatarUrl;
            avatarEl.style.cssText = "width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;";
            avatarEl.addEventListener("error", () => {
                const fb = document.createElement("span");
                fb.style.cssText = `width:32px;height:32px;border-radius:50%;background:${accentColor};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;`;
                fb.textContent = ownerName[0].toUpperCase();
                avatarEl.replaceWith(fb);
            });
        } else {
            avatarEl = document.createElement("span");
            avatarEl.style.cssText = `width:32px;height:32px;border-radius:50%;background:${accentColor};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;`;
            avatarEl.textContent = ownerName[0].toUpperCase();
        }

        header.innerHTML = `
            <div style="flex:1;min-width:0;">
                <a href="team.html?team=${encodeURIComponent(ownerName)}" style="font-size:14px;font-weight:700;color:#f0f1f3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none;display:block;" onmouseover="this.style.color='#818cf8'" onmouseout="this.style.color='#f0f1f3'">${ownerName}</a>
                <div style="font-size:11px;color:#5a6070;margin-top:2px;">${playerCount} players · ${pickCount} picks</div>
                ${avgAge ? `<div style="font-size:11px;color:#5a6070;margin-top:1px;">avg age ${avgAge}</div>` : ""}
            </div>`;
        header.prepend(avatarEl);
        card.appendChild(header);

        // Group + sort players
        const grouped = {};
        (team.players || []).forEach(p => {
            if (!p || !p.name) return;
            const pos = p.position || "OTHER";
            if (!grouped[pos]) grouped[pos] = [];
            grouped[pos].push(p);
        });

        // Sort within each position by KTC dynasty value desc, fallback to search_rank
        Object.keys(grouped).forEach(pos => {
            grouped[pos].sort((a, b) => {
                const av = (pvLookup(a.name)?.ktc ?? 0);
                const bv = (pvLookup(b.name)?.ktc ?? 0);
                if (av !== bv) return bv - av;
                return (a.search_rank ?? 999999) - (b.search_rank ?? 999999);
            });
        });

        const sortedPos = POS_ORDER.filter(p => grouped[p])
            .concat(Object.keys(grouped).filter(p => !POS_ORDER.includes(p)));

        sortedPos.forEach(pos => {
            const divider = document.createElement("div");
            divider.className = "position-divider";
            divider.textContent = pos;
            card.appendChild(divider);

            grouped[pos].forEach(p => {
                const row = document.createElement("div");
                row.className = "player";
                row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 8px;margin-top:3px;background:#252830;border-radius:8px;cursor:pointer;border:1px solid transparent;transition:background 0.12s,border-color 0.12s;";

                const badge = document.createElement("span");
                badge.className = "player-pos-badge";
                badge.textContent = p.position || "?";
                badge.style.background = posColor(p.position);
                badge.style.color = "#fff";
                badge.style.cssText = `background:${posColor(p.position)};color:#fff;font-size:10px;font-weight:800;padding:2px 0;border-radius:4px;flex-shrink:0;letter-spacing:.02em;width:30px;text-align:center;`;

                const nameSpan = document.createElement("span");
                nameSpan.style.cssText = "font-size:13px;font-weight:600;color:#f0f1f3;flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:5px;";
                const nameText = document.createElement("span");
                nameText.textContent = p.name;
                nameText.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                nameSpan.appendChild(nameText);
                if (p.years_exp === 0) {
                    const rookie = document.createElement("span");
                    rookie.textContent = "R";
                    rookie.style.cssText = "font-size:9px;font-weight:800;color:#fff;background:#f59e0b;border-radius:3px;padding:1px 4px;flex-shrink:0;letter-spacing:.03em;";
                    nameSpan.appendChild(rookie);
                }

                const metaSpan = document.createElement("span");
                metaSpan.style.cssText = "font-size:11px;color:#5a6070;flex-shrink:0;white-space:nowrap;display:flex;align-items:center;gap:4px;";
                const ageDecimal = calcAgeDecimal(p.birth_date);
                const ageStr = ageDecimal ? ageDecimal : (p.age ? p.age : "");
                if (p.team) {
                    const logoUrl = teamLogoUrl(p.team);
                    const logoEl = document.createElement("img");
                    logoEl.src = logoUrl;
                    logoEl.style.cssText = "width:14px;height:14px;object-fit:contain;flex-shrink:0;";
                    logoEl.onerror = () => { logoEl.replaceWith(document.createTextNode(p.team)); };
                    metaSpan.appendChild(logoEl);
                }
                if (ageStr) metaSpan.appendChild(document.createTextNode(ageStr));

                row.appendChild(badge);
                row.appendChild(nameSpan);
                row.appendChild(metaSpan);

                row.addEventListener("click", (e) => { e.stopPropagation(); openPopover(e.currentTarget, p); });
                row.addEventListener("mouseenter", () => { row.style.background = "#2d3139"; row.style.borderColor = "#3d4350"; });
                row.addEventListener("mouseleave", () => { row.style.background = "#252830"; row.style.borderColor = "transparent"; });
                card.appendChild(row);
            });
        });

        container.appendChild(card);
    });
}

async function loadPlayerStats() {
    for (const year of YEARS) {
        try { statsCache[year] = await api.getPlayerStats(year); }
        catch { statsCache[year] = {}; }
    }
}

function ensurePopover() {
    if (document.getElementById("player-popover")) return;
    const pop = document.createElement("div");
    pop.id = "player-popover";
    // Outer: fixed container, no overflow (keeps close button from scrolling)
    // Inner: scrollable body
    pop.innerHTML = `
        <button id="popover-close" onclick="document.getElementById('player-popover').style.display='none'"
            style="position:absolute;top:10px;right:10px;z-index:10;
                   background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);
                   color:#8b9099;width:26px;height:26px;border-radius:50%;cursor:pointer;
                   font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
        <div id="popover-body" style="font-size:13px;line-height:1.5;overflow-y:auto;min-height:0;flex:1;border-radius:12px;"></div>`;
    pop.style.cssText = `
        position:fixed;z-index:9999;
        background:#13151a;border:1px solid #2d3139;
        border-radius:12px;overflow:hidden;
        flex-direction:column;
        box-shadow:0 10px 40px rgba(0,0,0,0.6);
    `;
    pop.style.display = "none";
    document.body.appendChild(pop);

    document.addEventListener("click", (e) => {
        const pop = document.getElementById("player-popover");
        if (pop && !e.target.closest(".player") && !pop.contains(e.target)) {
            pop.style.display = "none";
        }
    });
}

function formatDate(str) {
    if (!str) return "";
    return new Date(str).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function lookupEspnId(name, teamAbbrev) {
    if (espnIdCache[name] !== undefined) return espnIdCache[name];
    try {
        // Try ESPN search first
        const r = await fetch(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&limit=5&type=athlete&sport=football`);
        const d = await r.json();
        const items = d.items || [];
        const match = items.find(i => i.displayName?.toLowerCase() === name.toLowerCase()) || items[0];
        if (match?.id) {
            espnIdCache[name] = Number(match.id);
            return espnIdCache[name];
        }
        // Search returned nothing — fall back to fetching the NFL team roster.
        // Newer rookies often aren't in the ESPN search index yet.
        if (teamAbbrev) {
            const rr = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamAbbrev.toLowerCase()}/roster`);
            const rd = await rr.json();
            const allAthletes = (rd.athletes || []).flatMap(g => g.items || []);
            const nameLower = name.toLowerCase();
            const found = allAthletes.find(a =>
                (a.displayName || "").toLowerCase() === nameLower ||
                (a.fullName || "").toLowerCase() === nameLower
            );
            if (found?.id) {
                espnIdCache[name] = Number(found.id);
                return espnIdCache[name];
            }
        }
        espnIdCache[name] = null;
        return null;
    } catch {
        espnIdCache[name] = null;
        return null;
    }
}

function filterArticlesForPlayer(articles, playerName, espnId) {
    if (!playerName || !articles.length) return [];
    const espnIdNum = espnId ? Number(espnId) : null;
    const full = playerName.toLowerCase();
    const parts = playerName.split(" ");
    const last = parts[parts.length - 1].toLowerCase();
    const first = parts[0].toLowerCase();

    return articles.filter(a => {
        const text = ((a.headline || "") + " " + (a.description || "")).toLowerCase();
        // Category match (ESPN athlete tag): ESPN sometimes tags roundup articles with
        // many athletes. Require the player's last name also appears in text to avoid
        // false positives from sloppy ESPN metadata (e.g. Evans tagged on Achane article).
        if (espnIdNum) {
            const cats = a.categories || [];
            if (cats.some(c => c.type === "athlete" && Number(c.athleteId) === espnIdNum) && text.includes(last)) return true;
        }
        // Full name match in headline + description
        if (text.includes(full)) return true;
        return false;
    });
}

function renderNews(articles, injuries, playerName, espnId) {
    const relevant = filterArticlesForPlayer(articles, playerName, espnId);
    let html = "";

    injuries.forEach(inj => {
        html += `<div class="pc-news-item">
            <div class="pc-news-headline" style="color:#fbbf24;">⚠ ${inj.shortComment || "Injury Update"}</div>
            ${inj.longComment ? `<div class="pc-news-impact"><span class="pc-impact-label">Impact:</span> ${inj.longComment}</div>` : ""}
            <div class="pc-news-date">${formatDate(inj.date)}</div>
        </div>`;
    });

    if (injuries.length && relevant.length) {
        html += `<hr style="border:none;border-top:1px solid #2d3139;margin:10px 0;">`;
    }

    relevant.slice(0, 5).forEach(a => {
        html += `<div class="pc-news-item">
            <div class="pc-news-headline">${a.headline || ""}</div>
            ${a.description ? `<div class="pc-news-impact"><span class="pc-impact-label">Impact:</span> ${a.description}</div>` : ""}
            <div class="pc-news-date">${formatDate(a.published)}</div>
        </div>`;
    });

    if (!html) return `<div style="color:#5a6070;font-size:12px;">No recent news</div>`;
    return html;
}

const SOURCE_LABEL = { rotoballer: "RotoBaller", rotowire: "RotoWire", fantasy_pros: "FantasyPros" };

function renderSleeperNews(newsItems, injuries) {
    let html = "";

    // ESPN injury banner (from athleteData) takes precedence as an alert
    injuries.forEach(inj => {
        html += `<div class="pc-news-item">
            <div class="pc-news-headline" style="color:#fbbf24;">⚠ ${inj.shortComment || "Injury Update"}</div>
            ${inj.longComment ? `<div class="pc-news-impact"><span class="pc-impact-label">Impact:</span> ${inj.longComment}</div>` : ""}
            <div class="pc-news-date">${formatDate(inj.date)}</div>
        </div>`;
    });

    if (injuries.length && newsItems.length) {
        html += `<hr style="border:none;border-top:1px solid #2d3139;margin:10px 0;">`;
    }

    // Show top 5 Sleeper news items (already player-specific, no filtering needed)
    newsItems.slice(0, 5).forEach(item => {
        const m = item.metadata || {};
        const title = m.title || "";
        const desc = m.description || "";
        const analysis = m.analysis || "";
        const src = SOURCE_LABEL[item.source] || item.source || "";
        const date = item.published ? new Date(item.published).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }) : "";
        const url = m.url || "";
        const headlineHtml = url
            ? `<a href="${url}" target="_blank" rel="noopener" style="color:#f0f1f3;text-decoration:none;">${title}</a>`
            : title;
        html += `<div class="pc-news-item">
            <div class="pc-news-headline">${headlineHtml}</div>
            ${desc ? `<div class="pc-news-impact">${desc}</div>` : ""}
            ${analysis ? `<div class="pc-news-impact" style="color:#5a6070;margin-top:3px;">${analysis}</div>` : ""}
            <div class="pc-news-date">${src ? `<span style="color:#4299e1;font-weight:600;">${src}</span> · ` : ""}${date}</div>
        </div>`;
    });

    if (!html) return `<div style="color:#5a6070;font-size:12px;">No recent news</div>`;
    return html;
}

function positionPopover(popover, element) {
    const isMobile = window.innerWidth < 600;

    if (isMobile) {
        // CSS handles centering via media query — clear any JS-set overrides
        popover.style.left = "";
        popover.style.top = "";
        popover.style.transform = "";
        popover.style.width = "";
        popover.style.maxHeight = "";
        return;
    }

    // Desktop: anchor to clicked element
    const rect = element.getBoundingClientRect();
    const popW = 370;
    popover.style.width = `${popW}px`;
    popover.style.transform = "";

    // Horizontal: prefer right, fall back to left
    let left = rect.right + 12;
    if (left + popW > window.innerWidth - 8) left = rect.left - popW - 12;
    if (left < 8) left = 8;

    // Vertical: clamp so it fits within viewport
    const maxH = Math.min(window.innerHeight - 48, 600);
    popover.style.maxHeight = `${maxH}px`;
    let top = rect.top;
    if (top + maxH > window.innerHeight - 12) top = window.innerHeight - maxH - 12;
    if (top < 12) top = 12;

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

async function openPopover(element, player) {
    const popover = document.getElementById("player-popover");
    const body = document.getElementById("popover-body");
    if (!popover || !body) return;

    const pid = player.player_id;
    const pos = player.position || "";
    const posClr = posColor(pos);
    const pv = pvLookup(player.name);
    const heightStr = player.height
        ? `${Math.floor(Number(player.height) / 12)}'${Number(player.height) % 12}"`
        : "—";

    const headshotUrl = player.espn_id
        ? `https://a.espncdn.com/i/headshots/nfl/players/full/${player.espn_id}.png`
        : `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`;

    // Transaction history for this player
    const playerTxRows = [];
    const playerName = player.name;

    // Check draft history
    const draftArchive = window.__STATIC_DATA__?.draft || {};
    Object.entries(draftArchive).forEach(([dYear, picks]) => {
        (picks || []).forEach(pk => {
            if (pk.player === playerName) {
                const rd = pk.round ? `R${pk.round}` : "";
                playerTxRows.push({ date: `${dYear} Draft`, label: "Draft", detail: `${pk.picked_by}${rd ? " · " + rd : ""}`, season: dYear, sortKey: dYear });
            }
        });
    });

    // Check waiver/FA/trade transactions
    (allTransactions || []).forEach(t => {
        if (t.status === "failed") return;
        if (t.type !== "waiver" && t.type !== "free_agent" && t.type !== "trade") return;
        let label = "", detail = "";
        if (t.type === "trade") {
            Object.entries(t.assets_received || {}).forEach(([rcvTeam, assets]) => {
                if ((assets || []).some(a => a.name === playerName)) {
                    label = "Trade"; detail = rcvTeam;
                }
            });
        } else {
            if ((t.added || []).some(a => a.name === playerName)) {
                label = t.type === "waiver" ? "Waiver" : "Add";
                detail = (t.teams || [])[0] || "";
            } else if ((t.dropped || []).some(a => a.name === playerName)) {
                label = "Released"; detail = (t.teams || [])[0] || "";
            }
        }
        if (label) playerTxRows.push({ date: t.created || "", label, detail, season: t.season || "", sortKey: t.created || "" });
    });
    // Convert date strings like "Jun 04, 2026 • 12:14 PM PT" or year strings "2023"
    // to timestamps for proper chronological sort (localeCompare sorts month names alphabetically)
    function toTimestamp(key) {
        if (!key) return 0;
        if (/^\d{4}$/.test(key)) return new Date(key + '-01-01').getTime(); // just a year
        return new Date(key.replace(' •', ',').replace(/\s+PT$/, '')) || 0;
    }
    playerTxRows.sort((a, b) => toTimestamp(b.sortKey) - toTimestamp(a.sortKey)); // newest first

    const labelColor = { Draft: "#a78bfa", Trade: "#4299e1", Waiver: "#3ecf8e", Add: "#3ecf8e", Released: "#e74c82" };
    const txHistoryHtml = playerTxRows.length
        ? playerTxRows.map(r => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #2d3139;font-size:11px;">
                <div style="display:flex;align-items:center;gap:7px;">
                    <span style="background:${labelColor[r.label]||'#5a6070'}22;color:${labelColor[r.label]||'#8b9099'};font-weight:700;font-size:10px;padding:2px 6px;border-radius:4px;flex-shrink:0;">${r.label}</span>
                    <span style="color:#8b9099;">${r.detail}</span>
                </div>
                <span style="color:#5a6070;white-space:nowrap;margin-left:8px;">${r.date}</span>
            </div>`).join("")
        : `<div style="color:#5a6070;font-size:12px;">No transaction history</div>`;

    body.innerHTML = `
        <style>
            .pc-header { background:linear-gradient(135deg,#1e2027 0%,#252830 100%); padding:16px; border-radius:12px 12px 0 0; display:flex; gap:12px; align-items:center; position:relative; border-bottom:1px solid #2d3139; }
            .pc-close { position:absolute;top:10px;right:10px; background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1); color:#8b9099;width:26px;height:26px;border-radius:50%;cursor:pointer; font-size:13px;display:flex;align-items:center;justify-content:center; }
            .pc-close:hover { background:rgba(255,255,255,0.15);color:#f0f1f3; }
            .pc-headshot { width:68px;height:68px;border-radius:50%;object-fit:cover;border:2px solid ${posClr};flex-shrink:0;background:#252830; }
            .pc-name { color:#f0f1f3;font-size:17px;font-weight:800;margin-bottom:5px;line-height:1.2; }
            .pc-sub { color:#8b9099;font-size:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap; }
            .pc-pos-badge { background:${posClr};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px; }
            .pc-bio { display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #2d3139;background:#1e2027; }
            .pc-bio-item { padding:10px 6px;text-align:center;border-right:1px solid #2d3139;overflow:hidden; }
            .pc-bio-item:last-child { border-right:none; }
            .pc-bio-label { font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;margin-bottom:3px;white-space:nowrap; }
            .pc-bio-val { font-size:13px;font-weight:700;color:#f0f1f3;white-space:nowrap; }
            .pc-section { padding:12px 16px;border-bottom:1px solid #2d3139;background:#13151a; }
            .pc-section:last-child { border-bottom:none;border-radius:0 0 12px 12px; }
            .pc-section-title { font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;margin-bottom:10px;font-weight:700; }
            .pc-stats-table { width:100%;border-collapse:collapse;font-size:11px; }
            .pc-stats-table th { color:#5a6070;text-align:center;padding:4px 6px;border-bottom:1px solid #2d3139;font-weight:600; }
            .pc-stats-table td { text-align:center;padding:5px 6px;border-bottom:1px solid #2d3139;color:#c9cdd4; }
            .pc-stats-table td:first-child { text-align:left;font-weight:600;color:#f0f1f3; }
            .pc-stats-table tr:last-child td { font-weight:700;background:#1e2027;color:#f0f1f3; }
            .pc-news-item { margin-bottom:14px; }
            .pc-news-item:last-child { margin-bottom:0; }
            .pc-news-headline { font-size:13px;font-weight:700;color:#f0f1f3;margin-bottom:4px;line-height:1.4; }
            .pc-news-impact { font-size:12px;color:#8b9099;line-height:1.5;margin-bottom:3px; }
            .pc-impact-label { font-weight:700;color:#5a6070;text-transform:uppercase;font-size:10px;letter-spacing:.04em;margin-right:4px; }
            .pc-news-date { font-size:10px;color:#5a6070; }
        </style>

        <div class="pc-header" style="padding-right:42px;"><!-- close btn is outside scroll area -->
            <img class="pc-headshot" src="${headshotUrl}"
                onerror="this.src='https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg'" />
            <div style="flex:1;min-width:0;">
                <div class="pc-name">${player.name}</div>
                <div class="pc-sub">
                    <span class="pc-pos-badge">${pos}</span>
                    <span>${player.team || ""}</span>
                    ${player.birth_date || player.age ? `<span>· Age ${calcAgeDecimal(player.birth_date) || player.age}</span>` : ""}
                    ${player.college ? `<span>· ${player.college}</span>` : ""}
                </div>
            </div>
        </div>

        <div class="pc-bio">
            <div class="pc-bio-item"><div class="pc-bio-label">Rank</div><div class="pc-bio-val" style="color:${posClr};">${posRankStr(player) ?? "—"}</div></div>
            <div class="pc-bio-item"><div class="pc-bio-label">Age</div><div class="pc-bio-val">${calcAgeDecimal(player.birth_date) ?? player.age ?? "—"}</div></div>
            <div class="pc-bio-item"><div class="pc-bio-label">Height</div><div class="pc-bio-val">${heightStr}</div></div>
            <div class="pc-bio-item"><div class="pc-bio-label">Weight</div><div class="pc-bio-val">${player.weight ? player.weight + " lbs" : "—"}</div></div>
        </div>

        ${pv.apy ? (() => {
            const fmt = v => v >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1).replace(/\.0$/,'')}M` : `$${Math.round(v/1000)}K`;
            const gtdPct = pv.total_value ? Math.round((pv.guaranteed / pv.total_value) * 100) : null;
            const yrs = pv.years || '?';
            const span = pv.year_signed ? `${yrs} yr (${pv.year_signed}–${pv.year_end})` : `${yrs} yr`;
            const curYear = 2026;
            const remYrs = pv.year_end ? Math.max(0, pv.year_end - curYear + 1) : null;
            const remMoney = (remYrs !== null && pv.apy) ? pv.apy * remYrs : null;
            const remStr = remMoney !== null ? `${fmt(remMoney)}<span style="font-size:10px;color:#5a6070;font-weight:400;margin-left:4px;">(${remYrs} yr${remYrs !== 1 ? 's' : ''})</span>` : '—';
            return `<div class="pc-section">
                <div class="pc-section-title">Contract</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;">
                    <div><div style="font-size:10px;color:#5a6070;margin-bottom:2px;">Total Value</div><div style="font-size:13px;font-weight:700;color:#c9cdd4;">${fmt(pv.total_value)}</div></div>
                    <div><div style="font-size:10px;color:#5a6070;margin-bottom:2px;">Years</div><div style="font-size:13px;font-weight:700;color:#c9cdd4;">${span}</div></div>
                    <div><div style="font-size:10px;color:#5a6070;margin-bottom:2px;">Guaranteed</div><div style="font-size:13px;font-weight:700;color:#c9cdd4;">${fmt(pv.guaranteed)}</div></div>
                    <div><div style="font-size:10px;color:#5a6070;margin-bottom:2px;">Remaining</div><div style="font-size:13px;font-weight:700;color:#c9cdd4;">${remStr}</div></div>
                </div>
            </div>`;
        })() : ''}

        <div class="pc-section" id="espn-stats-rank-placeholder"></div>

        <div class="pc-section" id="espn-stats-section">
            <div style="display:flex;gap:6px;margin-bottom:10px;">
                <button id="pc-tab-stats" style="background:#252830;border:1px solid #3d4350;color:#f0f1f3;font-size:11px;font-weight:700;padding:4px 12px;border-radius:6px;cursor:pointer;font-family:inherit;">Career Stats</button>
                <button id="pc-tab-gamelogs" style="background:none;border:1px solid #2d3139;color:#5a6070;font-size:11px;font-weight:700;padding:4px 12px;border-radius:6px;cursor:pointer;font-family:inherit;">Game Logs</button>
            </div>
            <div id="espn-stats">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;font-weight:700;">Career</div>
                    <select id="pc-stats-year" style="background:#252830;border:1px solid #2d3139;border-radius:6px;color:#f0f1f3;font-size:12px;padding:3px 8px;cursor:pointer;">
                        <option value="all">All</option>
                        ${YEARS_DESC.map(y => `<option value="${y}">${y}</option>`).join("")}
                    </select>
                </div>
                <div id="pc-stats-body"><div style="color:#5a6070;font-size:12px;">Loading...</div></div>
            </div>
            <div id="espn-gamelogs" style="display:none;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;font-weight:700;">Season</div>
                    <select id="pc-gamelog-year" style="background:#252830;border:1px solid #2d3139;border-radius:6px;color:#f0f1f3;font-size:12px;padding:3px 8px;cursor:pointer;">
                        ${YEARS_DESC.map(y => `<option value="${y}">${y}</option>`).join("")}
                    </select>
                </div>
                <div id="pc-gamelog-body"><div style="color:#5a6070;font-size:12px;">Loading...</div></div>
            </div>
        </div>

        <div class="pc-section">
            <div class="pc-section-title">Transaction History</div>
            ${txHistoryHtml}
        </div>

        <div class="pc-section" id="espn-news">
            <div class="pc-section-title">Latest News</div>
            <div style="color:#5a6070;font-size:12px;">Loading...</div>
        </div>
    `;

    popover.style.display = "flex";
    positionPopover(popover, element);

    // Wire up tab buttons (module scope — can't use onclick attributes)
    document.getElementById("pc-tab-stats")?.addEventListener("click", () => switchPcTab("stats"));
    document.getElementById("pc-tab-gamelogs")?.addEventListener("click", () => switchPcTab("gamelogs"));
    document.getElementById("pc-gamelog-year")?.addEventListener("change", () => loadGameLog());
    document.getElementById("pc-stats-year")?.addEventListener("change", () => renderStatsForYear());

    // Store identifiers on popover for async tab handlers
    popover.dataset.pos = pos;
    popover.dataset.espnId = player.espn_id || "";
    popover.dataset.playerId = pid || "";

    // Kick off global NFL news fetch immediately (cached after first call)
    const espnId = player.espn_id || await lookupEspnId(player.name, player.team);
    if (espnId) popover.dataset.espnId = espnId;

    if (!player.espn_id && espnId) {
        const img = popover.querySelector(".pc-headshot");
        if (img) img.src = `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
    }

    try {
        // Fetch ESPN stats + injury data, and Sleeper news in parallel.
        // Sleeper's news endpoint is player-specific (Rotoballer/RotoWire/FantasyPros aggregated)
        // and CORS-enabled — far better coverage than ESPN's general news feed.
        const sleeperId = player.player_id;
        const [statsData, athleteData, sleeperNews] = await Promise.all([
            espnId ? fetch(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${espnId}/stats`).then(r => r.json()).catch(() => ({})) : Promise.resolve({}),
            espnId ? fetch(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${espnId}`).then(r => r.json()).catch(() => ({})) : Promise.resolve({}),
            sleeperId ? fetch(`https://api.sleeper.com/players/nfl/${sleeperId}/news`).then(r => r.json()).catch(() => []) : Promise.resolve([]),
        ]);

        const statsBodyEl = document.getElementById("pc-stats-body");

        if (espnId) {
            const categories = statsData.categories || [];
            const catPriority = { QB:"Passing", RB:"Rushing", WR:"Receiving", TE:"Receiving", K:"Scoring" };
            const cat = categories.find(c => c.displayName === catPriority[pos]) || categories[0];

            // Build a map of season year → position rank from local statsCache
            const rankByYear = {};
            for (const yr of YEARS) {
                const stat = statsCache?.[yr]?.[pid];
                if (stat?.rank > 0) rankByYear[yr] = `${stat.position || p.position}${stat.rank}`;
            }

            // Remove the rank placeholder div now that we have data
            const rankPlaceholder = document.getElementById("espn-stats-rank-placeholder");
            if (rankPlaceholder) rankPlaceholder.remove();

            if (cat && cat.statistics?.length) {
                const keyStats = { QB:[0,2,4,6,7,10], RB:[0,1,2,4,5,6], WR:[0,1,2,3,4,5], TE:[0,1,2,3,4,5], K:[0,1,2,3] };
                const indices = keyStats[pos] || [0,1,2,3,4];
                const labels = indices.map(i => cat.labels?.[i]).filter(Boolean);
                const allSeasons = [...cat.statistics].reverse().slice(0, 8);
                const totals = indices.map(i => cat.totals?.[i] ?? "—").join("</td><td>");

                // Store on popover for year filter re-render
                popover._statsData = { cat, indices, labels, allSeasons, totals, rankByYear };

                // Populate year dropdown options based on available seasons
                const yearSel = document.getElementById("pc-stats-year");
                if (yearSel) {
                    const existingYears = new Set([...yearSel.options].map(o => o.value));
                    allSeasons.forEach(s => {
                        const yr = s.season?.year ? String(s.season.year) : "";
                        if (yr && !existingYears.has(yr)) {
                            const opt = document.createElement("option");
                            opt.value = yr; opt.textContent = yr;
                            yearSel.appendChild(opt);
                        }
                    });
                }

                renderStatsForYear();
            } else {
                if (statsBodyEl) statsBodyEl.innerHTML = `<div style="color:#5a6070;font-size:12px;">No stats available</div>`;
            }
        } else {
            const rp = document.getElementById("espn-stats-rank-placeholder");
            if (rp) rp.remove();
            if (statsBodyEl) statsBodyEl.innerHTML = `<div style="color:#5a6070;font-size:12px;">Not available</div>`;
        }

        const injuries = athleteData.athlete?.injuries || [];
        document.getElementById("espn-news").innerHTML = `
            <div class="pc-section-title">Latest News</div>
            ${renderSleeperNews(sleeperNews, injuries)}`;

        // Re-clamp position after content loaded (height changed)
        positionPopover(popover, element);

    } catch (e) {
        console.error("Player card fetch error:", e);
        const sb = document.getElementById("pc-stats-body");
        if (sb) sb.innerHTML = `<div style="color:#5a6070;font-size:12px;">Failed to load</div>`;
        document.getElementById("espn-news").innerHTML = `<div class="pc-section-title">Latest News</div><div style="color:#5a6070;font-size:12px;">Failed to load</div>`;
    }
}

function renderStatsForYear() {
    const popover = document.getElementById("player-popover");
    const statsBodyEl = document.getElementById("pc-stats-body");
    if (!popover || !statsBodyEl || !popover._statsData) return;

    const { cat, indices, labels, allSeasons, totals, rankByYear } = popover._statsData;
    const yearSel = document.getElementById("pc-stats-year");
    const selectedYear = yearSel ? yearSel.value : "all";

    let seasons = allSeasons;
    if (selectedYear !== "all") {
        seasons = allSeasons.filter(s => s.season?.year ? String(s.season.year) === selectedYear : false);
    }

    if (!seasons.length) {
        statsBodyEl.innerHTML = `<div style="color:#5a6070;font-size:12px;">No data for ${selectedYear}</div>`;
        return;
    }

    const showCareer = selectedYear === "all";
    const rows = seasons.map(s => {
        const yr = s.season?.year ? String(s.season.year) : "";
        const rank = rankByYear[yr] ? `<td style="font-weight:700;color:#f0f1f3;">${rankByYear[yr]}</td>` : `<td style="color:#5a6070;">—</td>`;
        const vals = indices.map(i => s.stats?.[i] ?? "—").join("</td><td>");
        return `<tr><td>${s.season?.displayName ?? ""}</td>${rank}<td>${vals}</td></tr>`;
    }).join("");

    const yearCol = showCareer ? `<th style="text-align:left;">Year</th>` : `<th style="text-align:left;">Year</th>`;
    statsBodyEl.innerHTML = `
        <div style="overflow-x:auto;">
            <table class="pc-stats-table">
                <thead><tr>${yearCol}<th>Rank</th>${labels.map(l => `<th>${l}</th>`).join("")}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function switchPcTab(tab) {
    const statsEl = document.getElementById("espn-stats");
    const logsEl  = document.getElementById("espn-gamelogs");
    const btnS    = document.getElementById("pc-tab-stats");
    const btnG    = document.getElementById("pc-tab-gamelogs");
    if (!statsEl || !logsEl) return;
    const isStats = tab === "stats";
    statsEl.style.display  = isStats ? "" : "none";
    logsEl.style.display   = isStats ? "none" : "";
    if (btnS) { btnS.style.background = isStats ? "#252830" : "none"; btnS.style.color = isStats ? "#f0f1f3" : "#5a6070"; btnS.style.borderColor = isStats ? "#3d4350" : "#2d3139"; }
    if (btnG) { btnG.style.background = isStats ? "none" : "#252830"; btnG.style.color = isStats ? "#5a6070" : "#f0f1f3"; btnG.style.borderColor = isStats ? "#2d3139" : "#3d4350"; }
    if (!isStats) loadGameLog();
}

async function loadGameLog() {
    const body    = document.getElementById("pc-gamelog-body");
    const yearSel = document.getElementById("pc-gamelog-year");
    const pop     = document.getElementById("player-popover");
    if (!body || !yearSel || !pop) return;

    const playerId = pop.dataset.playerId;
    const pos      = pop.dataset.pos || "";
    const year     = yearSel.value;

    if (!playerId) { body.innerHTML = `<div style="color:#5a6070;font-size:12px;">No player ID available.</div>`; return; }
    body.innerHTML = `<div style="color:#5a6070;font-size:12px;">Loading...</div>`;

    // Columns per position — Pts + Rank first, then stats
    const STAT_COLS = {
        QB: [
            { key: "pts_half_ppr",      label: "Pts" },
            { key: "pos_rank_half_ppr", label: "Rnk", isRank: true },
            { key: "_cmp_att",          label: "Cmp/Att", combo: ["pass_cmp","pass_att"] },
            { key: "pass_yd",           label: "Yds"  },
            { key: "pass_td",           label: "TD"   },
            { key: "pass_int",          label: "INT"  },
            { key: "rush_yd",           label: "Ru"   },
        ],
        RB: [
            { key: "pts_half_ppr",      label: "Pts" },
            { key: "pos_rank_half_ppr", label: "Rnk", isRank: true },
            { key: "rush_att",          label: "Car"  },
            { key: "rush_yd",           label: "RuYd" },
            { key: "rec_tgt",           label: "Tgt"  },
            { key: "rec",               label: "Rec"  },
            { key: "rec_yd",            label: "ReYd" },
        ],
        WR: [
            { key: "pts_half_ppr",      label: "Pts" },
            { key: "pos_rank_half_ppr", label: "Rnk", isRank: true },
            { key: "rec_tgt",           label: "Tgt"  },
            { key: "rec",               label: "Rec"  },
            { key: "rec_yd",            label: "Yds"  },
            { key: "rec_td",            label: "TD"   },
        ],
        TE: [
            { key: "pts_half_ppr",      label: "Pts" },
            { key: "pos_rank_half_ppr", label: "Rnk", isRank: true },
            { key: "rec_tgt",           label: "Tgt"  },
            { key: "rec",               label: "Rec"  },
            { key: "rec_yd",            label: "Yds"  },
            { key: "rec_td",            label: "TD"   },
        ],
        K: [
            { key: "pts_std",           label: "Pts"  },
            { key: "pos_rank_std",      label: "Rnk", isRank: true },
            { key: "_fg",               label: "FG",  combo: ["fgm","fga"] },
            { key: "xpm",               label: "XPM"  },
        ],
    };
    const cols = STAT_COLS[pos] || STAT_COLS.WR;

    try {
        const fetches = Array.from({ length: 18 }, (_, i) => {
            const wk = i + 1;
            return fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${year}/${wk}`)
                .then(r => r.json())
                .then(d => ({ week: wk, stats: d[playerId] || null }))
                .catch(() => ({ week: wk, stats: null }));
        });
        const weeks = await Promise.all(fetches);
        const played = weeks.filter(w => w.stats && (w.stats.gp > 0 || w.stats.gms_active > 0));

        if (!played.length) {
            body.innerHTML = `<div style="color:#5a6070;font-size:12px;">No game data for ${year}.</div>`;
        } else {
            const fmt = v => v == null ? "—" : Number.isInteger(v) ? v : parseFloat(v.toFixed(1));
            const cellVal = (col, stats) => {
                if (col.combo) return `${fmt(stats[col.combo[0]] ?? null)}/${fmt(stats[col.combo[1]] ?? null)}`;
                const v = stats[col.key];
                return v != null ? fmt(v) : "—";
            };
            const rankColor = v => {
                if (!v) return "#5a6070";
                if (v <= 5)  return "#3ecf8e";
                if (v <= 12) return "#4299e1";
                if (v <= 24) return "#f6ad55";
                return "#e74c82";
            };
            const headers = cols.map(c => `<th style="white-space:nowrap;">${c.label}</th>`).join("");
            const rows = played.map(({ week, stats }) => {
                const vals = cols.map(c => {
                    if (c.isRank) {
                        const v = stats[c.key];
                        return `<td style="font-weight:700;color:${rankColor(v)};">${v != null ? v : "—"}</td>`;
                    }
                    return `<td>${cellVal(c, stats)}</td>`;
                }).join("");
                return `<tr><td style="font-weight:600;color:#f0f1f3;white-space:nowrap;">Wk ${week}</td>${vals}</tr>`;
            }).join("");
            // Totals (skip rank col)
            const totals = cols.map(c => {
                if (c.isRank) return `<td>—</td>`;
                if (c.combo) {
                    const s0 = played.reduce((s,w)=>s+(w.stats[c.combo[0]]||0),0);
                    const s1 = played.reduce((s,w)=>s+(w.stats[c.combo[1]]||0),0);
                    return `<td style="font-weight:700;">${fmt(s0)}/${fmt(s1)}</td>`;
                }
                const sum = played.reduce((s,w)=>s+(w.stats[c.key]||0),0);
                return `<td style="font-weight:700;">${fmt(sum)}</td>`;
            }).join("");
            body.innerHTML = `<div style="overflow-x:auto;">
                <style>
                    #pc-gamelog-body table { font-size:11px; }
                    #pc-gamelog-body th, #pc-gamelog-body td { padding:4px 5px; }
                </style>
                <table class="pc-stats-table">
                    <thead><tr><th style="text-align:left;">Wk</th>${headers}</tr></thead>
                    <tbody>${rows}<tr><td style="font-weight:700;color:#f0f1f3;">Tot</td>${totals}</tr></tbody>
                </table></div>`;
        }
    } catch(e) {
        body.innerHTML = `<div style="color:#5a6070;font-size:12px;">Failed to load game log.</div>`;
    }
    const pop2 = document.getElementById("player-popover");
    if (pop2) positionPopover(pop2, null);
}

init();
