import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

// Guard: every OFFLINE-TESTED in-scope cell in docs/v2/OFFER_MATRIX.md must
// carry at least one `[<cell>]`-tagged test somewhere under tests/. A cell can
// be satisfied by a tag in any file, and may be split across files
// (one-test-per-cell-MINIMUM). The required set mirrors the matrix's
// offline-tested cells exactly so the doc and the suite cannot drift.
//
// Out of the required set:
//   - B2  (bundle-for-BTC)  — OUT OF SCOPE per RD8.
//   - B8  (wallet foreign-input limits) — live-only (E3); documented but has no
//     offline test, so it is NOT required by the offline guard.
const REQUIRED_CELLS: string[] = [
  // Single-asset offers.
  "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8",
  // Bundle offers (RD4) — B2 excluded (RD8), B8 excluded (live-only).
  "B1", "B3", "B4", "B5", "B6", "B7",
  // Negotiation lifecycle.
  "N1", "N2", "N3", "N4", "N5",
  // Partially-fillable BTC buy bids (RD7).
  "BD1", "BD2", "BD3", "BD4", "BD5", "BD6", "BD7", "BD8", "BD9",
  // Dust boundary + value conservation.
  "D1", "D2", "D3", "D4", "V1", "V2",
];

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

// Match a cell tag like [M1], [BD10], [D4]. The trailing boundary ensures [B1]
// does not also match [BD1] etc. (parsed as prefix + digits + "]").
const TAG_RE = /\[(M|BD|B|N|D|V)(\d+)\]/g;

function collectTaggedCells(): Set<string> {
  const tagged = new Set<string>();
  const files = readdirSync(TESTS_DIR).filter(
    (name) => name.endsWith(".test.ts") && name !== "offer-matrix-coverage.test.ts",
  );
  for (const file of files) {
    const text = readFileSync(join(TESTS_DIR, file), "utf8");
    for (const match of text.matchAll(TAG_RE)) {
      tagged.add(`${match[1]}${match[2]}`);
    }
  }
  return tagged;
}

test("every in-scope offer-matrix cell has at least one tagged test", () => {
  const tagged = collectTaggedCells();
  const missing = REQUIRED_CELLS.filter((cell) => !tagged.has(cell));
  assert.deepEqual(
    missing,
    [],
    `Matrix cells with no [<cell>]-tagged test under tests/: ${missing.join(", ")}. ` +
      "Tag an existing test title with the cell ID (e.g. \"[M1] ...\") or add a focused test.",
  );
});

test("B2 (bundle-for-BTC, RD8) is out of scope and not required", () => {
  // Documents the deliberate exclusion so a future reader does not "fix" the
  // guard by adding B2.
  assert.equal(REQUIRED_CELLS.includes("B2"), false);
});
