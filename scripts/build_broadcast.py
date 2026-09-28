#!/usr/bin/env python3
"""Build the broadcast-themed copy of the site from the original pages.

Each original page (index.html, standings.html, ...) is left untouched. For
every one, this writes a themed sibling (index -> broadcast.html, everything
else -> b-<name>.html) with the theme's structure already in the HTML:

  * the nav rail, with the right tab marked active
  * the header band (stage) carrying the page title
  * a .deck wrapper around the page content
  * html.fitted, font preconnect/links, the theme CSS and scripts
  * speculation rules, so hovering a tab prerenders it

Why build rather than inject: the theme used to add all of that with
JavaScript after the first paint, so every tab painted once in the old layout
and then jumped 4-5 times as the rail, header and wrapper arrived and the old
title was removed. Written into the HTML, the first paint is the final one,
and the page crossfade in broadcast-theme.css has nothing left to fight.

Generic across the league sites (gameofphones, darwinism, indigo): the league
name comes from index.html's <title>, the page list from the *.html files, and
the rail's tabs and order from components/nav.js, so each site's themed menu
matches its own original one.

Run from the repo root after changing any original page:

    python3 scripts/build_broadcast.py
"""
from __future__ import annotations

import html
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Sub-pages reached from inside a tab light up that tab. nav.js does the same
# for standings/report_card; the rest follow where they are linked from.
PARENT = {"team": "teams", "assets": "teams", "player": "teams",
          "matchup_recap": "matchups", "trade_analyzer": "transactions",
          "report_card": "standings"}


def _read(name: str) -> str:
    return open(os.path.join(ROOT, name), encoding="utf-8").read()


def league_name() -> str:
    m = re.search(r"<title>([^<]+)</title>", _read("index.html"))
    return m.group(1).strip() if m else "League"


def badge(name: str) -> str:
    """Game of Phones -> GoP, Indigo League -> IL, ST League -> ST, Darwinism -> Darwinism."""
    words = name.split()
    if len(words) == 1:
        return name
    if len(words[0]) > 1 and words[0].isupper():      # ST League -> ST
        return words[0]
    small = {"of", "the", "and", "a"}
    return "".join(w[0].lower() if w.lower() in small else w[0].upper() for w in words)


def rail_tabs() -> list:
    """(page, label) in the order the league's own nav.js renders them."""
    src = _read(os.path.join("components", "nav.js"))
    tabs = re.findall(r'<a href="([a-z_]+)\.html"[^>]*>([^<]+)</a>', src)
    if not tabs:
        raise SystemExit("components/nav.js: no nav links found")
    return [(page, label.strip()) for page, label in tabs]


def discover() -> dict:
    """page -> (header title or None for redirect pages, rail tab to light)."""
    tabs = {p for p, _ in rail_tabs()}
    name = league_name()
    pages = {}
    for f in sorted(os.listdir(ROOT)):
        if not f.endswith(".html") or f.startswith("b-") or f == "broadcast.html":
            continue
        page = f[:-5]
        src = _read(f)
        if 'http-equiv="refresh"' in src:
            pages[page] = (None, PARENT.get(page, page))
            continue
        if page == "index":
            title = name
        else:
            h1 = re.search(r"<h1[^>]*>([^<]+)</h1>", src)
            t = re.search(r"<title>([^<]+)</title>", src)
            title = (h1 or t).group(1).strip() if (h1 or t) else page.replace("_", " ").title()
        active = page if page in tabs else PARENT.get(page, "")
        pages[page] = (title, active)
    return pages


FONTS = ("https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900"
         "&family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap")


def out_name(page: str) -> str:
    return "broadcast.html" if page == "index" else f"b-{page}.html"


def rail_html(active: str, tabs: list, mark: str) -> str:
    links = []
    for page, label in tabs:
        cur = ' class="here" aria-current="page"' if page == active else ""
        links.append(f'<a href="{out_name(page)}"{cur}>{html.escape(label)}</a>')
    return (f'<div class="rail"><div class="rail-in"><span class="badge">{html.escape(mark)}</span>'
            '<nav aria-label="League sections">' + "".join(links) + "</nav></div></div>")


def stage_html(title: str) -> str:
    t = html.escape(title)
    return ('<header class="stage">'
            '<div class="field"><div class="turf"></div><div class="far"><div class="turf"></div></div></div>'
            f'<div class="stage-in"><h1 class="stage-t"><span><i>{t}</i></span></h1></div>'
            "</header>")


def head_html(v: str, names: list) -> str:
    rules = ('{"prerender":[{"where":{"or":[{"href_matches":"b-*"},'
             '{"href_matches":"broadcast.html"}]},"eagerness":"moderate"}]}')
    return (
        '\n    <link rel="preconnect" href="https://fonts.googleapis.com">'
        '\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        f'\n    <link rel="stylesheet" href="{FONTS}">'
        f'\n    <link rel="stylesheet" href="broadcast-theme.css?v={v}">'
        f'\n    <script type="speculationrules">{rules}</script>'
        f'\n    <meta name="gop-pages" content="{",".join(names)}">'
    )


# Runs before first paint: arriving from another page of the site, skip the
# entrance animations — the crossfade is the transition.
INTERNAL = ('<script>try{var r=document.referrer;if(r&&new URL(r).origin===location.origin)'
            'document.documentElement.classList.add("internal")}catch(e){}</script>')


def build(page: str, v: str, pages: dict, tabs: list, mark: str) -> str:
    src = _read(page + ".html")
    title, active = pages[page]

    # redirect-only pages: point the redirect at the themed target instead
    if title is None:
        def to_themed(m):
            name, _, frag = m.group(2).partition("#")
            new = out_name(name[:-5]) + ("#" + frag if frag else "")
            return m.group(1) + new + m.group(3)
        return re.sub(r'((?:url=|location\.replace\(")\s*)([a-z_]+\.html(?:#[\w-]+)?)(["\)])',
                      to_themed, src)

    out = src

    # <html class="fitted">
    out = re.sub(r"<html(\s[^>]*)?>",
                 lambda m: "<html" + (m.group(1) or "") + ' class="fitted">', out, count=1)

    # head: internal-nav flag first, theme after the original stylesheet
    out = out.replace("<head>", "<head>\n    " + INTERNAL, 1)
    m = re.search(r'<link rel="stylesheet" href="style\.css[^"]*">', out)
    if not m:
        raise SystemExit(f"{page}: no style.css link to anchor the theme to")
    out = out[:m.end()] + head_html(v, sorted(pages)) + out[m.end():]

    # body: drop the page's own static title (the header band carries it)
    b0 = out.index("<body")
    b1 = out.index(">", b0) + 1
    body_end = out.index("</body>")
    body = out[b1:body_end]
    body = re.sub(r"\s*<h1\b[^>]*>.*?</h1>", "", body, flags=re.S)

    # wrap content (everything before the first script) in .deck
    first_script = body.find("<script")
    if first_script < 0:
        first_script = len(body)
    content, scripts = body[:first_script], body[first_script:]

    nav = '<div id="nav"></div>'
    if nav in content:
        content = content.replace(nav, "", 1)
    top = ("\n" + rail_html(active, tabs, mark) + '\n<div id="nav" hidden></div>\n' + stage_html(title) +
           '\n<div class="deck">')
    content = top + content.rstrip() + "\n</div>\n\n"

    # theme scripts ahead of the page's own
    tags = (f'<script src="broadcast-theme.js?v={v}"></script>\n'
            f'<script src="broadcast-bg.js?v={v}" defer></script>\n'
            f'<script src="broadcast-stage.js?v={v}" defer></script>\n')
    scripts = tags + scripts.lstrip()

    return out[:b1] + content + scripts + out[body_end:]


def main() -> int:
    v = str(int(time.time()))
    pages, tabs, name = discover(), rail_tabs(), league_name()
    mark = badge(name)
    for page in pages:
        with open(os.path.join(ROOT, out_name(page)), "w", encoding="utf-8") as f:
            f.write(build(page, v, pages, tabs, mark))
        title, active = pages[page]
        print(f"  {page + '.html':22s} -> {out_name(page):24s} "
              f"{('redirect' if title is None else repr(title)):18s} tab={active or '-'}")
    print(f"{name} [{mark}]: built {len(pages)} pages, rail = "
          + " / ".join(label for _, label in tabs) + f", assets ?v={v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
