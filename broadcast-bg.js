/* ═══ LOGO MARQUEE ═══════════════════════════════════════════
   All 32 NFL team logos cycling across the header band, on the title's
   centre line.

   Continuity across tabs: every page reads the same start time from
   sessionStorage and offsets its animation by the time elapsed, so the
   strip carries on scrolling from where the last tab left it instead of
   restarting. Combined with the page crossfade (broadcast-theme.css) the
   header reads as one continuous broadcast element between tabs.
   ═════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var TEAMS = ['ari','atl','bal','buf','car','chi','cin','cle','dal','den','det','gb',
               'hou','ind','jax','kc','lac','lar','lv','mia','min','ne','no','nyg',
               'nyj','phi','pit','sea','sf','tb','ten','was'];
  var LOOP_MS = 64000;          /* must match the lg-roll duration in the CSS */

  function epoch() {
    var t0;
    try { t0 = +sessionStorage.getItem('gop-lg-t0'); } catch (e) {}
    if (!t0) {
      t0 = Date.now();
      try { sessionStorage.setItem('gop-lg-t0', String(t0)); } catch (e) {}
    }
    return t0;
  }

  /* Re-sync on activation: a prerendered page's clock was paused while it
     waited, and a page restored from the back/forward cache is stale. */
  function sync(track) {
    var phase = (Date.now() - epoch()) % LOOP_MS;
    track.style.animationDelay = (-phase / 1000) + 's';
  }

  function build() {
    var host = document.querySelector('.stage-in');
    if (!host) return false;
    if (host.querySelector('.logos')) return true;

    var run = TEAMS.map(function (t) {
      return '<span class="lg"><img src="https://sleepercdn.com/images/team_logos/nfl/' +
             t + '.png" alt="" decoding="async"' +
             ' onerror="this.parentNode.style.display=\'none\'"></span>';
    }).join('');

    var strip = document.createElement('div');
    strip.className = 'logos';
    strip.setAttribute('aria-hidden', 'true');
    strip.innerHTML = '<div class="lg-track">' + run + run + '</div>';   /* doubled: no seam */
    host.appendChild(strip);

    var track = strip.firstChild;
    sync(track);
    document.addEventListener('prerenderingchange', function () { sync(track); });
    addEventListener('pageshow', function (e) { if (e.persisted) sync(track); });

    /* the strip is masked out behind the title, measured not guessed */
    var setW = function () {
      var t = host.querySelector('.stage-t');
      /* the title's right edge in the strip's own coordinates — its width
         alone misses the band's left padding and lets logos creep under it */
      if (t) host.style.setProperty('--title-w',
        Math.ceil(t.getBoundingClientRect().right - host.getBoundingClientRect().left) + 'px');
    };
    setW();
    addEventListener('resize', setW, {passive: true});
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(setW);
    return true;
  }

  if (!build()) {
    var n = 0, iv = setInterval(function () { if (build() || ++n > 50) clearInterval(iv); }, 100);
  }
})();
