#!/usr/bin/env python3
"""Stamp every versioned asset reference with one shared cache token.

The site used to carry three independent token families -- one for data.js, one
for the .js/.css suffix, and a stale one on the team/teams pages -- so a commit
that edited a script while bumping only data.js shipped a change browsers never
fetched. One token for everything removes that failure mode: bump it whenever any
asset changes and every page reloads together.

Run from the repo root:  python3 scripts/bump_assets.py
"""

import os, re, sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_RE = re.compile(r'(\?v=)[0-9a-zA-Z]+')


def main():
    token = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime("%Y%m%d%H%M")
    if not re.fullmatch(r'[0-9a-zA-Z]+', token):
        sys.exit(f"token must be alphanumeric, got {token!r}")

    changed, refs = [], 0
    for name in sorted(os.listdir(ROOT)):
        if not name.endswith((".html", ".js", ".css")) or name == "data.js":
            continue
        path = os.path.join(ROOT, name)
        with open(path) as f:
            src = f.read()
        new, n = TOKEN_RE.subn(r'\g<1>' + token, src)
        refs += n
        if new != src:
            with open(path, "w") as f:
                f.write(new)
            changed.append(f"{name} ({n})")

    print(f"token {token} -> {refs} refs across {len(os.listdir(ROOT))} files")
    for c in changed:
        print(f"  {c}")
    if not changed:
        print("  (already current)")


if __name__ == "__main__":
    main()
