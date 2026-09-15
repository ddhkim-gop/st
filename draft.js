import { api } from "./dataService.js?v=202609150609";
import { renderNav } from "./components/nav.js?v=202609150609";

const YEARS_DESC = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort().reverse();
(function fillYearSelect() {
    const el = document.getElementById("yearSelect");
    if (el && !el.options.length) el.innerHTML = YEARS_DESC.map(y => `<option value="${y}">${y}</option>`).join("");
})();
const PLAYER_PROFILES = {
  // 2026
  "Jeremiyah Love": { college:"Notre Dame", profile:"A powerful, compact back at 6'0\" with a low pad level, relentless contact balance, and surprising receiving ability (27 catches in his final season). The 1.01 of the 2026 class — drafted 3rd overall by Arizona to be their feature back immediately. A true cornerstone dynasty piece." },
  "Carnell Tate": { college:"Ohio State", profile:"A polished, pro-ready route runner with strong hands and the body control of a true alpha WR. Went 4th overall to the Titans, projecting as their WR1 from day one. His technique and immediate opportunity make him one of the safest dynasty investments in this class." },
  "Jordyn Tyson": { college:"Arizona State", profile:"An explosive separation specialist who posted 75 catches, 1,101 yards, and 10 TDs in 2024 — a sharp, decisive route runner who creates YAC after the catch. Selected 8th by New Orleans into a pass-heavy scheme. Dynasty consensus places him 1.02–1.04; a high-floor, high-ceiling WR1 prospect." },
  "Fernando Mendoza": { college:"California / Indiana", profile:"A Heisman-winning pocket processor who transferred from Cal to Indiana, where he led the Hoosiers to a national championship in 2025 — accuracy-first with Cousins/Ryan comps. Went 1st overall to the Raiders and inherits Brock Bowers and Ashton Jeanty as weapons. The clear dynasty 1.01 at QB; his supporting cast gives him an immediate floor that most rookie QBs can't match." },
  "Makai Lemon": { college:"USC", profile:"The 2025 Biletnikoff Award winner — a contested-catch specialist and dual-alignment weapon who posted 79-1,156-11 for the Trojans. Traded up for by the Eagles (20th overall), who project him as a slot specialist. An elite ceiling pick who needs to earn his target share in a deep Philly receiving corps." },
  "Jadarian Price": { college:"Notre Dame", profile:"A complementary workhorse who carried Notre Dame's backfield alongside Jeremiyah Love, rushing for 1,692 yards and 21 TDs over three seasons. Went 32nd overall to Seattle — a run-leaning organization looking for a featured back. A reliable between-the-tackles runner with a strong floor as a potential bell cow. Dynasty mid-R1 with immediate opportunity." },
  "Omar Cooper": { college:"Indiana", profile:"A slot weapon with elite YAC ability who posted 69-937-13 with 2.55 yards per route run for the Hoosiers — a late bloomer who hit his stride in Indiana's breakout offense. Drafted 30th by the Jets as an immediate depth-starter. His after-catch ability and volume in New York's pass offense make him a reliable dynasty flex." },
  "KC Concepcion": { college:"Texas A&M", profile:"A versatile slot/outside hybrid (61-919-9 in 2025) selected 24th by Cleveland as their projected WR1 under new HC Todd Monken. His target-share ownership is immediate in a pass-hungry offense. One of the safest dynasty picks in the class based on role clarity alone." },
  "Kenyon Sadiq": { college:"Oregon", profile:"An elite athletic TE — 4.39 forty, 43.5\" vertical — who posted 51-560-8 as a mismatch slot threat. Selected 16th by the Jets; TE development is slow but his rare athleticism and top-16 draft capital give him a Travis Kelce-ceiling in dynasty." },
  "Denzel Boston": { college:"Washington", profile:"A physical 'X' receiver at 6'4\" who posted 62-881-11 in 2025 at Washington — a jump-ball threat who wins with size and timing. Drafted 39th overall (2nd round) by the Browns to complement KC Concepcion, which caps his immediate share. A massive upside play who needs target separation to reach his ceiling." },
  "Ty Simpson": { college:"Alabama", profile:"A developmental QB who backed up at Alabama before earning 1st-round capital (13th, Rams) as the eventual Matthew Stafford successor. Won't produce immediately but holds strong long-term franchise QB value in LA's winning system. A dynasty stash in 1QB, high-end SF pick." },
  "Eli Stowers": { college:"Vanderbilt", profile:"A former QB turned TE whose pass-catcher instincts give him unusually clean routes and ball-plucking hands. Selected 54th by the Eagles as Goedert's heir — his blocking limitations are a concern but his receiving upside is legitimate. A dynasty late-R1 TE with a clear succession plan in Philly." },
  "Nicholas Singleton": { college:"Penn State", profile:"Penn State's all-time leader in total touchdowns (55) and rushing touchdowns (45) — an explosive, finesse-style cutter with elite burst and underrated receiving ability. Fell to the 5th round (165th overall) to the Titans — significantly lower draft capital than his talent suggested. A dynasty R2 pick purely on athletic upside despite the late landing spot." },
  "Carson Beck": { college:"Georgia / Miami", profile:"A two-time national champion backup at Georgia who transferred to Miami for his final season — a pocket passer with NFL size and a strong arm, though inconsistent decision-making caused him to fall to 65th overall. Backing up Fernando Mendoza in Arizona — a dart throw in deep superflex leagues but unlikely to see the field soon." },
  "Zachariah Branch": { college:"USC / Georgia", profile:"A speed weapon who transferred from USC to Georgia and ran a 4.35 forty at the Combine — a flashy playmaker with big-play ability whose college production was inconsistent. Drafted 79th by the Falcons as a gadget/deep threat. His speed gives him a high ceiling but spotty route running creates real dynasty risk." },
  "Germie Bernard": { college:"Alabama", profile:"A route runner who bounced from Michigan State to Washington to Alabama, posting 64 catches for 862 yards and 7 TDs in his final season with the Tide. Drafted 47th overall (2nd round) by the Pittsburgh Steelers into an offense looking for a reliable intermediate target. Dynasty R1–2 range in formats where his path to targets is clear." },
  "Emmett Johnson": { college:"Nebraska", profile:"A zone-scheme back with vision and receiving upside, but drafted 161st by the Chiefs — historically one of the worst dynastyRB landing spots due to their pass-first system. A low-priority late flier despite good traits." },
  // 2025
  "Ashton Jeanty": { college:"Boise State", profile:"A generational workhorse who rushed for 2,601 yards in 2024 (second-most in FBS history) — compact at 5'8\" with elite quickness, vision, and three-down ability. The consensus 1.01 of the 2025 dynasty class; drafted 6th overall by the Raiders alongside Brock Bowers. His ceiling in Vegas is sky-high." },
  "Tetairoa McMillan": { college:"Arizona", profile:"A polished X-receiver at 6'4\" with elite catch radius, fluid route running, and the ability to win at all three levels — not just on jump balls. Selected 8th overall by the Carolina Panthers as their immediate WR1. Dynasty 1.02–1.03 with a rare combination of size, technique, and opportunity in Carolina's pass-heavy offense." },
  "Omarion Hampton": { college:"North Carolina", profile:"A downhill workhorse at 6'0\", 221 lbs who posted 1,660 yards and 15 TDs in 2024 while adding 38 receptions. The surest bell-cow back in the class behind Jeanty, drafted by the Chargers into a strong passing offense that boosts his receiving floor. Dynasty 1.02 RB with elite floor and upside." },
  "Quinshon Judkins": { college:"Ohio State", profile:"A physical, downhill runner with relentless pad level and elite contact balance — a high-volume ball-carrier who starred at both Ole Miss and Ohio State. Landed in Cleveland where Nick Chubb's departure opens an immediate path to carries. A workhorse archetype with a legitimate starting role and strong dynasty floor." },
  "Travis Hunter": { college:"Colorado", profile:"A once-in-a-generation two-way WR/CB at 6'1\" with elite athleticism, route savvy, and big-play ability — a legitimate WR1 profile regardless of his two-way role. Drafted 2nd overall by Jacksonville, who will feature him heavily on offense. A top-5 dynasty superflex pick whose usage uncertainty is the only caveat." },
  "TreVeyon Henderson": { college:"Ohio State", profile:"A compact, explosive cutter at 5'10\" with elite one-cut agility and strong PPR receiving versatility — a finesse/receiving back rather than a pure workhorse. Selected by the Patriots as an early-down and pass-catching weapon. Dynasty 1.06 with high PPR ceiling once he earns a featured role." },
  "Cam Skattebo": { college:"Arizona State", profile:"A battering ram workhorse who rushed for 1,711 yards in 2024, added 605 receiving yards, and forced approximately 102 missed tackles per PFF — one of the best marks in the class. Drafted 105th overall (4th round) by the New York Giants under Brian Daboll. His workload and pass-catching make him a reliable weekly dynasty producer despite the late draft capital." },
  "Cam Ward": { college:"Miami", profile:"A dual-threat franchise QB selected 1st overall by the Titans — prototypical size with a strong arm and experience across multiple programs. A clear Day 1 starter, though Tennessee's supporting cast creates weekly volatility. Dynasty R1 SF asset with long-term franchise QB ceiling." },
  "Emeka Egbuka": { college:"Ohio State", profile:"A complete receiver with elite route running, reliable hands, and the IQ to line up inside and outside — a football-intelligence-first prospect. Drafted by the Buccaneers behind veteran depth, limiting his immediate role. Dynasty 1.09 range; his long-term outlook is elite once Tampa's target share opens up." },
  "Jaxson Dart": { college:"Ole Miss", profile:"An accurate pocket passer with strong processing ability and pro-ready mechanics — the Giants traded significant capital to move up for him. Faces a murky early starting timeline, making him a dynasty stash rather than immediate contributor. SF mid-round; the long-term QB of the Giants franchise once he locks in the job." },
  "Luther Burden": { college:"Missouri", profile:"A YAC specialist with elite yards-after-contact and quickness in the short/intermediate game — Curtis Samuel comps are common. Drafted by the Chicago Bears under Ben Johnson, known for unlocking WR talent, giving him one of the best offensive situations in the class. Dynasty 1.08 with genuine scheme-elevated upside." },
  "RJ Harvey": { college:"UCF", profile:"An explosive, high-motor back who posted 1,577 yards and 22 TDs in 2024 — a speed/burst archetype who excels in space. Drafted by the Broncos into a messy backfield situation analysts flagged. Elite athleticism but the committee situation muddies his dynasty value; high upside if he wins the job." },
  "Tyler Warren": { college:"Penn State", profile:"An elite receiving TE who was a consensus top-15 overall prospect — a versatile inline/move TE with the route running and athleticism to be a weekly fantasy weapon. Drafted 14th overall by the Indianapolis Colts, the highest any Penn State TE has ever been drafted. Dynasty TE1 of his class with immediate impact potential." },
  "Colston Loveland": { college:"Michigan", profile:"A receiving TE with elite production (top-6 in yards per route run) drafted 10th overall by the Bears alongside Luther Burden. Ben Johnson's pass-first offense from day one gives him rare TE1 opportunity as a mover. Dynasty 2.01 TE; top-10 capital plus a pass-first offense makes him one of the safest TE investments in the class." },
  "Jayden Higgins": { college:"Iowa State", profile:"A big-bodied possession receiver with reliable hands and intermediate-route efficiency — a size/catch-radius receiver who projects as a boundary WR1. Drafted by the Texans into a strong passing attack with a clear role need. Higher floor than his draft position suggested." },
  "Kyle Williams": { college:"Washington State", profile:"A speed/YAC receiver projected to start immediately for the Patriots as a rookie — rare immediate-starter upside for a Day 2 pick. A quickness-first archetype who creates separation with burst and sharp route breaks. Dynasty 2.08 with a higher floor than most Day 2 picks due to immediate role clarity." },
  "Matthew Golden": { college:"Texas", profile:"An explosive speed receiver with separation ability and YAC talent — a first-round pick by Green Bay who projects as an immediate contributor in their WR-friendly offense. A quickness-and-catch-after-the-catch type more than a big-body 'X.' Dynasty 1.10; Green Bay's system has a strong track record of producing fantasy WRs." },
  "Kaleb Johnson": { college:"Iowa", profile:"A zone-scheme specialist with elite vision and patience — a one-cut-and-go style that translates well to the NFL. Drafted by Pittsburgh, who run a physical rushing attack that suits his skill set. Younger than his peers and well-suited to Pittsburgh's scheme; a dynasty sleeper with significant upside." },
  "Shedeur Sanders": { college:"Colorado", profile:"A polished pocket passer with elite accuracy and anticipation — his father Deion Sanders' coaching helped develop a pro-ready ball placement artist. Fell further than expected in the draft but landed with a team that wants to develop him. A dynasty SF stash with long-term QB upside." },
  "Jalen Milroe": { college:"Alabama", profile:"A dual-threat QB with elite rushing ability and a live arm — more athletic upside than Dart or Dart's class peers. A dynasty SF late-round flier with Lamar Jackson-esque rushing upside if the passing game develops." },
  // 2024
  "Caleb Williams": { college:"USC", profile:"A Mahomes-level dual-threat talent with elite arm improvisation and plus rushing upside — the consensus 1.01 pick, drafted by the Bears into an offense with DJ Moore, Rome Odunze, and Cole Kmet. A generational QB prospect already emerging as one of dynasty's most valuable overall players." },
  "Marvin Harrison": { college:"Ohio State", profile:"Son of HOF receiver Marvin Harrison Sr. — a polished route runner at 6'4\" with elite hands and separation ability that mirrors his father's precision. Drafted 4th overall by Arizona as Kyler Murray's WR1 in an offense starved for reliable weapons. Already producing as an elite dynasty WR with a locked-in alpha role." },
  "Jayden Daniels": { college:"LSU", profile:"A dynamic dual-threat QB whose rushing ability (1,100+ college rush yards) gives him a weekly floor independent of his passing. Selected 2nd overall by Washington, where he immediately became one of fantasy's top-scoring QBs. Dynasty top-3 SF — his rushing floor makes him a weekly top-5 fantasy QB regardless of efficiency." },
  "Malik Nabers": { college:"LSU", profile:"LSU's all-time leader in receptions (189) and receiving yards (3,003) — an elite route runner and YAC weapon at 6'0\". Selected 6th overall by the Giants, where he set the NFL rookie receptions record with 109 catches for 1,204 yards. Dynasty 1.01–1.03 WR; already established as an elite dynasty asset with a massive target share." },
  "Rome Odunze": { college:"Washington", profile:"An elite route runner and contested-catch specialist at 6'3\" — described as 'the next Mike Evans iteration' with plus athleticism across all three route depths. Selected by the Bears alongside Caleb Williams, giving him one of the best QB/WR pairings in the draft. Dynasty top-5 WR; ceiling is a perennial top-10 dynasty producer." },
  "Ladd McConkey": { college:"Georgia", profile:"A next-level route runner and YAC machine with elite short-area separation — a pure slot technician who dominated in the Chargers' offense under Jim Harbaugh. His precision routes and catch-in-traffic ability make him a plus PPR asset despite lacking elite size. Dynasty WR2/flex stud already producing as one of fantasy's most reliable PPR assets." },
  "Brock Bowers": { college:"Georgia", profile:"A generational TE talent with wide receiver-level route running — his yards per route run and separation metrics exceeded all TEs in recent memory. Selected by the Raiders where he broke TE rookie receiving records. Dynasty 1.01 TE and one of the most valuable overall dynasty assets regardless of position." },
  "Brian Thomas": { college:"LSU", profile:"An elite speed-size combo at 6'2\" with explosive deep-ball ability and the physicality to win at all levels. Drafted 23rd overall by the Jacksonville Jaguars, where he led all 2024 WR rookies with 1,282 receiving yards and 10 TDs, earning AP Offensive Rookie of the Year. Already one of the highest-ceiling dynasty WRs in the entire player pool." },
  "JJ McCarthy": { college:"Michigan", profile:"An accurate, system-efficient pocket passer with strong poise and solid athleticism — selected 10th overall by Minnesota, who traded up for him. Missed his entire 2024 rookie season to injury, making him a dynasty stash. SF 1.03–1.07; franchise QB ceiling in a Vikings offense built to win once healthy." },
  "Drake Maye": { college:"North Carolina", profile:"A prototypical 6'4\" frame with special arm talent and plus athleticism (1,147 rush yards across two seasons) — strong deep-ball mechanics with room to develop his pocket processing. Selected 3rd overall by New England as their franchise QB of the future. Dynasty SF top-5; elite arm/athletic combo in a wide-open starting role." },
  "Xavier Worthy": { college:"Texas", profile:"The fastest player in 2024 draft history at 4.21 seconds — a true burner who turns short passes into home runs and stretches defenses vertically. Drafted by Kansas City (who traded up) as a complement to the Chiefs' offense under Andy Reid. Dynasty WR2/flex; Chiefs' volume is spread thin but Worthy's speed creates consistent TD upside in one of the league's best offenses." },
  "Jonathon Brooks": { college:"Texas", profile:"Described as arguably the best RB prospect in his class before a torn ACL late in 2023 — a three-down back with elite vision, receiving ability, and passing-down skills. Drafted by the Panthers, who traded up specifically for him. Dynasty high-upside RB; ACL recovery is the primary concern, but his talent level is top-5 RB dynasty upside if healthy." },
  "Bucky Irving": { college:"Oregon", profile:"A zone-scheme specialist with excellent vision, burst, and receiving ability — a versatile two-phase back in the Christian McCaffrey mold at a smaller scale. Drafted by Tampa Bay into Todd Bowles' offense. Dynasty RB2/flex sleeper; receiving versatility and a clear path to touches in Tampa give him a higher PPR floor than his draft position suggested." },
  "Keon Coleman": { college:"Florida State", profile:"A physical jump-ball WR at 6'4\", 215 lbs with elite size and athleticism — a contested-catch specialist who wins in the red zone and on back-shoulder throws. Drafted by the Bills into a premier offense with Josh Allen. Dynasty WR2/upside play; his red zone role and Josh Allen's arm give him consistent TD upside." },
  "Adonai Mitchell": { college:"Texas", profile:"A long, athletic boundary receiver with plus size and strong hands — a possession/contested-catch receiver with vertical speed. Drafted by Indianapolis alongside Anthony Richardson, whose big arm could unlock Mitchell as a deep-ball target. A high-ceiling stash in dynasty." },
  "Ricky Pearsall": { college:"Florida", profile:"A route-running technician with crisp separation and strong hands, drafted by the 49ers into Kyle Shanahan's elite offensive system. Shanahan's track record of developing WRs gives him an elevated ceiling relative to his draft position. Dynasty 'draft and stash' with scheme-backed upside." },
  "Jermaine Burton": { college:"Alabama", profile:"An explosive speed receiver with elite burst and big-play ability — a boom-or-bust downfield threat who struggled with consistency at Alabama despite elite physical tools. A Day 2 developmental pick with a murky starting role. Dynasty late-round dart; elite speed creates TD upside but inconsistent route running limits his floor." },
  "Trey Benson": { college:"Florida State", profile:"A long-striding power back at 6'0\", 216 lbs with excellent size and deceptive speed — a workhorse archetype with underrated receiving ability. A Day 2 pick with a path to starting carries. Dynasty RB2/flex; his physical workhorse profile fits an NFL offense well, with value hinged on winning the starting job." },
};

const PICK_BG = { QB:"#fda4af", RB:"#86efac", WR:"#93c5fd", TE:"#fdba74", K:"#c4b5fd", DEF:"#94a3b8" };
const PICK_FG = { QB:"#e74c82", RB:"#16a34a", WR:"#2563eb", TE:"#d97706", K:"#7c3aed", DEF:"#475569" };

const CARD_H = 72;
const COL_W  = 130; // px per team column

let allTransactions = [];
let leagueUsers     = [];
let playerStats     = {};   // year → { player_id: { pts_half_ppr } }
let playerNameMap   = {};   // player_name → player_id

function pickBg(pos)  { return PICK_BG[(pos||"").toUpperCase()] || "#d1d5db"; }
function pickFg(pos)  { return PICK_FG[(pos||"").toUpperCase()] || "#374151"; }

function abbrevName(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return name;
    return parts[0][0] + ". " + parts.slice(1).join(" ");
}

const AVATAR_COLORS_DRAFT = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"];
const INACTIVE_USERS = new Set(['edgxrjiang', 'riqi', 'shmyung', 'urmummma', 'JUNNNNAY']);
function accentColorDraft(name) {
    return AVATAR_COLORS_DRAFT[(name||"?").split("").reduce((s,c)=>s+c.charCodeAt(0),0) % AVATAR_COLORS_DRAFT.length];
}
function avatarEl(username, size = 24) {
    const sz = size;
    const letter = (username || "?")[0].toUpperCase();
    if (INACTIVE_USERS.has(username)) {
        return `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:#3a3f4a;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.45)}px;font-weight:700;color:#5a6070;flex-shrink:0;">${letter}</span>`;
    }
    const u = leagueUsers.find(u => u.username === username);
    const url = u?.avatar_url;
    const fallback = `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:${accentColorDraft(username)};display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.45)}px;font-weight:800;color:#fff;flex-shrink:0;">${letter}</span>`;
    if (!url) return fallback;
    return `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.outerHTML='${fallback.replace(/'/g,"&#39;").replace(/"/g,"&quot;")}'">`;
}

// ── Positional breakdown ──────────────────────────────────────────────────────

function calcAvgAge(picks) {
    if (!picks.length) return null;
    const now = new Date();
    const ages = picks.map(p => {
        if (!p.birth_date) return null;
        const ms = now - new Date(p.birth_date);
        return ms / (365.25 * 24 * 60 * 60 * 1000);
    }).filter(a => a !== null);
    if (!ages.length) return null;
    return (ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1);
}

function renderPositions(picks, year) {
    const byPos = { QB:[], RB:[], WR:[], TE:[], K:[] };
    picks.forEach(p => {
        const pos = (p.position||"").toUpperCase();
        if (byPos[pos]) byPos[pos].push(p);
    });
    const total = picks.length;

    const POSITIONS = ["QB","RB","WR","TE","K"];
    const posBoxes = POSITIONS.map(pos => ({
        label: pos,
        n: byPos[pos].length,
        age: calcAvgAge(byPos[pos]),
        bg: PICK_BG[pos],
        fg: PICK_FG[pos],
    }));
    const allAge = calcAvgAge(picks);

    const el = document.getElementById("position-stats");
    el.style.cssText = "flex:1;min-width:0;";
    el.innerHTML = `
        <div style="display:flex;gap:6px;width:100%;">
            ${posBoxes.map(({label, n, age, bg, fg}) => `
                <div style="background:${bg};border-radius:8px;padding:8px 6px;text-align:center;flex:1;min-width:0;">
                    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(0,0,0,0.45);margin-bottom:3px;">${label}</div>
                    <div style="font-size:20px;font-weight:800;color:rgba(0,0,0,0.75);line-height:1.1;">${n}</div>
                    ${age != null ? `<div style="font-size:9px;font-weight:600;color:rgba(0,0,0,0.4);margin-top:3px;">avg ${age}</div>` : ""}
                </div>`).join("")}
            <div style="background:#e2e8f0;border-radius:8px;padding:8px 6px;text-align:center;flex:1;min-width:0;">
                <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(0,0,0,0.35);margin-bottom:3px;">Total</div>
                <div style="font-size:20px;font-weight:800;color:rgba(0,0,0,0.6);line-height:1.1;">${total}</div>
                ${allAge != null ? `<div style="font-size:9px;font-weight:600;color:rgba(0,0,0,0.35);margin-top:3px;">avg ${allAge}</div>` : ""}
            </div>
        </div>`;
}

// ── Pick card ─────────────────────────────────────────────────────────────────

function renderPickCard(p, roundNum) {
    if (!p) {
        return `<div style="height:${CARD_H}px;background:#1a1c21;border-radius:8px;border:1px dashed #2d3139;box-sizing:border-box;"></div>`;
    }

    const pos     = (p.position || "").toUpperCase();
    const bg      = pickBg(pos);
    const fg      = pickFg(pos);
    const traded  = p.original_owner && p.original_owner !== p.picked_by;
    const label   = `${roundNum}.${p._pick_in_round}`;
    const name    = abbrevName(p.player);

    // pts from player stats
    const pid  = playerNameMap[p.player];
    const pts  = pid && playerStats[pid] ? playerStats[pid].pts_half_ppr : null;
    const ptsStr = pts != null ? ` · ${Math.round(pts)}` : "";

    return `<div class="pick-card" data-pick='${JSON.stringify({
        round: String(roundNum), pickNo: String(p._pick_in_round),
        pickedBy: p.picked_by||"", originalOwner: p.original_owner||"",
        player: p.player||"", pos, team: p.team||"", label,
        year: p.season||"",
    }).replace(/'/g,"&#39;")}' style="
        background:${bg};border-radius:8px;padding:7px 8px;
        height:${CARD_H}px;box-sizing:border-box;
        display:flex;flex-direction:column;gap:3px;
        cursor:pointer;transition:filter .12s;
    " onmouseenter="this.style.filter='brightness(.9)'" onmouseleave="this.style.filter=''">

        <!-- Row 1: name (left) + pick number (right) -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:4px;">
            <div style="font-size:12px;font-weight:800;color:rgba(0,0,0,.85);line-height:1.2;
                        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;">${name}</div>
            <div style="font-size:9px;font-weight:700;color:rgba(0,0,0,0.38);letter-spacing:.02em;flex-shrink:0;white-space:nowrap;">${label}</div>
        </div>

        <!-- Row 2: pos badge + NFL team -->
        <div style="display:flex;align-items:center;gap:4px;">
            <span style="background:${fg};color:#fff;border-radius:3px;padding:1px 5px;
                         font-size:8px;font-weight:800;letter-spacing:.04em;flex-shrink:0;">${pos||"—"}</span>
            <span style="font-size:9px;color:rgba(0,0,0,.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${p.team||""}${ptsStr}
            </span>
        </div>

        <!-- Row 3: picker avatar + name (bottom), with → if traded -->
        <div style="margin-top:auto;display:flex;align-items:center;gap:4px;min-width:0;">
            ${traded ? `<span style="font-size:10px;color:rgba(0,0,0,.4);flex-shrink:0;font-weight:700;">→</span>` : ""}
            ${avatarEl(p.picked_by, 14)}
            <span style="font-size:9px;color:rgba(0,0,0,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
                ${p.picked_by||"—"}
            </span>
        </div>
    </div>`;
}

// ── Main board ────────────────────────────────────────────────────────────────

function renderDraft(picks) {
    const container = document.getElementById("draft-container");
    if (!picks || !picks.length) {
        container.innerHTML = `<div class="card">No draft data found.</div>`;
        return;
    }

    // Group by round
    const byRound = {};
    picks.forEach(p => {
        const r = p.round || 0;
        if (!byRound[r]) byRound[r] = [];
        byRound[r].push(p);
    });
    const rounds = Object.keys(byRound).map(Number).sort((a,b) => a-b);

    // Sort each round by pick_no; assign _pick_in_round
    rounds.forEach(r => {
        byRound[r].sort((a,b) => (a.pick_no||0)-(b.pick_no||0));
        byRound[r].forEach((p,i) => { p._pick_in_round = i+1; });
    });

    const nTeams = Math.max(...rounds.map(r => byRound[r].length));

    // Column order = original owners of round-1 picks, in pick order
    const round1 = (byRound[1] || []).slice().sort((a,b) => (a.pick_no||0)-(b.pick_no||0));
    const colTeams = round1.map(p => p.original_owner || p.picked_by);

    // Build grid: grid[round][col] = pick  (snake draft)
    const grid = {};
    rounds.forEach(r => {
        grid[r] = new Array(nTeams).fill(null);
        byRound[r].forEach(p => {
            const i   = p._pick_in_round - 1;                     // 0-indexed position within round
            const col = r % 2 === 1 ? i : (nTeams - 1 - i);      // snake: even rounds reverse
            grid[r][col] = p;
        });
    });

    // ── Column headers ──────────────────────────────────────────────────────
    const headerCells = colTeams.map(team => {
        const inactiveDiv = `<div style="width:36px;height:36px;border-radius:50%;background:#3a3f4a;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#5a6070;">${(team||"?")[0].toUpperCase()}</div>`;
        const letterDiv = `<div style="width:36px;height:36px;border-radius:50%;background:#252830;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#5a6070;">${(team||"?")[0].toUpperCase()}</div>`;
        let avatarHtml;
        if (INACTIVE_USERS.has(team)) {
            avatarHtml = inactiveDiv;
        } else {
            const u = leagueUsers.find(u => u.username === team);
            const url = u?.avatar_url;
            avatarHtml = url
                ? `<img src="${url}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid #2d3139;" onerror="this.outerHTML='${letterDiv.replace(/'/g,"&#39;").replace(/"/g,"&quot;")}'">`
                : letterDiv;
        }
        return `
            <div style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 4px 8px;">
                ${avatarHtml}
                <div style="font-size:10px;font-weight:700;color:#c9cdd4;text-align:center;
                            max-width:${COL_W-8}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${team||"—"}
                </div>
            </div>`;
    }).join("");

    // ── Rows ────────────────────────────────────────────────────────────────
    const rowsHtml = rounds.map(r => {
        const cells = Array.from({length: nTeams}, (_,c) => `<div>${renderPickCard(grid[r][c], r)}</div>`).join("");
        return `
            <div style="display:grid;grid-template-columns:40px repeat(${nTeams},${COL_W}px);gap:5px;margin-bottom:5px;align-items:stretch;">
                <div style="display:flex;align-items:center;justify-content:center;
                            background:#252830;border-radius:6px;font-size:10px;font-weight:700;
                            color:#5a6070;letter-spacing:.04em;min-height:${CARD_H}px;">
                    R${r}
                </div>
                ${cells}
            </div>`;
    }).join("");

    const boardWidth = 40 + nTeams * (COL_W + 5);
    // Cap the top bar (year select + position stats) to the same width as the draft board
    const topBar = document.querySelector("#draft-container")?.previousElementSibling;
    if (topBar) topBar.style.maxWidth = boardWidth + "px";

    container.innerHTML = `
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:8px;">
            <div style="min-width:${boardWidth}px;">
                <div style="display:grid;grid-template-columns:40px repeat(${nTeams},${COL_W}px);gap:5px;margin-bottom:2px;">
                    <div></div>
                    ${headerCells}
                </div>
                ${rowsHtml}
            </div>
        </div>`;

    // Click → popover
    container.querySelectorAll(".pick-card").forEach(card => {
        card.addEventListener("click", () => {
            try { openPickPopover(card, JSON.parse(card.getAttribute("data-pick").replace(/&#39;/g,"'"))); }
            catch(e) { console.error(e); }
        });
    });
}

// ── Popover ───────────────────────────────────────────────────────────────────

function ensurePickPopover() {
    if (document.getElementById("pick-popover")) return;
    const pop = document.createElement("div");
    pop.id = "pick-popover";
    pop.style.cssText = `display:none;position:fixed;z-index:9999;background:#13151a;border:1px solid #2d3139;border-radius:12px;width:300px;max-height:min(480px,calc(100vh - 32px));overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,.6);`;
    document.body.appendChild(pop);
    document.addEventListener("click", e => {
        const p = document.getElementById("pick-popover");
        if (p && !e.target.closest(".pick-card") && !p.contains(e.target)) p.style.display = "none";
    });
}

function openPickPopover(el, data) {
    const pop = document.getElementById("pick-popover");
    if (!pop) return;
    const { round, pickNo, pickedBy, originalOwner, player, pos, team, label, year } = data;
    const bg = pickBg(pos);
    const fg = pickFg(pos);
    const traded = originalOwner && originalOwner !== pickedBy;

    // Trade history: only trades where this specific pick changed hands.
    // Match on year + round in asset name, and at least one team is originalOwner or pickedBy.
    const relevantTeams = new Set([originalOwner, pickedBy].filter(Boolean));
    const tradeHistory = [];
    (allTransactions||[]).forEach(t => {
        if (t.type !== "trade") return;
        // Must involve at least one known owner of this pick
        if (!t.teams.some(tm => relevantTeams.has(tm))) return;
        Object.entries(t.assets_received||{}).forEach(([receiver, assets]) => {
            (assets||[]).forEach(a => {
                if ((a.position||"").toUpperCase() !== "PICK") return;
                const n = a.name||"";
                // Match year (if present in name) and round
                const matchesYear = !year || n.includes(year);
                const matchesRound = n.includes(`Round ${round}`) || n.match(new RegExp(`R${round}\\b`));
                if (matchesYear && matchesRound) {
                    tradeHistory.push({ receiver, date: t.created });
                }
            });
        });
    });

    pop.innerHTML = `
        <div style="background:${bg};padding:14px 16px;border-radius:12px 12px 0 0;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                    <div style="font-size:10px;font-weight:700;color:rgba(0,0,0,.4);text-transform:uppercase;letter-spacing:.05em;">Pick ${label}</div>
                    <div style="font-size:16px;font-weight:800;color:rgba(0,0,0,.85);margin-top:3px;">${player||"Unknown"}</div>
                    <div style="display:flex;align-items:center;gap:5px;margin-top:5px;">
                        <span style="background:${fg};color:#fff;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:800;">${pos}</span>
                        <span style="font-size:11px;color:rgba(0,0,0,.55);font-weight:600;">${team}</span>
                    </div>
                </div>
                <button onclick="document.getElementById('pick-popover').style.display='none'"
                    style="background:rgba(0,0,0,.1);border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;color:rgba(0,0,0,.5);font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
            </div>
        </div>
        <div style="padding:14px 16px;">
            <div style="display:flex;gap:16px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #2d3139;">
                <div>
                    <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Picked By</div>
                    <div style="display:flex;align-items:center;gap:6px;">${avatarEl(pickedBy,20)}<span style="font-size:13px;font-weight:700;color:#f0f1f3;">${pickedBy||"—"}</span></div>
                </div>
                ${traded ? `<div>
                    <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Original Owner</div>
                    <div style="display:flex;align-items:center;gap:6px;">${avatarEl(originalOwner,20)}<span style="font-size:13px;font-weight:700;color:#f0f1f3;">${originalOwner}</span></div>
                </div>` : ""}
            </div>
            ${tradeHistory.length ? `
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;font-weight:700;margin-bottom:8px;">Trade History</div>
            ${tradeHistory.map(e => `
                <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #2d3139;font-size:12px;">
                    <span style="color:#f0f1f3;font-weight:600;">→ ${e.receiver}</span>
                    <span style="color:#5a6070;">${e.date||""}</span>
                </div>`).join("")}` : ""}
        </div>`;

    pop.style.display = "block";
    const rect = el.getBoundingClientRect();
    const popW = 300;
    const popH = Math.min(480, window.innerHeight - 32);
    let left = rect.right + 8;
    if (left + popW > window.innerWidth - 8) left = rect.left - popW - 8;
    if (left < 8) left = 8;
    let top = rect.top;
    if (top + popH > window.innerHeight - 12) top = window.innerHeight - popH - 12;
    if (top < 12) top = 12;
    pop.style.left = `${left}px`;
    pop.style.top  = `${top}px`;
}

// ── Load ──────────────────────────────────────────────────────────────────────

function posColorDA(pos) {
    return {QB:"#e74c82",RB:"#3ecf8e",WR:"#4299e1",TE:"#f6ad55",K:"#9f7aea",DEF:"#38b2ac"}[pos] || "#5a6070";
}

async function renderDraftAnalysis(picks, year) {
    const el = document.getElementById("draft-analysis");
    if (!el) return;
    el.innerHTML = `<div style="color:#5a6070;font-size:13px;">Loading analysis…</div>`;

    const SITE_YEARS = ((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort();
    const LATEST_YEAR = parseInt(SITE_YEARS[SITE_YEARS.length - 1] || year);
    const isStartup = true;  // redraft league: every draft is a full draft
    const revisitYear = parseInt(year) + 2;
    const canRevisit = revisitYear <= LATEST_YEAR;
    const totalTeams = Math.max(1, ...(picks || []).map(p => p.draft_slot || 0)) || 12;

    // Get current rosters for retention check + positional depth
    let rosters = [];
    try { rosters = await api.getRosters(String(LATEST_YEAR)); } catch {}
    const rosterByOwner = {};
    const rosterDepth = {}; // team → {QB:n, RB:n, WR:n, TE:n}
    (rosters||[]).forEach(r => {
        const owner = r.owner || "";
        rosterByOwner[owner] = new Set((r.players||[]).map(p => p.name));
        const depth = {QB:0, RB:0, WR:0, TE:0};
        (r.players||[]).forEach(p => {
            const pos = (p.position||"").split("/")[0];
            if (depth[pos] !== undefined) depth[pos]++;
        });
        rosterDepth[owner] = depth;
    });

    // Build traded-away names per team from transactions
    const tradedAwayByTeam = {};
    (allTransactions||[]).forEach(tx => {
        if (tx.type !== "trade") return;
        Object.entries(tx.assets_received || {}).forEach(([rcv, assets]) => {
            (tx.teams||[]).forEach(t => {
                if (t !== rcv) {
                    if (!tradedAwayByTeam[t]) tradedAwayByTeam[t] = new Set();
                    (assets||[]).forEach(a => { if (a.name) tradedAwayByTeam[t].add(a.name); });
                }
            });
        });
    });

    function playerStatus(name, owner) {
        if ((rosterByOwner[owner]||new Set()).has(name)) return "roster";
        if ((tradedAwayByTeam[owner]||new Set()).has(name)) return "traded";
        return "dropped";
    }

    // Group picks by team, preserving draft order
    const teamOrder = [];
    const byTeam = {};
    picks.forEach(p => {
        if (!byTeam[p.picked_by]) { byTeam[p.picked_by] = []; teamOrder.push(p.picked_by); }
        byTeam[p.picked_by].push(p);
    });
    const teams = [...new Set(teamOrder)];

    function startupTier(round) {
        if (round <= 3)  return {label:"Franchise Core", color:"#f6ad55"};
        if (round <= 8)  return {label:"Starter",        color:"#3ecf8e"};
        if (round <= 15) return {label:"Depth",           color:"#4299e1"};
        return                  {label:"Late Flier",      color:"#5a6070"};
    }
    function rookieTier(round, pickInRound) {
        if (round === 1 && pickInRound <= 4)  return {label:"Top Pick",   color:"#f6ad55"};
        if (round === 1 && pickInRound <= 8)  return {label:"Mid 1st",    color:"#a78bfa"};
        if (round === 1)                      return {label:"Late 1st",   color:"#4299e1"};
        if (round === 2)                      return {label:"2nd Round",  color:"#3ecf8e"};
        return                                       {label:"3rd Round",  color:"#8b9099"};
    }

    const cards = teams.map(team => {
        const teamPicks = byTeam[team] || [];
        const onRoster  = teamPicks.filter(p => playerStatus(p.player, team) === "roster").length;
        const traded    = teamPicks.filter(p => playerStatus(p.player, team) === "traded").length;
        const dropped   = teamPicks.filter(p => playerStatus(p.player, team) === "dropped").length;
        const hitRate   = teamPicks.length ? Math.round(onRoster / teamPicks.length * 100) : 0;

        // Score: 60% retention, 40% avg pick position value
        let pickVal = 0;
        teamPicks.forEach(p => {
            const pir = ((p.pick_no - 1) % totalTeams) + 1;
            pickVal += 1 - (pir - 1) / totalTeams;
        });
        pickVal = teamPicks.length ? pickVal / teamPicks.length : 0;
        const retPct = teamPicks.length ? onRoster / teamPicks.length : 0;
        const score = Math.round((retPct * 0.6 + pickVal * 0.4) * 100) / 10;
        const scoreColor = score >= 7 ? "#3ecf8e" : score >= 5 ? "#f6ad55" : "#e74c82";

        // Grade
        const gradePct = teamPicks.length ? onRoster / teamPicks.length : 0;
        const grade = gradePct >= 0.75 ? {g:"A",c:"#3ecf8e"} : gradePct >= 0.5 ? {g:"B",c:"#a78bfa"} : gradePct >= 0.25 ? {g:"C",c:"#f6ad55"} : {g:"D",c:"#e74c82"};

        // Contextual recap analysis
        const recapText = (() => {
            if (!teamPicks.length) return "Did not make any picks in this draft.";
            const depth = rosterDepth[team] || {QB:0,RB:0,WR:0,TE:0};
            const posCounts = {};
            teamPicks.forEach(p => { const base = (p.position||"").split("/")[0]; posCounts[base] = (posCounts[base]||0)+1; });
            const parts = [];

            const pickDesc = (p) => {
                const pir = ((p.pick_no-1)%totalTeams)+1;
                return `${p.round}.${String(pir).padStart(2,"0")}`;
            };
            const profile = (name) => PLAYER_PROFILES[name] || null;
            const st = (p) => playerStatus(p.player, team);
            const statusNote = (p) => {
                const s = st(p);
                if (s === "traded") return " (since traded away)";
                if (s === "dropped") return " (since released)";
                return "";
            };

            if (isStartup) {
                const r1 = teamPicks.filter(p => p.round === 1).sort((a,b) => a.pick_no - b.pick_no);
                const r2 = teamPicks.filter(p => p.round === 2).sort((a,b) => a.pick_no - b.pick_no);
                const topPick = r1[0];

                if (topPick) {
                    const pr = profile(topPick.player);
                    const pir = ((topPick.pick_no-1)%totalTeams)+1;
                    const slotNote = pir <= 3 ? "top-3 overall" : pir <= 6 ? "top half of round 1" : "late first round";
                    if (pr) {
                        parts.push(`Anchored the draft with <strong>${topPick.player}</strong> (${pr.college}) at ${pickDesc(topPick)} — ${pr.profile}${statusNote(topPick)}`);
                    } else {
                        parts.push(`Opened with a ${slotNote} pick in <strong>${topPick.player}</strong> (${topPick.position})${statusNote(topPick)}.`);
                    }
                }

                // Highlight notable early picks beyond r1[0]
                const notableEarly = [...r1.slice(1), ...r2.slice(0,1)].filter(p => profile(p.player));
                notableEarly.slice(0,2).forEach(p => {
                    const pr = profile(p.player);
                    parts.push(`Also added <strong>${p.player}</strong> (${pr.college}) at ${pickDesc(p)} — ${pr.profile.split(".")[0]}.${statusNote(p)}`);
                });

                const dominant = Object.entries(posCounts).sort((a,b)=>b[1]-a[1])[0];
                if (dominant && dominant[1] >= 4) parts.push(`Heavily invested in ${dominant[0]} with ${dominant[1]} selections — a clear positional identity.`);
                else if (Object.keys(posCounts).length >= 4) parts.push(`Spread picks broadly across positions, building balanced depth from the ground up.`);

            } else {
                // Rookie draft — walk through each pick with full context
                const sortedPicks = [...teamPicks].sort((a,b) => a.pick_no - b.pick_no);
                const r1picks = sortedPicks.filter(p => p.round === 1);
                const r2picks = sortedPicks.filter(p => p.round === 2);
                const r3picks = sortedPicks.filter(p => p.round === 3);

                if (!r1picks.length) {
                    parts.push(`Entered without a first-round pick, having dealt it away for veteran talent or future capital.`);
                }

                sortedPicks.forEach(p => {
                    const pr = profile(p.player);
                    const pir = ((p.pick_no-1)%totalTeams)+1;
                    const pos = (p.position||"").split("/")[0];
                    const needThresholds = {QB:2, RB:5, WR:6, TE:2};
                    const isNeed = (depth[pos]||0) <= (needThresholds[pos]||3);
                    const slotLabel = p.round === 1
                        ? (pir <= 4 ? "top-4 pick" : pir <= 8 ? "mid-first" : "late first-rounder")
                        : p.round === 2 ? `2nd-round pick` : `3rd-round pick`;

                    if (pr) {
                        parts.push(`With their ${slotLabel} (${pickDesc(p)}), they selected <strong>${p.player}</strong> out of ${pr.college}${statusNote(p)} — ${pr.profile}`);
                    } else {
                        const needContext = isNeed ? `, addressing a thin ${pos} room` : ``;
                        parts.push(`Took <strong>${p.player}</strong> (${pos}) with their ${slotLabel}${needContext}${statusNote(p)}.`);
                    }
                });
            }

            // Retention summary
            if (onRoster === teamPicks.length && teamPicks.length >= 2) {
                parts.push(`<em>Every pick from this class is still on the roster — a clean hit rate.</em>`);
            } else if (traded >= 2 && onRoster === 0) {
                parts.push(`<em>Flipped the entire class for future capital — treating this draft as a trade-up fund rather than a development class.</em>`);
            } else if (traded >= 1 && dropped === 0 && onRoster > 0) {
                parts.push(`<em>${onRoster} of ${teamPicks.length} picks remain; ${traded} were traded away.</em>`);
            } else if (dropped >= 2) {
                parts.push(`<em>Several picks didn't stick — a tough class in hindsight with ${dropped} released and ${onRoster} still on the roster.</em>`);
            }

            return parts.join(" ") || `Selected ${teamPicks.length} player${teamPicks.length!==1?"s":""} in this draft.`;
        })();

        // Pick rows (compact)
        const byRound = {};
        teamPicks.forEach(p => { if (!byRound[p.round]) byRound[p.round] = []; byRound[p.round].push(p); });
        const pickRows = Object.keys(byRound).sort((a,b)=>+a-+b).map(rd => {
            const rPicks = byRound[rd];
            const tier = isStartup ? startupTier(+rd) : rookieTier(+rd, ((rPicks[0].pick_no-1)%totalTeams)+1);
            const header = `<div style="display:flex;align-items:center;gap:6px;margin:10px 0 4px;">
                <span style="font-size:10px;font-weight:700;color:#5a6070;text-transform:uppercase;">R${rd}</span>
                <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:${tier.color}22;color:${tier.color};">${tier.label}</span>
            </div>`;
            const rows = rPicks.map(p => {
                const pir = ((p.pick_no-1)%totalTeams)+1;
                const st = playerStatus(p.player, team);
                const badge = st==="roster"
                    ? `<span style="font-size:10px;font-weight:700;color:#3ecf8e;background:#3ecf8e18;padding:1px 6px;border-radius:4px;">On Roster</span>`
                    : st==="traded"
                    ? `<span style="font-size:10px;font-weight:700;color:#4299e1;background:#4299e118;padding:1px 6px;border-radius:4px;">Traded</span>`
                    : `<span style="font-size:10px;font-weight:700;color:#5a6070;background:#2d3139;padding:1px 6px;border-radius:4px;">Released</span>`;
                return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:#1e2027;border-radius:7px;margin-bottom:2px;">
                    <span style="background:${posColorDA(p.position)};color:#fff;font-size:9px;font-weight:800;padding:1px 0;border-radius:3px;width:26px;text-align:center;flex-shrink:0;">${p.position||"?"}</span>
                    <span style="font-size:12px;font-weight:600;color:#f0f1f3;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.player}</span>
                    <span style="font-size:10px;color:#5a6070;flex-shrink:0;">${rd}.${String(pir).padStart(2,"0")}</span>
                    ${badge}
                </div>`;
            }).join("");
            return header + rows;
        }).join("");

        const revisitedHtml = canRevisit ? `
            <div style="border-top:1px solid #2d3139;margin-top:14px;padding-top:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">Revisited · ${revisitYear}</span>
                    <span style="font-size:22px;font-weight:900;color:${grade.c};">${grade.g}</span>
                </div>
                <div style="display:flex;gap:16px;margin-bottom:10px;">
                    <div><div style="font-size:16px;font-weight:800;color:#3ecf8e;">${onRoster}</div><div style="font-size:9px;color:#5a6070;text-transform:uppercase;margin-top:1px;">Roster</div></div>
                    <div><div style="font-size:16px;font-weight:800;color:#4299e1;">${traded}</div><div style="font-size:9px;color:#5a6070;text-transform:uppercase;margin-top:1px;">Traded</div></div>
                    <div><div style="font-size:16px;font-weight:800;color:#5a6070;">${dropped}</div><div style="font-size:9px;color:#5a6070;text-transform:uppercase;margin-top:1px;">Released</div></div>
                    <div><div style="font-size:16px;font-weight:800;color:#f0f1f3;">${hitRate}%</div><div style="font-size:9px;color:#5a6070;text-transform:uppercase;margin-top:1px;">Kept</div></div>
                </div>
            </div>` : "";

        const recapCard = `
            <div style="background:#252830;border:1px solid #2d3139;border-radius:10px;padding:14px;margin-bottom:12px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                    <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">Draft Recap</span>
                    <div style="display:flex;align-items:baseline;gap:3px;">
                        <span style="font-size:22px;font-weight:900;color:${scoreColor};">${score}</span>
                        <span style="font-size:11px;color:#5a6070;font-weight:600;">/10</span>
                    </div>
                </div>
                <div style="font-size:12px;color:#c9cdd4;line-height:1.6;">${recapText}</div>
            </div>`;

        const avatar = avatarEl(team, 28);
        return `
        <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:16px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #2d3139;">
                ${avatar}
                <a href="team.html?team=${encodeURIComponent(team)}" style="font-size:14px;font-weight:700;color:#f0f1f3;text-decoration:none;" onmouseover="this.style.color='#818cf8'" onmouseout="this.style.color='#f0f1f3'">${team}</a>
            </div>
            ${isStartup ? recapCard + pickRows + revisitedHtml : pickRows + recapCard + revisitedHtml}
        </div>`;
    });

    el.innerHTML = `
        <div style="font-size:16px;font-weight:700;color:#f0f1f3;margin-bottom:16px;">${year} Draft Analysis</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
            ${cards.join("")}
        </div>`;
}

async function load(year) {
    document.getElementById("draft-container").innerHTML = `<div class="card" style="color:var(--text-3);">Loading ${year} draft...</div>`;
    document.getElementById("position-stats").innerHTML = "";
    try {
        const picks = await api.getDraft(year);
        (picks||[]).forEach(p => { p.season = year; });

        // Load player stats for this year if available
        if (((window.__STATIC_DATA__ && window.__STATIC_DATA__.years) || []).slice().sort().includes(year)) {
            const [stats, nameMap] = await Promise.all([
                api.getPlayerStats(year).catch(()=>({})),
                api.getPlayerNameMap().catch(()=>({})),
            ]);
            playerStats   = stats || {};
            playerNameMap = nameMap || {};
        } else {
            playerStats   = {};
            playerNameMap = {};
        }

        renderPositions(picks, year);
        renderDraft(picks);
        renderDraftAnalysis(picks, year);
    } catch(err) {
        console.error("Draft load error:", err);
        document.getElementById("draft-container").innerHTML = `<div class="card">Failed to load draft data for ${year}.</div>`;
    }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    renderNav();
    ensurePickPopover();

    try { allTransactions = await api.getTransactions() || []; } catch { allTransactions = []; }
    try { leagueUsers     = await api.getLeagueUsers()  || []; } catch { leagueUsers = []; }

    const select = document.getElementById("yearSelect");
    const validYears = new Set(Array.from(select.options).map(o => o.value));
    const hashYear = location.hash.replace("#", "");
    if (validYears.has(hashYear)) select.value = hashYear;

    load(select.value);
    select.addEventListener("change", () => {
        location.hash = select.value;
        load(select.value);
    });

    window.addEventListener("hashchange", () => {
        const y = location.hash.replace("#", "");
        if (validYears.has(y) && y !== select.value) {
            select.value = y;
            load(y);
        }
    });
});
