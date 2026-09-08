"""DESIGN.md §10 — split token-randomizer.mjs into modules.

Pure motion: every moved line is copied byte-for-byte from the original. The only
authored text is each file's banner, its import block and its export block.
CRLF is preserved throughout (the original is 100% CRLF; §8.5).

Verifies before writing:
  * every non-blank source line lands in exactly one target
  * no identifier is declared twice
  * no backward edge (an earlier module needing a later one) survives
  * braces balance inside every slice, so no boundary bisects a function
"""

import os, re, posixpath

SRC = r"c:\Code\FoundryVTT\pf1-token-randomizer\src\scripts\token-randomizer.mjs"
OUT = r"c:\Code\FoundryVTT\pf1-token-randomizer\src\scripts"

# --- carve-outs that resolve the four backward edges -------------------------
SEGMENT_WEIGHT = (1259, 1259)   # DEFAULT_SEGMENT_WEIGHT  -> core/const.mjs
WEIGHTED_PICK  = (1415, 1431)   # weightedPick            -> core/util.mjs
PROMPT_TEXT    = (2550, 2559)   # promptForText           -> core/util.mjs
APPV2          = (1711, 1711)   # ApplicationV2 destructure -> core/util.mjs
BTN_COLOR      = (3369, 3390)   # updateRandomizerButtonColor -> apps/settings-app.mjs

SLICES = {
    "core/const.mjs":           [(1, 40), SEGMENT_WEIGHT],
    "core/util.mjs":            [APPV2, WEIGHTED_PICK, PROMPT_TEXT],
    "core/stats.mjs":           [(41, 90), (421, 568)],
    "names/data.mjs":           [(92, 420)],
    "randomizers/treasure.mjs": [(569, 633)],
    "skills/logic.mjs":         [(634, 1223)],
    "core/settings.mjs":        [(1224, 1258), (1260, 1373)],
    "randomizers/workers.mjs":  [(1374, 1414), (1432, 1688)],
    "skills/profiles.mjs":      [(1689, 1708)],
    "apps/settings-app.mjs":    [(1709, 1710), (1712, 2518), BTN_COLOR],
    "apps/list-manager.mjs":    [(2519, 2549), (2560, 2705)],
    "apps/stat-methods.mjs":    [(2706, 2835)],
    "apps/skill-profiles.mjs":  [(2836, 2957)],
    "apps/subskill-groups.mjs": [(2958, 3348)],
    "main.mjs":                 [(3349, 3368), (3391, 3810)],
}

BANNER = {
    "core/const.mjs": "Shared constants. Imports nothing, by design — this is the base of the\n * dependency graph and the thing that keeps every other module acyclic.",
    "core/util.mjs": "Generic helpers with no feature knowledge, plus the ApplicationV2 handles\n * every window class in apps/ builds on.",
    "core/stats.mjs": "Ability-score generation methods: the built-in table, the custom records\n * layered over it, the dice helpers, and constraint-aware assignment.",
    "names/data.mjs": "The name and adjective databases: load, merge, dedupe, persist, import/export.",
    "randomizers/treasure.mjs": "Coin value and denomination split (DESIGN.md §1.1). Part II builds on this.",
    "skills/logic.mjs": "Skill rank distribution — the model in DESIGN.md §2 and §4.",
    "core/settings.mjs": "The per-actor / world-default getter pairs (DESIGN.md §1.1).\n * Registration itself lives in main.mjs, since the menu entries name the\n * window classes in apps/ and importing those here would invert the graph.",
    "randomizers/workers.mjs": "The four placement workers run from the createToken hook, plus name\n * assembly. Ordering matters: skills read Int after abilities rewrite it (§4.1).",
    "skills/profiles.mjs": "Saved Skills-tab snapshots (DESIGN.md §6).",
    "apps/settings-app.mjs": "The tabbed per-actor / defaults dialog (DESIGN.md §1.3), and the sheet\n * header button it is opened from.",
    "apps/list-manager.mjs": "Name database + adjective list editor.",
    "apps/stat-methods.mjs": "Custom stat method editor (arrays and formulas).",
    "apps/skill-profiles.mjs": "Skill profile manager — rename, delete, reorder (DESIGN.md §6.2).",
    "apps/subskill-groups.mjs": "Subskill groups and speciality autocomplete lists (DESIGN.md §4.9, §4.10).",
    "main.mjs": "PF1 Token Randomizer — entry point.\n *\n * Randomizes ability scores, names, skill ranks and carried treasure for unlinked\n * tokens as they are placed. This file owns the hooks, the settings registration\n * and the public API; everything else lives in the modules it imports.",
}

lines = open(SRC, encoding="utf-8", newline="").read().split("\r\n")
NL = len(lines)


def strip_code(text):
    out, i, n = [], 0, len(text)
    mode, tstack = None, []
    while i < n:
        c, nxt = text[i], text[i + 1] if i + 1 < n else ""
        if mode is None:
            if c == "/" and nxt == "/": mode, i = "line", i + 2; continue
            if c == "/" and nxt == "*": mode, i = "block", i + 2; continue
            if c in "'\"`": mode = c; out.append(" "); i += 1; continue
            if c == "}" and tstack: mode = tstack.pop(); out.append(" "); i += 1; continue
            out.append(c); i += 1; continue
        if mode == "line":
            if c == "\n": mode = None; out.append("\n")
            i += 1; continue
        if mode == "block":
            if c == "*" and nxt == "/": mode, i = None, i + 2; continue
            out.append("\n" if c == "\n" else " "); i += 1; continue
        if c == "\\": out.append("  "); i += 2; continue
        if c == mode: mode = None; out.append(" "); i += 1; continue
        if mode == "`" and c == "$" and nxt == "{":
            tstack.append("`"); mode = None; out.append("  "); i += 2; continue
        out.append("\n" if c == "\n" else " "); i += 1
    return "".join(out)


DECL = [re.compile(r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)"),
        re.compile(r"^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*="),
        re.compile(r"^class\s+([A-Za-z_$][\w$]*)")]
DESTRUCT = re.compile(r"^const\s*\{([^}]*)\}\s*=")

order = list(SLICES)
idx = {f: i for i, f in enumerate(order)}
text, declares, owner = {}, {}, {}

def joined(ranges):
    """Concatenate slices, inserting a blank line at a seam where neither side is
    already blank. Separators only — no moved line is ever touched."""
    out = []
    for a, b in ranges:
        chunk = lines[a - 1:b]
        if out and out[-1].strip() and chunk[0].strip():
            out.append("")
        out += chunk
    return "\r\n".join(out)


for f, ranges in SLICES.items():
    text[f] = joined(ranges)
    names = set()
    for line in text[f].split("\r\n"):
        m = DESTRUCT.match(line)
        if m:
            for p in m.group(1).split(","):
                p = p.split(":")[-1].strip()
                if re.fullmatch(r"[A-Za-z_$][\w$]*", p): names.add(p)
            continue
        for pat in DECL:
            m = pat.match(line)
            if m: names.add(m.group(1)); break
    declares[f] = names
    for nm in names: owner.setdefault(nm, []).append(f)

problems = []

seen = {}
for f, ranges in SLICES.items():
    for a, b in ranges:
        for i in range(a, b + 1):
            if i in seen: problems.append(f"line {i} claimed by {seen[i]} and {f}")
            seen[i] = f
for i in range(1, NL + 1):
    if i not in seen and lines[i - 1].strip(): problems.append(f"line {i} uncovered: {lines[i-1][:60]}")
for nm, fs in owner.items():
    if len(fs) > 1: problems.append(f"{nm} declared in {fs}")

for f in order:
    s = strip_code(text[f])
    for open_c, close_c in [("{", "}"), ("(", ")"), ("[", "]")]:
        if s.count(open_c) != s.count(close_c):
            problems.append(f"{f}: unbalanced {open_c}{close_c} "
                            f"({s.count(open_c)} vs {s.count(close_c)}) — a boundary bisects a block")

imports = {}
for f in order:
    found = set(re.findall(r"[A-Za-z_$][\w$]*", strip_code(text[f])))
    need = {}
    for nm in sorted(found):
        if nm in declares[f] or nm not in owner: continue
        src = owner[nm][0]
        need.setdefault(src, []).append(nm)
        if idx[src] > idx[f]: problems.append(f"BACKWARD {f} -> {src} [{nm}]")
    imports[f] = need

if problems:
    print("REFUSING TO WRITE:")
    for p in problems: print("  -", p)
    raise SystemExit(1)


def relpath(frm, to):
    d = posixpath.dirname(frm)
    r = posixpath.relpath(to, d) if d else to
    return r if r.startswith(".") else "./" + r


written = 0
for f in order:
    body = [f"/* {BANNER[f]}", " */", ""]
    for src in sorted(imports[f], key=lambda s: idx[s]):
        body.append(f"import {{ {', '.join(imports[f][src])} }} from \"{relpath(f, src)}\";")
    if imports[f]: body.append("")
    body.append(text[f])
    exported = sorted(n for n in declares[f] if any(n in imports[o].get(f, []) for o in order))
    if exported:
        body += ["", "export {", *[f"  {n}," for n in exported], "};"]
    path = os.path.join(OUT, *f.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out = "\r\n".join(body).rstrip("\r\n") + "\r\n"
    # Banners are authored with bare \n; normalise so the file is 100% CRLF like the
    # original. Mixed endings in this project are a documented trap (DESIGN.md §8.5).
    out = out.replace("\r\n", "\n").replace("\n", "\r\n")
    assert "\n" not in out.replace("\r\n", ""), f
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(out)
    written += 1
    print(f"{f:<28} {sum(b - a + 1 for a, b in SLICES[f]):>5} lines   "
          f"imports {sum(len(v) for v in imports[f].values()):>2}   exports {len(exported)}")

print(f"\n{written} files written. All checks passed.")
