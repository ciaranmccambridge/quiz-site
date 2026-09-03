#!/usr/bin/env python3
"""Static wiring checks for a build-step-free site.

Run:  python3 tests/check_wiring.py

With no bundler and no type checker, three mistakes are easy to make and silent
until someone opens the page:

  1. getElementById('typo')      -> null, then a TypeError on first use
  2. import { notExported }      -> module-level SyntaxError, whole script dead
  3. audio: 'audio/missing.wav'  -> a question nobody can hear

All three are cheap to catch by reading the files, so this does that.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# script -> the HTML document that loads it
SCRIPT_PAGES = {
    "assets/app.js": "index.html",
    "assets/leaderboard.js": "leaderboard/index.html",
}

problems = []


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as handle:
        return handle.read()


def check_dom_ids():
    for script, page in SCRIPT_PAGES.items():
        js = read(script)
        html = read(page)

        declared = set(re.findall(r"""\bid=["']([^"']+)["']""", html))
        used = set(re.findall(r"""getElementById\(["']([^"']+)["']\)""", js))

        for missing in sorted(used - declared):
            problems.append(f"{script}: getElementById('{missing}') has no matching id in {page}")

        # Unused ids are only a tidiness issue, so report them separately.
        for unused in sorted(declared - used):
            print(f"  note: id '{unused}' in {page} is never read by {script}")


def check_named_imports():
    for script in sorted(SCRIPT_PAGES) + ["assets/questions.js", "assets/match.js"]:
        js = read(script)

        # import { a, b as c } from './mod.js'
        for names, target in re.findall(r"import\s*\{([^}]*)\}\s*from\s*['\"](\.[^'\"]+)['\"]", js):
            target_rel = os.path.normpath(os.path.join(os.path.dirname(script), target))
            if not os.path.exists(os.path.join(ROOT, target_rel)):
                problems.append(f"{script}: imports missing file {target_rel}")
                continue

            source = read(target_rel)

            for name in names.split(","):
                name = name.strip().split(" as ")[0].strip()
                if not name:
                    continue

                exported = (
                    # export const/let/function/class, incl. `export async function`
                    re.search(
                        rf"export\s+(?:async\s+)?(?:const|function\*?|let|var|class)\s+"
                        rf"{re.escape(name)}\b",
                        source,
                    )
                    # export { a, b as c }  --  also covers re-exports
                    or re.search(rf"export\s*\{{[^}}]*\b{re.escape(name)}\b", source)
                )
                if not exported:
                    problems.append(
                        f"{script}: imports '{name}' from {target_rel}, which does not export it"
                    )


def check_audio_paths():
    data = read("assets/quiz-data.js")

    for path in re.findall(r"""audio:\s*['"]([^'"]+)['"]""", data):
        if not os.path.exists(os.path.join(ROOT, path)):
            problems.append(f"assets/quiz-data.js: audio file not found -> {path}")


def check_asset_links():
    """Relative paths must resolve, since the site is served from a subpath."""
    for page in set(SCRIPT_PAGES.values()):
        html = read(page)
        base = os.path.dirname(page)

        for attr in re.findall(r"""(?:src|href)=["'](?!https?:|data:|#|mailto:)([^"']+)["']""", html):
            target = attr.rstrip("/") or "."
            resolved = os.path.normpath(os.path.join(ROOT, base, target))

            if not (os.path.exists(resolved) or os.path.isdir(resolved)):
                problems.append(f"{page}: link target not found -> {attr}")


check_dom_ids()
check_named_imports()
check_audio_paths()
check_asset_links()

if problems:
    print()
    for problem in problems:
        print(f"  FAIL {problem}")
    print(f"\n{len(problems)} wiring problem(s)")
    sys.exit(1)

print("\nWiring OK: DOM ids, named imports, audio paths and relative links all resolve.")
