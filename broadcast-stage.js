/* ═══ BROADCAST STAGE — the graphics package, on every page ═══
   broadcast-theme.js repaints colour. That is not a design. This
   gives the other seven pages the same STRUCTURE as the home page:
   a cold-open hero over the field, lower-third section headers that
   wipe in, staggered entrances, and counted-up numbers.
   Loads after broadcast-theme.js. Touches no page script.        */
(function () {
  'use strict';
  var RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var D  = window.__STATIC_DATA__ || {};
  var SH = D.season_history || {};
  var played = Object.keys(SH).filter(function (y) {
    return (SH[y].standings || []).some(function (r) { return r.wins + r.losses > 0; });
  }).sort();


  var KICK = {
    'index'         : ['Dynasty league · est. 2023', 'Game of Phones'],
    'broadcast'     : ['Dynasty league · est. 2023', 'Game of Phones'],
    'standings'     : ['Regular season · all-time', 'Standings'],
    'teams'         : ['Active rosters', 'Teams'],
    'draft'         : ['Every pick, every year', 'The Draft'],
    'matchups'      : ['Week by week', 'Matchups'],
    'transactions'  : ['Trades, waivers, free agency', 'Transactions'],
    'head_to_head'  : ['All-time series', 'Head to Head'],
    'season_history': ['The record', 'Season History']
  };

  /* The stage title owns the page name. Page scripts sometimes render their
     own heading later; drop exact duplicates, dress the rest as lower-thirds.
     Runs from dress(), so late-rendered headings are caught too. */
  function dedupeTitles() {
    var t = document.querySelector('.stage-t');
    if (!t) return;
    var name = t.textContent.trim().toLowerCase().replace(/\s+/g, ' ');
    document.querySelectorAll('h1:not(.dressed)').forEach(function (h) {
      if (h.closest('.stage')) return;
      if (h.textContent.trim().toLowerCase().replace(/\s+/g, ' ') === name) h.remove();
      else h.classList.add('dressed', 'lt3');
    });
  }

  /* Fallback only: pages built by scripts/build_broadcast.py already ship the
     stage in their HTML, so there is nothing to insert and no layout jump. */
  function build() {
    if (document.querySelector('.stage')) return;
    var file = (location.pathname.split('/').pop() || '').replace(/^b-/, '').replace('.html', '');
    var meta = KICK[file];
    if (!meta) return;
    var head = document.createElement('header');
    head.className = 'stage';
    head.innerHTML =
      '<div class="field"><div class="turf"></div><div class="far"><div class="turf"></div></div></div>' +
      '<div class="stage-in"><h1 class="stage-t"><span><i>' + meta[1] + '</i></span></h1></div>';
    var rail = document.querySelector('.rail');
    (rail && rail.nextSibling) ? document.body.insertBefore(head, rail.nextSibling)
                               : document.body.insertBefore(head, document.body.firstChild);
  }

  var MAX_RV = 80, MAX_STAGGER = 120, watched = 0, staggered = 0;

  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    });
  }, { threshold: .08, rootMargin: '0px 0px -6%' });

  function dress() {
    dedupeTitles();
    /* The pages almost never use <h2>. Their section headings are divs with
       page-specific classes (s-label, sh-section-title, tx-card-header …),
       which is why an h2 selector dressed nothing. */
    var HEADS = 'h2, h3, .s-label, .sh-section-title, .sh-year-title, .sh-year-header,' +
                '.tx-card-header, .tx-week-label, .team-header-wrap, .draft-round > h3';
    document.querySelectorAll(HEADS).forEach(function (h) {
      if (h.classList.contains('dressed')) return;
      if (h.closest('.stage') || h.closest('.rail') || h.closest('#player-popover')) return;
      if (!h.textContent.trim()) return;
      h.classList.add('dressed', 'lt3');
    });
    document.querySelectorAll('.draft-board:not([data-rv]), .banners:not([data-rv])')
      .forEach(function (el) { el.setAttribute('data-rv',''); el.classList.add('rv'); io.observe(el); });
    /* Transactions builds 42,541 nodes; observing all of them registered 1,751
       IntersectionObserver targets and re-ran on every render batch, which is
       what made its header stutter while other pages eased in. Past the cap,
       elements are shown immediately rather than animated — nothing is ever
       left invisible. */
    document.querySelectorAll(
      '.lt3:not([data-rv]), .card:not([data-rv]), .s-table-wrap:not([data-rv]), ' +
      'table:not([data-rv]), .draft-round:not([data-rv]), .matrix-wrap:not([data-rv])'
    ).forEach(function (el) {
      el.setAttribute('data-rv', '');
      if (watched < MAX_RV) { watched++; el.classList.add('rv'); io.observe(el); }
      else { el.classList.add('rv', 'in'); }
    });
    document.querySelectorAll('table:not([data-rows])').forEach(function (t) {
      t.setAttribute('data-rows', '');
      if (staggered >= MAX_STAGGER) return;
      var rows = t.querySelectorAll('tbody tr');
      for (var i = 0; i < rows.length && i < 40; i++) {
        rows[i].style.setProperty('--d', Math.min(i * 28, 620) + 'ms');
        rows[i].classList.add('rv-row');
        staggered++;
      }
    });
  }

  /* ── App shell: the window is the frame, so the page never scrolls ──
     Rail and stage keep their natural height; everything the page rendered
     goes into one flex-1 region that scrolls inside itself. Type is sized in
     viewport units (see .css) so shrinking the window shrinks the layout
     instead of pushing content off the bottom. */
  function shell() {
    if (document.querySelector('.deck')) return;
    var move = [];
    [].forEach.call(document.body.children, function (el) {
      if (el.classList.contains('rail') || el.classList.contains('stage')) return;
      if (el.id === 'player-popover' || el.tagName === 'SCRIPT') return;
      move.push(el);
    });
    if (!move.length) return;
    var deck = document.createElement('main');
    deck.className = 'deck';
    move[0].parentNode.insertBefore(deck, move[0]);
    move.forEach(function (el) { deck.appendChild(el); });
    document.documentElement.classList.add('fitted');
  }


  /* Stop watching once the page settles: without this the observer kept
     re-running dress() for the whole life of a slow-rendering page. */
  var quiet = 0;
  var mo = new MutationObserver(function () {
    clearTimeout(mo._t);
    mo._t = setTimeout(function () {
      var before = document.querySelectorAll('[data-rv]').length;
      dress(); shell();
      quiet = (document.querySelectorAll('[data-rv]').length === before) ? quiet + 1 : 0;
      if (quiet >= 3) mo.disconnect();
    }, 160);
  });
  setTimeout(function () { mo.disconnect(); }, 12000);   /* hard stop */
  function start(){
    build(); shell(); dress();
    mo.observe(document.body, {childList:true, subtree:true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
