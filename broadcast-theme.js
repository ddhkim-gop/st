/* ═══ BROADCAST THEME — site-wide ════════════════════════════
   The pages render their own CSS at runtime: 13 JS files inject
   <style> blocks carrying ~800 HARDCODED hex values (#1e2027,
   #5a6070, #3ecf8e …). A stylesheet cannot reach those — an
   injected block always lands later in the cascade, and there is
   no variable to override.

   So this intercepts instead. Every <style> that arrives, now or
   later, gets its palette remapped to the broadcast colours before
   it paints. One map, one place, no page JS edited.
   ═════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* Sleeper-dark -> Sunday-night, SURFACES ONLY. Keys must be lowercase.
     Only the dark greys (backgrounds, borders, text) and the indigo accent
     are re-toned. Every colour that carries meaning in the Sleeper UI —
     position colours (QB/RB/WR/TE/K/DEF), the draft-board pick pastels,
     gains/losses green and red, link blue, gold highlights — is left exactly
     as Sleeper ships it. An earlier version muted those too, which is what
     made the draft board look dead. */
  var MAP = {
    '#13151a':'#07080a', '#1e2027':'#13161b', '#252830':'#1a1e24',
    '#2d3139':'#23272e', '#3d4350':'#2a2f37',
    '#f0f1f3':'#d9dee4', '#c9cdd4':'#b4bbc3', '#8b9099':'#8a9098', '#5a6070':'#5f666e',
    '#5a5be6':'#c9a961'                                       /* accent -> brass */
  };

  var RE = new RegExp(Object.keys(MAP).join('|'), 'gi');
  var swap = function (css) {
    return css.replace(RE, function (m) { return MAP[m.toLowerCase()] || m; });
  };

  /* rewrite a <style> once, and remember we did */
  function paint(node) {
    if (node.nodeName !== 'STYLE' || node.dataset.bcast) return;
    node.dataset.bcast = '1';
    var t = node.textContent;
    if (t && RE.test(t)) { RE.lastIndex = 0; node.textContent = swap(t); }
    RE.lastIndex = 0;
  }

  document.querySelectorAll('style').forEach(paint);
  new MutationObserver(function (recs) {
    recs.forEach(function (r) { r.addedNodes.forEach(paint); });
  }).observe(document.documentElement, {childList:true, subtree:true});

  /* inline style="" attributes carry the same hexes (home.js builds
     whole tables that way), so sweep the DOM as it fills too */
  function paintInline(el) {
    if (!el.getAttribute) return;
    var v = el.getAttribute('style');
    if (!v) return;
    RE.lastIndex = 0;
    if (RE.test(v)) { RE.lastIndex = 0; el.setAttribute('style', swap(v)); }
    RE.lastIndex = 0;
  }
  function sweep(root) {
    if (root.nodeType !== 1) return;
    paintInline(root);
    root.querySelectorAll && root.querySelectorAll('[style]').forEach(paintInline);
  }
  sweep(document.documentElement);
  new MutationObserver(function (recs) {
    recs.forEach(function (r) {
      r.addedNodes.forEach(sweep);
      if (r.type === 'attributes') paintInline(r.target);
    });
  }).observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['style']});

  /* ── the nav rail, one definition for every page ── */
  var PAGES = [
    ['index.html','Home'], ['standings.html','Standings'], ['teams.html','Teams'],
    ['draft.html','Draft'], ['matchups.html','Matchups'], ['transactions.html','Transactions'],
    ['head_to_head.html','H2H'], ['season_history.html','History']
  ];
  function rail() {
    if (document.querySelector('.rail')) return;
    var here = location.pathname.split('/').pop() || 'index.html';
    /* Themed pages live under the b- prefix so the originals stay untouched.
       Keep navigation inside whichever set you are already in, or a click
       drops you back into the old theme mid-session. */
    var themed = here.indexOf('b-') === 0 || here === 'broadcast.html';
    var link = function (f) {
      if (!themed) return f;
      return f === 'index.html' ? 'broadcast.html' : 'b-' + f;
    };
    var d = document.createElement('div');
    d.className = 'rail';
    d.innerHTML = '<div class="rail-in"><span class="badge">GoP</span><nav aria-label="League sections">' +
      PAGES.map(function (p) {
        var href = link(p[0]);
        return '<a href="' + href + '"' + (href === here ? ' class="here" aria-current="page"' : '') + '>' + p[1] + '</a>';
      }).join('') + '</nav></div>';
    document.body.insertBefore(d, document.body.firstChild);
    /* the pages ship their own nav container; it is now redundant */
    var old = document.getElementById('nav');
    if (old) old.remove();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rail);
  else rail();

  /* ── Keep navigation inside the themed set ─────────────────────
     Page scripts link to the ORIGINAL pages: href="team.html",
     location.href = 'team.html?…'. On a themed page those would drop you
     back into the old design. Two layers:
       1. rewrite <a href> in the DOM as it renders, so hover-prerender and
          middle-click both get the themed URL;
       2. catch script-driven navigations (location.href = …) with the
          Navigation API and redirect them. */
  /* The build writes every themed page's name into <meta name="gop-pages">,
     so each league's own page set is used (Darwinism has player, podcast
     and rules; the others don't). The list below is only a fallback. */
  var metaPages = document.querySelector('meta[name="gop-pages"]');
  var PAGES_ALL = metaPages ? metaPages.content.split(',')
    : ['index','standings','teams','draft','matchups','transactions',
       'head_to_head','season_history','team','matchup_recap',
       'report_card','trade_analyzer','assets'];
  var here0 = location.pathname.split('/').pop() || 'index.html';
  var onThemed = here0.indexOf('b-') === 0 || here0 === 'broadcast.html';

  function themedHref(raw) {
    try {
      var u = new URL(raw, location.href);
      if (u.origin !== location.origin) return null;
      var dir = location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1);
      if (u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1) !== dir) return null;
      var name = u.pathname.split('/').pop().replace(/\.html$/, '');
      if (PAGES_ALL.indexOf(name) < 0) return null;
      u.pathname = dir + (name === 'index' ? 'broadcast.html' : 'b-' + name + '.html');
      return u.href;
    } catch (e) { return null; }
  }

  if (onThemed) {
    var fix = function (root) {
      if (!root.querySelectorAll) return;
      var as = root.matches && root.matches('a[href]') ? [root] : [];
      as = as.concat([].slice.call(root.querySelectorAll('a[href]')));
      as.forEach(function (a) {
        var t = themedHref(a.getAttribute('href'));
        if (t) a.setAttribute('href', t);
      });
    };
    var start = function () {
      fix(document);
      new MutationObserver(function (rs) {
        rs.forEach(function (r) {
          if (r.type === 'attributes') fix(r.target);
          else r.addedNodes.forEach(function (n) { if (n.nodeType === 1) fix(n); });
        });
      }).observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['href']});
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    if (window.navigation) {
      navigation.addEventListener('navigate', function (e) {
        if (!e.cancelable || e.hashChange || e.downloadRequest !== null) return;
        var t = themedHref(e.destination.url);
        if (t && t !== e.destination.url) { e.preventDefault(); location.assign(t); }
      });
    }
  }
})();
