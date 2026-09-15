import { api } from "./dataService.js?v=202609150609";
import { renderNav } from "./components/nav.js?v=202609150609";

const YEARS_DESC = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort().reverse();
const POS_COLORS = { QB:"#e74c82", RB:"#3ecf8e", WR:"#4299e1", TE:"#f6ad55", K:"#9f7aea", DEF:"#94a3b8" };
const FAAB_BUDGET = 100;
const NUM_TEAMS = 12; // league size — used to convert overall pick_no to round-relative slot

let allData = [];
let usersMap = {};
let faabRemainingMap = {}; // transaction_id → remaining after this bid
// pickMap["2025-2-ddhk"] = { player, position, team }  (year-round-picked_by)
let pickMap = {};
// pickRetradeMap["2025-2-ddhk"] = [{toTeam, date, txId}, ...] sorted by date
// When ddhk received a 2025 R2 pick in a trade, then later re-traded it, this tracks those re-trades.
let pickRetradeMap = {};
let selectedUser = "all";

function computeFaabRemaining(txData) {
    const spent = {}; // "team-season" → running total
    const result = {};
    // Sleeper transaction_id is a snowflake — higher = later. Sort numerically for chronological order.
    const waiverTxs = txData
        .filter(t => t.type === "waiver" && t.status === "complete" && (t.waiver_bid || t.faab))
        .sort((a, b) => BigInt(a.transaction_id) < BigInt(b.transaction_id) ? -1 : 1);
    waiverTxs.forEach(t => {
        const team = (t.teams || [])[0];
        const year = t.season;
        if (!team || !year) return;
        const key = `${team}-${year}`;
        if (spent[key] === undefined) spent[key] = 0;
        spent[key] += (t.waiver_bid || t.faab || 0);
        result[t.transaction_id] = FAAB_BUDGET - spent[key];
    });
    return result;
}

function fmtPick(name) {
    return (name || "").replace(/Round\s+(\d+)/i, "R$1");
}

function posBadge(pos) {
    const color = POS_COLORS[(pos || "").toUpperCase()] || "#5a6070";
    return `<span class="pos-badge" style="background:${color}">${pos || "?"}</span>`;
}

const INACTIVE_USERS = new Set(['edgxrjiang', 'riqi', 'shmyung', 'urmummma', 'JUNNNNAY']);
function avatarEl(name) {
    const letter = (name||"?")[0].toUpperCase();
    if (INACTIVE_USERS.has(name)) {
        return `<span class="tx-avatar-init tx-avatar-inactive">${letter}</span>`;
    }
    const url = usersMap[name];
    const fallback = `<span class="tx-avatar-init">${letter}</span>`;
    if (url) {
        return `<img class="tx-avatar" src="${url}" onerror="this.outerHTML='${fallback.replace(/'/g,"&#39;").replace(/"/g,"&quot;")}'">`;
    }
    return fallback;
}

// Build the full retrade chain for a pick received by `team`, returning HTML lines.
// retradeConsumers tracks which entry to use when a team received multiple same-round picks.
function buildPickChainHtml(year, round, team, afterDate, depth, retradeConsumers, draftConsumers) {
    if (depth > 6) return ""; // guard against infinite loops
    const key = `${year}-${round}-${team}`;
    const retradeArr = pickRetradeMap[key] || [];
    const parseTxDate = s => s ? new Date(s.replace(' •', ',').replace(/\s+PT$/, '')).getTime() : 0;
    const afterTs = parseTxDate(afterDate);
    // Use a consumer index so multiple same-round picks in one trade each get their own chain entry
    const consumerKey = `${key}-${afterDate}`;
    const cidx = retradeConsumers[consumerKey] || 0;
    const matching = retradeArr.filter(r => parseTxDate(r.date) > afterTs);
    const retrade = matching[cidx];
    if (!retrade) {
        // No re-trade — caller will handle showing "Drafted" for the final holder
        return null;
    }
    retradeConsumers[consumerKey] = cidx + 1;
    // This team re-traded the pick. Show the next hop, then recurse.
    let html = `<div style="display:flex;align-items:center;gap:5px;margin-top:3px;">
        <span style="font-size:9px;color:#5a6070;">↓ traded to</span>
        <span style="font-size:11px;font-weight:600;color:#a78bfa;">${retrade.toTeam}</span>
        <span style="font-size:10px;color:#5a6070;">${retrade.date.split('•')[0].trim()}</span>
    </div>`;
    // Recurse: did THAT team also re-trade it?
    const nextChain = buildPickChainHtml(year, round, retrade.toTeam, retrade.date, depth + 1, retradeConsumers, draftConsumers);
    if (nextChain === null) {
        // retrade.toTeam kept it — find what they drafted
        const dpKey = `${year}-${round}-${retrade.toTeam}`;
        const dpArr = pickMap[dpKey] || [];
        const didx = draftConsumers[dpKey] || 0;
        const dp = dpArr[didx];
        if (dp) {
            draftConsumers[dpKey] = didx + 1;
            const pickInRound = dp.pick_no - (round - 1) * NUM_TEAMS;
            html += `<div style="display:flex;align-items:center;gap:5px;margin-top:3px;">
                <span style="font-size:9px;color:#5a6070;">→ drafted</span>
                ${posBadge(dp.position)}
                <span style="font-size:11px;font-weight:600;color:#c9cdd4;">${dp.player}</span>
                <span style="font-size:10px;color:#5a6070;">(${round}.${String(pickInRound).padStart(2,"0")})</span>
            </div>`;
        }
    } else {
        html += nextChain;
    }
    return html;
}

function assetRow(asset, receivedBy, pickConsumers, tradeDate, retradeConsumers, draftConsumers) {
    if ((asset.position || "").toUpperCase() === "PICK") {
        // name format: "2025 Round 2" → year=2025, round=2
        const m = (asset.name || "").match(/(\d{4})\s+Round\s+(\d+)/i);
        let detailHtml = "";
        const round = m ? parseInt(m[2]) : null;
        let slotSuffix = "";
        if (m && receivedBy) {
            const year = m[1];
            const key = `${year}-${round}-${receivedBy}`;
            const idx = pickConsumers[key] || 0;

            // Check if receivedBy later re-traded this pick
            const chainHtml = buildPickChainHtml(year, round, receivedBy, tradeDate || "", 0, retradeConsumers, draftConsumers);

            if (chainHtml !== null) {
                // Pick was re-traded — show the chain instead of drafted player
                detailHtml = `<div style="margin-top:4px;padding:4px 8px;background:#1a1c22;border-radius:6px;border-left:2px solid #a78bfa22;">
                    ${chainHtml}
                </div>`;
            } else {
                // Pick stayed with receivedBy — show who they drafted
                const arr = pickMap[key] || [];
                const dp = arr[idx];
                if (dp) {
                    pickConsumers[key] = idx + 1;
                    const pickInRound = dp.pick_no - (round - 1) * NUM_TEAMS;
                    slotSuffix = ` (${round}.${String(pickInRound).padStart(2, "0")})`;
                    detailHtml = `
    <div style="margin-top:4px;padding:4px 8px;background:#1a1c22;border-radius:6px;border-left:2px solid #3d4350;">
        <div style="font-size:10px;color:#5a6070;margin-bottom:2px;">Drafted</div>
        <div style="display:flex;align-items:center;gap:5px;">
            ${posBadge(dp.position)}
            <span style="font-size:11px;font-weight:600;color:#c9cdd4;">${dp.player}</span>
        </div>
    </div>`;
                }
            }
        }
        return `<div class="tx-asset-row" style="flex-direction:column;align-items:flex-start;">
    <div style="display:flex;align-items:center;gap:6px;">
        <span class="pick-badge">PICK</span>
        <span class="tx-asset-name">${fmtPick(asset.name)}${slotSuffix}</span>
    </div>
    ${detailHtml}
</div>`;
    }
    return `<div class="tx-asset-row">
        ${posBadge(asset.position)}
        ${asset.team ? `<span class="tx-asset-team">${asset.team}</span>` : ""}
        <span class="tx-asset-name">${asset.name || ""}</span>
    </div>`;
}

function renderTrade(t) {
    const entries = Object.entries(t.assets_received || {});
    if (entries.length < 2) return "";

    // Per-trade consumption indexes — shared across all columns so multiple
    // same-round picks each get their own unique chain / drafted player.
    const pickConsumers = {};
    const retradeConsumers = {};
    const draftConsumers = {};

    const cols = entries.map(([team, assets]) => `
        <div class="tx-trade-col">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                ${avatarEl(team)}
                <span class="tx-col-name">@${team}</span>
            </div>
            <div class="tx-verb added" style="margin-bottom:4px;">↑ IN</div>
            <div class="tx-assets">${(assets || []).map(a => assetRow(a, team, pickConsumers, t.created, retradeConsumers, draftConsumers)).join("")}</div>
        </div>`
    ).join('<div class="tx-swap">⇄</div>');

    return `<div class="tx-card">
        <div class="tx-card-header">
            <span class="tx-meta-date">${t.created || ""}</span>
            <span style="background:#1a1040;color:#a78bfa;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;flex-shrink:0;">Trade</span>
        </div>
        <div class="tx-trade-body">${cols}</div>
    </div>`;
}

function renderWaiverFA(t) {
    const isWaiver = t.type === "waiver";
    const failed   = t.status === "failed";
    const team     = (t.teams || [])[0] || "";
    const faab     = t.waiver_bid || t.faab || 0;

    const failedBidsHtml = (t._failedBids && t._failedBids.length)
        ? `<div class="tx-lost-bids">
            <span class="tx-lost-label">Lost bids:</span>
            ${t._failedBids.map(b => `<span class="tx-lost-bid">${b.teams?.[0] || '?'} $${b.waiver_bid}</span>`).join("")}
           </div>`
        : "";

    const typeLabel = isWaiver ? (failed ? "Failed" : "Waiver") : "Free Agent";
    const typeBg    = failed ? "#3d4350" : isWaiver ? "#292202" : "#0c1a2e";
    const typeColor = failed ? "#8b9099" : isWaiver ? "#fbbf24" : "#60a5fa";

    return `<div class="tx-card ${failed ? "tx-failed" : ""}">
        <div class="tx-card-header">
            <div style="display:flex;flex-direction:column;gap:4px;">
                ${t.created ? `<span style="font-size:11px;color:#8b9099;">${t.created}</span>` : ""}
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    ${avatarEl(team)}
                    <span style="font-size:13px;font-weight:700;color:#f0f1f3;">@${team}</span>
                    ${faab > 0 ? (() => {
                        const remaining = faabRemainingMap[t.transaction_id];
                        const remStr = remaining !== undefined ? ` ($${remaining} left)` : "";
                        return `<span style="background:#292202;color:#fbbf24;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700;">$${faab}${remStr}</span>`;
                    })() : ""}
                </div>
            </div>
            <span style="background:${typeBg};color:${typeColor};border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;flex-shrink:0;">${typeLabel}</span>
        </div>
        <div class="tx-waiver-body">
            <div class="tx-waiver-col">
                <div class="tx-verb added">↑ ADD</div>
                <div class="tx-assets">${(t.added || []).map(assetRow).join("") || '<span class="tx-none">—</span>'}</div>
            </div>
            <div class="tx-waiver-col">
                <div class="tx-verb dropped">↓ DROP</div>
                <div class="tx-assets">${(t.dropped || []).map(assetRow).join("") || '<span class="tx-none">—</span>'}</div>
            </div>
        </div>
        ${failedBidsHtml}
        ${t.notes && failed ? `<div class="tx-notes">${t.notes}</div>` : ""}
    </div>`;
}

function renderTransaction(t) {
    return t.type === "trade" ? renderTrade(t) : renderWaiverFA(t);
}

function attachFailedBids(txs) {
    const failed = txs.filter(t => t.status === "failed" && t.type === "waiver");
    const successful = txs.filter(t => t.status !== "failed");

    const failedByPlayer = {};
    failed.forEach(t => {
        const playerName = t.added?.[0]?.name;
        if (!playerName) return;
        const key = `${t.season}-${t.week}-${playerName}`;
        if (!failedByPlayer[key]) failedByPlayer[key] = [];
        failedByPlayer[key].push(t);
    });

    const matchedFailed = new Set();
    successful.forEach(t => {
        if (t.type !== "waiver") return;
        const playerName = t.added?.[0]?.name;
        if (!playerName) return;
        const key = `${t.season}-${t.week}-${playerName}`;
        const bids = failedByPlayer[key] || [];
        if (bids.length) {
            t._failedBids = bids;
            bids.forEach(b => matchedFailed.add(b.transaction_id));
        }
    });

    const unmatchedFailed = failed.filter(t => !matchedFailed.has(t.transaction_id));
    return [...successful, ...unmatchedFailed];
}

// ── Custom user dropdown with avatars ─────────────────────────────────────────

const AVATAR_COLORS = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"];
function accentColor(name) {
    return AVATAR_COLORS[(name||"?").split("").reduce((s,c)=>s+c.charCodeAt(0),0) % AVATAR_COLORS.length];
}

function buildUserDropdown(activeUsers, inactiveUsers) {
    const wrap = document.getElementById("userFilterWrap");
    if (!wrap) return;

    function optionHtml(username) {
        const url = usersMap[username];
        const color = accentColor(username);
        const letter = (username||"?")[0].toUpperCase();
        const sz = 22;
        const avatarHtml = url
            ? `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`
            : `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0;">${letter}</span>`;
        return `<div class="tx-ud-option" data-user="${username}" style="display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;border-radius:6px;white-space:nowrap;">${avatarHtml}<span style="font-size:13px;color:#c9cdd4;">${username}</span></div>`;
    }

    const menuHtml = `
        <div class="tx-ud-option" data-user="all" style="display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;border-radius:6px;">
            <span style="font-size:13px;line-height:1;">👥</span><span style="font-size:13px;color:#c9cdd4;">All Users</span>
        </div>
        ${activeUsers.map(u => optionHtml(u)).join("")}
        ${inactiveUsers.length ? `<div style="margin:4px 8px;border-top:1px solid #2d3139;"></div><div style="font-size:10px;color:#5a6070;padding:4px 12px;text-transform:uppercase;letter-spacing:.06em;">Former Members</div>${inactiveUsers.map(u => optionHtml(u)).join("")}` : ""}
    `;

    wrap.innerHTML = `
        <style>
            #txUserFilterBtn { background:#1e2028;border:1.5px solid #2d3139;border-radius:999px;padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:13px;line-height:1;color:#c9cdd4;white-space:nowrap;user-select:none;font-family:inherit; }
            #txUserFilterBtn:hover { border-color:#5a6070; }
            #txUserFilterMenu { position:absolute;top:calc(100% + 4px);left:0;background:#1e2028;border:1px solid #2d3139;border-radius:8px;padding:4px;z-index:100;min-width:180px;box-shadow:0 8px 24px rgba(0,0,0,.4); }
            .tx-ud-option:hover { background:#252830; }
            .tx-ud-option.selected { background:#252830; }
        </style>
        <div style="position:relative;">
            <button id="txUserFilterBtn"><span style="font-size:13px;line-height:1;">👥</span> All Users <span style="font-size:10px;color:#5a6070;">▼</span></button>
            <div id="txUserFilterMenu" style="display:none;">${menuHtml}</div>
        </div>
    `;

    const btn = document.getElementById("txUserFilterBtn");
    const menu = document.getElementById("txUserFilterMenu");

    btn.addEventListener("click", e => {
        e.stopPropagation();
        menu.style.display = menu.style.display === "none" ? "block" : "none";
    });

    menu.querySelectorAll(".tx-ud-option").forEach(el => {
        el.addEventListener("click", () => {
            selectedUser = el.dataset.user;
            menu.style.display = "none";
            if (selectedUser === "all") {
                btn.innerHTML = '<span style="font-size:13px;line-height:1;">👥</span> All Users <span style="font-size:10px;color:#5a6070;">▼</span>';
            } else {
                const url = usersMap[selectedUser];
                const color = accentColor(selectedUser);
                const letter = (selectedUser||"?")[0].toUpperCase();
                const sz = 22;
                const av = url
                    ? `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;">`
                    : `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;">${letter}</span>`;
                btn.innerHTML = `${av} <span style="font-size:13px;">${selectedUser}</span> <span style="font-size:10px;color:#5a6070;">▼</span>`;
            }
            render();
        });
    });

    document.addEventListener("click", () => { menu.style.display = "none"; }, { capture: true, passive: true });
}

function render() {
    const yearVal = document.getElementById("filterYear").value;
    const typeVal = document.getElementById("filterType").value;
    let filtered = allData.filter(t => t.type !== "commissioner");
    if (yearVal !== "all") filtered = filtered.filter(t => t.season === yearVal);
    if (typeVal !== "all") filtered = filtered.filter(t => t.type === typeVal);
    if (selectedUser !== "all") {
        filtered = filtered.filter(t => {
            if (t.type === "trade") return (t.teams || []).includes(selectedUser);
            return t.team === selectedUser;
        });
    }

    const grouped = {};
    filtered.forEach(t => {
        const key = `${t.season}-${String(t.week).padStart(2, "0")}`;
        if (!grouped[key]) grouped[key] = { season: t.season, week: t.week, txs: [] };
        grouped[key].txs.push(t);
    });

    const board = document.getElementById("tx-board");

    if (!Object.keys(grouped).length) {
        board.innerHTML = `<div class="tx-empty">No transactions found.</div>`;
        return;
    }

    let html = "";
    Object.keys(grouped)
        .sort((a, b) => b.localeCompare(a))
        .forEach(key => {
            const { season, week, txs } = grouped[key];
            const processed = attachFailedBids(txs);
            const completed = processed.filter(t => t.status !== "failed");
            const failedTxs = processed.filter(t => t.status === "failed");

            html += `<div class="tx-week"><div class="tx-week-label">${season} — ${week === 0 ? "Offseason" : "Week " + week}</div>`;
            completed.forEach(t => { html += renderTransaction(t); });
            failedTxs.forEach(t => { html += renderTransaction(t); });
            html += `</div>`;
        });

    board.innerHTML = html;
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();

    const container = document.getElementById("transactions-container");

    container.innerHTML = `
    <style>
        #transactions-container { max-width: 800px; margin: 0; }

        .tx-week { margin-bottom: 32px; }
        .tx-week-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #5a6070;
            font-weight: 700;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid #2d3139;
        }

        .tx-card {
            background: #1e2027;
            border: 1px solid #2d3139;
            border-radius: 10px;
            padding: 14px 16px;
            margin-bottom: 8px;
        }
        .tx-card.tx-failed { opacity: 0.35; }

        .tx-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .tx-meta-date { font-size: 11px; color: #5a6070; }
        .tx-count-badge {
            background: #252830;
            color: #8b9099;
            border-radius: 999px;
            padding: 2px 10px;
            font-size: 11px;
            font-weight: 700;
        }

        /* Trade layout */
        .tx-trade-body {
            display: flex;
            gap: 10px;
            align-items: flex-start;
        }
        .tx-trade-col { flex: 1; min-width: 0; }
        .tx-col-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 8px;
        }
        .tx-col-name { font-size: 12px; font-weight: 700; color: #f0f1f3; flex: 1; }
        .tx-in-label {
            font-size: 10px;
            font-weight: 700;
            color: #3ecf8e;
            background: rgba(62,207,142,0.12);
            border-radius: 4px;
            padding: 1px 6px;
        }
        .tx-swap {
            font-size: 16px;
            color: #3d4350;
            flex-shrink: 0;
            align-self: center;
            padding: 0 2px;
        }

        /* Waiver/FA layout */
        .tx-waiver-body {
            display: flex;
            gap: 16px;
        }
        .tx-waiver-col { flex: 1; min-width: 0; }

        /* Asset rows */
        .tx-assets { display: flex; flex-direction: column; gap: 2px; }
        .tx-asset-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 3px 0;
        }
        .tx-asset-name {
            font-size: 12px;
            font-weight: 600;
            color: #f0f1f3;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .tx-asset-team { font-size: 11px; color: #5a6070; flex-shrink: 0; }

        .pos-badge {
            display: inline-block;
            color: #fff;
            border-radius: 4px;
            padding: 1px 0;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.04em;
            flex-shrink: 0;
            min-width: 36px;
            text-align: center;
        }
        .pick-badge {
            display: inline-block;
            background: #252830;
            color: #a78bfa;
            border-radius: 4px;
            padding: 1px 0;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.04em;
            flex-shrink: 0;
            min-width: 36px;
            text-align: center;
        }

        .tx-verb {
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 2px 8px;
            border-radius: 4px;
            width: fit-content;
            margin-bottom: 6px;
        }
        .tx-verb.added   { background: #064e3b; color: #34d399; }
        .tx-verb.dropped { background: #450a0a; color: #f87171; }

        .tx-avatar {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
        }
        .tx-avatar-init {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: #252830;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 700;
            color: #5a6070;
            flex-shrink: 0;
        }
        .tx-avatar-inactive {
            background: #3a3f4a;
            color: #5a6070;
        }

        .tx-lost-bids { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .tx-lost-label { font-size: 10px; color: #5a6070; font-weight: 700; text-transform: uppercase; }
        .tx-lost-bid { background: #450a0a; color: #f87171; border-radius: 4px; padding: 1px 8px; font-size: 11px; font-weight: 600; }
        .tx-notes { font-size: 11px; color: #5a6070; font-style: italic; margin-top: 6px; }
        .tx-none { color: #3d4350; font-size: 12px; }
        .tx-empty { color: #5a6070; padding: 20px 0; text-align: center; }

        @media (max-width: 600px) {
            .tx-card { padding: 12px; }
            .tx-trade-body { flex-wrap: wrap; }
            .tx-trade-col { flex: 1 1 45%; min-width: 140px; }
            .tx-swap { align-self: flex-start; padding-top: 28px; }
            .tx-waiver-body { gap: 8px; }
            .tx-waiver-col { flex: 1; min-width: 0; }
        }
        @media (max-width: 400px) {
            .tx-trade-body { flex-direction: column; }
            .tx-trade-col { flex: unset; }
            .tx-swap { display: none; }
        }
    </style>

    <div class="filter-bar">
        <select id="filterYear">
            <option value="all">All Years</option>
            ${YEARS_DESC.map(y => `<option value="${y}">${y}</option>`).join("")}
        </select>
        <select id="filterType">
            <option value="all">All Types</option>
            <option value="trade">Trades</option>
            <option value="waiver">Waivers</option>
            <option value="free_agent">Free Agents</option>
        </select>
        <div id="userFilterWrap" style="position:relative;display:inline-block;"></div>
    </div>

    <div id="tx-board">Loading...</div>
    `;

    try {
        const [txData, usersList] = await Promise.all([
            api.getTransactions(),
            api.getLeagueUsers(),
        ]);
        allData = txData;
        const PAUL_YOON_AVATAR = "https://sleepercdn.com/images/v4/avatars/avatar_default_blue.webp";
        (usersList || []).forEach(u => { usersMap[u.username] = u.username === "Paul_Yoon" ? PAUL_YOON_AVATAR : u.avatar_url; });

        // Determine active users (have rosters in any year)
        const rosters2026 = await api.getRosters("2026").catch(() => []);
        const activeSet = new Set((rosters2026 || []).map(r => r.owner).filter(Boolean));
        // Collect ALL usernames from transactions (captures former members not in leagueUsers)
        const txUsernames = new Set();
        (txData || []).forEach(t => {
            (t.teams || []).forEach(u => txUsernames.add(u));
            if (t.team) txUsernames.add(t.team);
        });
        (usersList || []).forEach(u => txUsernames.add(u.username));
        // Filter out NFL team codes (e.g. "KC", "DAL") that appear in transaction data
        const allTxUsers = [...txUsernames].filter(u => u && !/^[A-Z]{2,3}$/.test(u));
        const activeUsers   = allTxUsers.filter(u => activeSet.has(u)).sort();
        const inactiveUsers = allTxUsers.filter(u => !activeSet.has(u)).sort();

        buildUserDropdown(activeUsers, inactiveUsers);
        // Add former members to usersMap (letter fallback since no avatar_url)
        [...txUsernames].filter(u => !usersMap[u]).forEach(u => { usersMap[u] = null; });
        faabRemainingMap = computeFaabRemaining(allData);

        // Build pick→player lookup from draft archive.
        // Key: "year-round-picked_by" → sorted array of traded picks (pick_no, player, position).
        // Only includes picks that arrived via trade (original_owner !== picked_by).
        // Sorted by pick_no so sequential consumption in assetRow matches draft order.
        const draftArchive = window.__STATIC_DATA__?.draft || {};
        Object.entries(draftArchive).forEach(([year, picks]) => {
            (picks || []).forEach(p => {
                if (p.player && p.picked_by && p.original_owner !== p.picked_by) {
                    const key = `${year}-${p.round}-${p.picked_by}`;
                    if (!pickMap[key]) pickMap[key] = [];
                    pickMap[key].push({ player: p.player, position: p.position, team: p.team, pick_no: p.pick_no });
                }
            });
        });
        // Sort each array by pick_no ascending
        Object.values(pickMap).forEach(arr => arr.sort((a, b) => a.pick_no - b.pick_no));

        // Build pickRetradeMap: for each team that received a pick in a trade,
        // track if/when they sent that same pick on to another team.
        // Key: "year-round-holder" → [{toTeam, date, txId}, ...] sorted by date.
        function parseTxDate(s) {
            if (!s) return 0;
            try { return new Date(s.replace(' •', ',').replace(/\s+PT$/, '')).getTime(); }
            catch { return 0; }
        }
        const trades = allData.filter(t => t.type === "trade" && t.status !== "failed");
        const tradesSorted = [...trades].sort((a, b) => parseTxDate(a.created) - parseTxDate(b.created));

        tradesSorted.forEach(t => {
            const date = t.created || "";
            const txId = t.transaction_id || "";
            const teams = t.teams || [];
            for (const [recvTeam, assets] of Object.entries(t.assets_received || {})) {
                for (const a of assets) {
                    if ((a.position || "").toUpperCase() !== "PICK") continue;
                    const m = (a.name || "").match(/(\d{4})\s+Round\s+(\d+)/i);
                    if (!m) continue;
                    const year = m[1], round = parseInt(m[2]);
                    // "recvTeam received this pick" — record that recvTeam now holds year/round pick
                    // All other teams in this trade SENT this pick (they gave it up)
                    for (const sender of teams) {
                        if (sender === recvTeam) continue;
                        const key = `${year}-${round}-${sender}`;
                        if (!pickRetradeMap[key]) pickRetradeMap[key] = [];
                        pickRetradeMap[key].push({ toTeam: recvTeam, date, txId });
                    }
                }
            }
        });
        // Sort each array by date
        Object.values(pickRetradeMap).forEach(arr => arr.sort((a, b) => parseTxDate(a.date) - parseTxDate(b.date)));

        document.getElementById("filterYear").addEventListener("change", render);
        document.getElementById("filterType").addEventListener("change", render);
        // user dropdown events wired inside buildUserDropdown
        render();
    } catch (err) {
        console.error(err);
        document.getElementById("tx-board").innerHTML = "Failed to load transactions.";
    }
}

init();
