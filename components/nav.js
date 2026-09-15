export function renderNav() {
    const el = document.getElementById("nav");
    if (!el) return;

    const page = location.pathname.split("/").pop() || "index.html";
    const teamsActive = page === "teams.html";
    const txActive = page === "transactions.html";
    const standingsActive = ["standings.html", "report_card.html"].includes(page);

    function cur(p) { return page === p ? ' class="current"' : ""; }

    el.innerHTML = `
        <style>
            .nav-card {
                display: flex;
                align-items: center;
                padding: 6px 12px;
                position: relative;
                overflow: visible !important;
            }
            .nav-links {
                display: flex;
                align-items: center;
                gap: 2px;
                flex-wrap: nowrap;
            }
            .nav-links a {
                padding: 7px 11px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                color: var(--text-3, #8b9099);
                white-space: nowrap;
                transition: color 0.15s, background 0.15s;
                text-decoration: none;
                display: inline-block;
                line-height: 1.4;
            }
            .nav-links a:hover, .nav-links a.current {
                color: var(--text-1, #f0f1f3);
                background: var(--card-el, #252830);
            }
            .nav-links a.current { font-weight: 700; }

            /* Mobile: horizontal scrollable tab strip */
            @media (max-width: 680px) {
                .nav-card {
                    padding: 0;
                    overflow-x: auto !important;
                    overflow-y: visible;
                    -webkit-overflow-scrolling: touch;
                    scrollbar-width: none;
                }
                .nav-card::-webkit-scrollbar { display: none; }
                .nav-links {
                    gap: 0;
                    padding: 4px 8px;
                    flex-wrap: nowrap;
                    min-width: max-content;
                }
                .nav-links a {
                    font-size: 13px;
                    padding: 7px 10px;
                }
                /* The strip scrolls but its scrollbar is hidden, so nothing said
                   so. Fade the right edge while there is more to reach. */
                .nav-card.nav-more {
                    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);
                    mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);
                }
            }
        </style>
        <nav class="card nav-card" id="nav-card">
            <div class="nav-links" id="nav-links">
                <a href="index.html"${cur("index.html")}>Home</a>
                <a href="draft.html"${cur("draft.html")}>Draft</a>
                <a href="standings.html"${standingsActive ? ' class="current"' : ""}>Standings</a>
                <a href="teams.html"${teamsActive ? ' class="current"' : ""}>Teams</a>
                <a href="transactions.html"${txActive ? ' class="current"' : ""}>Transactions</a>
                <a href="matchups.html"${cur("matchups.html")}>Matchups</a>
                <a href="head_to_head.html"${cur("head_to_head.html")}>H2H</a>
                <a href="season_history.html"${cur("season_history.html")}>History</a>
            </div>
        </nav>
    `;

    // Show the fade only while the strip has somewhere left to scroll.
    const card = el.querySelector("#nav-card");
    if (card) {
        const update = () => card.classList.toggle(
            "nav-more", card.scrollWidth - card.clientWidth - card.scrollLeft > 4);
        card.addEventListener("scroll", update, { passive: true });
        window.addEventListener("resize", update);
        // Called straight after innerHTML the strip has not been laid out yet, so
        // scrollWidth still equals clientWidth and the fade never appears.
        requestAnimationFrame(update);
        window.addEventListener("load", update);
    }

}
