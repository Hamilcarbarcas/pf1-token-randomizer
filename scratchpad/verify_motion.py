"""Prove the split was pure motion: strip each new file's authored banner/imports/
exports, concatenate the remainder in original slice order, and diff against the
original file. Any difference means a moved line was altered."""

import os, re

ORIG = r"c:\Code\FoundryVTT\pf1-token-randomizer\src\scripts\token-randomizer.mjs"
OUT = r"c:\Code\FoundryVTT\pf1-token-randomizer\src\scripts"

from split import SLICES, lines  # reuse the exact ranges the split used

recon = {}
for f in SLICES:
    path = os.path.join(OUT, *f.split("/"))
    body = open(path, encoding="utf-8", newline="").read().split("\r\n")

    # drop authored banner: /* ... */ then the import block, then one blank line
    i = 0
    assert body[0].startswith("/*"), f
    while not body[i].rstrip().endswith("*/"): i += 1
    i += 1
    while i < len(body) and (body[i] == "" or body[i].startswith("import ")): i += 1

    # drop authored export block at the tail
    j = len(body)
    while j > 0 and body[j - 1] == "": j -= 1
    if j > 0 and body[j - 1] == "};":
        k = j - 1
        while k > 0 and not body[k].startswith("export {"): k -= 1
        if body[k].startswith("export {"):
            j = k - 1          # exactly one authored blank precedes the export block
    recon[f] = body[i:j]

# rebuild in original line order
rebuilt = {}
for f, ranges in SLICES.items():
    src = recon[f]
    pos = 0
    prev_end = None
    for a, b in ranges:
        # skip the blank separator the writer inserts at a non-blank seam
        if prev_end is not None and prev_end.strip() and lines[a - 1].strip():
            assert src[pos] == "", f"{f}: expected separator at {pos}"
            pos += 1
        n = b - a + 1
        chunk = src[pos:pos + n]
        pos += n
        prev_end = lines[b - 1]
        for off, line in enumerate(chunk):
            rebuilt[a + off] = line
    if pos != len(src):
        print(f"!! {f}: {len(src) - pos} unaccounted line(s) after slices")

bad = 0
for i in range(1, len(lines) + 1):
    orig = lines[i - 1]
    if i not in rebuilt:
        if orig.strip():
            print(f"!! line {i} missing from output: {orig[:70]}")
            bad += 1
        continue
    if rebuilt[i] != orig:
        print(f"!! line {i} ALTERED")
        print(f"   was: {orig[:90]!r}")
        print(f"   now: {rebuilt[i][:90]!r}")
        bad += 1

blank_dropped = [i for i in range(1, len(lines) + 1)
                 if i not in rebuilt and not lines[i - 1].strip()]
print(f"moved lines compared : {len(rebuilt)}")
print(f"blank lines dropped  : {len(blank_dropped)} {blank_dropped if blank_dropped else ''}")
print("RESULT:", "byte-identical motion" if bad == 0 else f"{bad} ALTERED LINE(S)")
