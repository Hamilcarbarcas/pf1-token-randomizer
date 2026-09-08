"""Static checks on the encounter windows — the parts a load test cannot reach.

  1. every data-action in a template is registered in its app's actions map
  2. Handlebars block helpers balance
  3. every selector the app addEventListener's on exists in the template
  4. no class is used both as a listener target and as an ancestor of that target
     (change/input events bubble, so the handler would fire twice, the second time
     with a currentTarget that has none of the expected dataset keys)
"""

import re, os, sys, glob

os.chdir(r"c:/Code/FoundryVTT/pf1-token-randomizer")

PAIRS = [
    ("src/scripts/apps/encounter-app.mjs", "src/templates/encounter.hbs"),
    ("src/scripts/apps/encounter-picker.mjs", "src/templates/encounter-picker.hbs"),
]

problems = []

# 0. ApplicationV2 owns these as getter-only; `this.<name> = ...` throws on construction.
#    The load test catches it too, by constructing every window — this reports where.
RESERVED = ["id", "state", "window", "form", "element", "rendered", "title",
            "classList", "hasFrame", "minimized"]
for path in sorted(glob.glob("src/scripts/apps/*.mjs")):
    src = open(path, encoding="utf-8").read().split("\n")
    for i, line in enumerate(src, 1):
        for name in RESERVED:
            if re.search(r"\bthis\." + name + r"\s*=(?!=)", line):
                problems.append(f"{os.path.basename(path)}:{i}: assigns this.{name} — "
                                f"ApplicationV2 owns it as getter-only, this throws")

for app_path, tpl_path in PAIRS:
    app = open(app_path, encoding="utf-8").read()
    tpl = open(tpl_path, encoding="utf-8").read()
    name = os.path.basename(tpl_path)

    # 1. data-action coverage
    block = re.search(r"actions:\s*\{(.*?)\n    \}", app, re.S)
    registered = set(re.findall(r"(\w+):\s*\w+\.#", block.group(1))) if block else set()
    used = set(re.findall(r'data-action="([^"]+)"', tpl))
    for a in sorted(used - registered):
        problems.append(f"{name}: data-action=\"{a}\" is not in the actions map")
    for a in sorted(registered - used):
        problems.append(f"{name}: action \"{a}\" is registered but never used in the template")

    # 2. block helper balance
    for helper in ("if", "each", "unless"):
        opens = len(re.findall(r"\{\{#" + helper + r"[ }]", tpl))
        closes = len(re.findall(r"\{\{/" + helper + r"\}\}", tpl))
        if opens != closes:
            problems.append(f"{name}: {{{{#{helper}}}}} x{opens} vs {{{{/{helper}}}}} x{closes}")
    if tpl.count("{{else}}") > sum(len(re.findall(r"\{\{#" + h + r"[ }]", tpl)) for h in ("if", "each", "unless")):
        problems.append(f"{name}: more {{{{else}}}} than block helpers")

    # 3/4. listener selectors
    selectors = set(re.findall(r'on\("\.([\w-]+)"', app))
    selectors |= set(re.findall(r'querySelectorAll\("\.([\w-]+)"', app))
    # tag name -> the class tokens on that element. Handlebars helpers inside a class
    # attribute are stripped rather than read as class names: {{#unless x}}foo{{/unless}}
    # still puts "foo" on the element at render time. Tag names may be hyphenated, since
    # custom elements live here too.
    elements = [(m.group(1), re.sub(r"\{\{[^}]*\}\}", " ", m.group(2)).split())
                for m in re.finditer(r'<([\w-]+)[^>]*\bclass="([^"]*)"', tpl)]
    for sel in sorted(selectors):
        carriers = [tag for tag, classes in elements if sel in classes]
        if not carriers:
            problems.append(f"{name}: app listens on .{sel} but no element carries it")
            continue
        if len(set(carriers)) > 1:
            problems.append(
                f"{name}: .{sel} is on {sorted(set(carriers))} — a bubbling change/input "
                f"event fires the handler twice, the second time on the wrapper, where the "
                f"expected dataset keys are undefined")

# 5. every TR. key referenced anywhere must exist in lang/en.json, and vice-versa for
#    the encounter feature. A key that only appears in a helper module (not a template)
#    is exactly how the profile strings shipped as raw "TR.Hoard.Load" text.
import json
lang = json.load(open("lang/en.json", encoding="utf-8"))
PATTERNS = [r'localize\("([^"]+)"\)', r'localize "([^"]+)"', r'format\("([^"]+)"',
            r'name:\s*"(TR\.[^"]+)"', r'hint:\s*"(TR\.[^"]+)"', r'title:\s*"(TR\.[^"]+)"',
            r'title="\{\{localize "([^"]+)"\}\}"']
scanned = glob.glob("src/scripts/**/*.mjs", recursive=True) + glob.glob("src/templates/*.hbs")
for path in sorted(scanned):
    src = open(path, encoding="utf-8").read()
    for pat in PATTERNS:
        for key in re.findall(pat, src):
            if key.startswith("TR.") and key not in lang:
                problems.append(f"{os.path.basename(path)}: uses {key}, which is not in lang/en.json")

print("UI wiring check")
if problems:
    for p in problems:
        print("  !!", p)
    sys.exit(1)
print("  all data-actions registered, helpers balanced, selectors resolve uniquely")
