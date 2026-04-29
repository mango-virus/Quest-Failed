"""Reverse double-encoded UTF-8 → cp1252 mojibake in source files.

When text containing chars like '—' (UTF-8 0xE2 0x80 0x94) was rendered as
cp1252 ('â€"') and then re-saved as UTF-8, every char now takes ~2-3x bytes.
This script reverses that by:
  1. Read file as UTF-8 (gets the visible mojibake string)
  2. Re-encode that string as cp1252 (recovers the original UTF-8 bytes)
  3. Decode those bytes as UTF-8 (gets the real characters)
  4. Write back as UTF-8

Only fixes lines that round-trip cleanly. Skips characters that don't fit cp1252.
"""
import sys, pathlib

ROOT = pathlib.Path(__file__).parent / "src"
TARGETS = list(ROOT.rglob("*.js"))

fixed_files = 0
for path in TARGETS:
    try:
        original = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    # Heuristic: look for tell-tale double-encoding sequences
    if "â€" not in original and "Â·" not in original and "Ã—" not in original and "Ã©" not in original:
        continue
    try:
        # Step 1: encode as cp1252 (each visible char becomes its single-byte cp1252 code)
        # Step 2: decode that byte stream as UTF-8 (recovers the real codepoints)
        repaired = original.encode("cp1252", errors="strict").decode("utf-8", errors="strict")
    except (UnicodeEncodeError, UnicodeDecodeError) as e:
        print(f"SKIP {path.relative_to(ROOT.parent)} ({e})")
        continue
    if repaired == original:
        continue
    path.write_text(repaired, encoding="utf-8", newline="")
    fixed_files += 1
    print(f"FIXED {path.relative_to(ROOT.parent)}")

print(f"\n{fixed_files} file(s) repaired.")
