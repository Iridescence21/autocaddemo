# DWG Hybrid Evidence Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the validated DWG conversion path into a real B+A analysis slice where native CAD text/handles and visual detections are independently represented, deterministically fused, and verified against `M-T1-01.dwg` and `M-T1-02.dwg`.

**Architecture:** The existing DWG renderer remains the converter and image path. A new structural evidence module indexes native device-tag text and maps CAD coordinates to overview coordinates; a fusion module enriches nearby visual detections with exact CAD labels and records conflicts without hiding either source. The analysis service persists fused components, while a real-file smoke command proves conversion, parsing, populated-region tiling, and evidence recovery without calling the vision API.

**Tech Stack:** TypeScript 5, Vitest 4, Next.js 16, `dxf-parser`, Sharp, LibreDWG `dwg2dxf`, existing Prisma repositories.

## Global Constraints

- The Python gate must remain green before and after this plan.
- Do not modify UI components that are being edited in the other task.
- Native CAD text, handles, layers, and coordinates outrank visual guesses for exact labels.
- A structural/visual disagreement must create review evidence; it must not be silently overwritten.
- `M-T1-01` and `M-T1-02` are related sheets, not revisions.
- Do not commit real DWG, converted DXF, rendered PNG, database, or API credentials.
- Do not require an OpenAI key for the structural smoke test.

---

## File Structure

- Create `src/lib/cad/structural-evidence.ts`: device-tag recognition, native evidence records, CAD/overview coordinate transforms, and nearby-evidence lookup.
- Create `src/lib/cad/structural-evidence.test.ts`: unit tests for exact tag parsing, handle retention, coordinate mapping, and proximity ordering.
- Create `src/lib/vision/fuse-cad-vision.ts`: deterministic fusion of consolidated visual components with structural evidence.
- Create `src/lib/vision/fuse-cad-vision.test.ts`: unit tests for native-label priority, agreement, conflict preservation, and unmatched visual candidates.
- Modify `src/lib/vision/consolidate.ts`: export the location mapping needed by fusion.
- Modify `src/lib/analysis/service.ts`: persist fused B+A components in vision mode.
- Modify `src/lib/analysis/service.test.ts`: assert fused method/evidence reach persistence.
- Create `scripts/smoke-hybrid-dwg.ts`: convert and render supplied real DWG files, then report structural evidence and tile coverage.
- Create `src/lib/cad/structural-evidence-smoke.test.ts`: validate the smoke-summary gate without confidential fixtures.
- Modify `package.json`: add `smoke:hybrid-dwg`.
- Modify `vitest.config.ts` and `src/lib/db-isolation.test.ts`: make the test database location overrideable so the macOS Prisma engine can use `/tmp` in this isolated workspace.

### Task 1: Native CAD structural evidence index

**Files:**
- Create: `src/lib/cad/structural-evidence.ts`
- Create: `src/lib/cad/structural-evidence.test.ts`

**Interfaces:**
- Consumes: `NormalizedDxfDrawing`, `RenderedCadDrawing`, `DxfTextContext`
- Produces: `StructuralTextEvidence`, `buildStructuralEvidence(drawing, rendered)`, `findNearbyStructuralEvidence(evidence, location, options?)`

- [ ] **Step 1: Write failing tests for native device tags**

Test that `M-T1-02`, free prose, dimensions, and terminal references are excluded, while `QF1`, `TA1`, `KA1`, `YCT1`, and comma-family text such as `KA1,2,3` yield traceable candidates. Assert that every candidate preserves `handle`, `layer`, raw text, normalized tag, category, CAD position, and overview position.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
TEST_DATABASE_URL=file:/tmp/dwg-electrical-test.db npm test -- src/lib/cad/structural-evidence.test.ts
```

Expected: fail because `structural-evidence.ts` does not exist.

- [ ] **Step 3: Implement the minimal evidence index**

Use controlled prefix mappings (`QF` breaker, `FU` fuse, `KM` contactor, `KA/KC/KT` relay, `TA/TV/T` transformer, `QS/SA/SB/KS` switch, `YCT` actuator/relay review category, `X/XT/XB` terminal block). Preserve the raw text and expand comma-family notation conservatively. Map CAD Y upward coordinates into overview Y downward coordinates using drawing extents and rendered dimensions.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: all structural evidence tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/cad/structural-evidence.ts src/lib/cad/structural-evidence.test.ts
git commit -m "feat: index native CAD device evidence"
```

### Task 2: Deterministic B+A evidence fusion

**Files:**
- Create: `src/lib/vision/fuse-cad-vision.ts`
- Create: `src/lib/vision/fuse-cad-vision.test.ts`
- Modify: `src/lib/vision/consolidate.ts`
- Modify: `src/lib/analysis/service.ts`
- Modify: `src/lib/analysis/service.test.ts`

**Interfaces:**
- Consumes: consolidated `ComponentInput[]`, `RenderedCadDrawing`, `StructuralTextEvidence[]`
- Produces: `fuseCadAndVisionComponents(visual, structural) -> ComponentInput[]`

- [ ] **Step 1: Write failing fusion tests**

Cover four behaviors: nearby agreeing CAD text raises confidence and sets method `hybrid_cad_vision`; nearby native tag replaces a conflicting visual label while preserving a conflict evidence line and `requires_review`; unrelated CAD text does not alter the visual result; a visual candidate with no CAD evidence remains `openai_vision`.

- [ ] **Step 2: Run the focused fusion test and verify RED**

Run:

```bash
TEST_DATABASE_URL=file:/tmp/dwg-electrical-test.db npm test -- src/lib/vision/fuse-cad-vision.test.ts
```

Expected: fail because the fusion function does not exist.

- [ ] **Step 3: Implement deterministic matching and conflict rules**

Match by visual bounding-box containment first, then a bounded normalized center distance. Native labels and native-derived categories win exact fields. Preserve both claims in `evidence`, retain source handles, never promote a conflicting result to `confirmed`, and leave unmatched visual candidates unchanged.

- [ ] **Step 4: Integrate fusion into vision-mode persistence**

After visual consolidation in `componentsFromAnalysis`, build structural evidence from `rendered.metadata.context` and fuse before `replaceComponents`. Keep demo mode unchanged.

- [ ] **Step 5: Run fusion and service tests**

Run:

```bash
TEST_DATABASE_URL=file:/tmp/dwg-electrical-test.db npm test -- src/lib/vision/fuse-cad-vision.test.ts src/lib/analysis/service.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/lib/vision/fuse-cad-vision.ts src/lib/vision/fuse-cad-vision.test.ts src/lib/vision/consolidate.ts src/lib/analysis/service.ts src/lib/analysis/service.test.ts
git commit -m "feat: fuse native CAD and visual evidence"
```

### Task 3: Real DWG structural and tiling smoke gate

**Files:**
- Create: `scripts/smoke-hybrid-dwg.ts`
- Create: `src/lib/cad/structural-evidence-smoke.test.ts`
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Modify: `src/lib/db-isolation.test.ts`

**Interfaces:**
- Consumes: one or more DWG paths from CLI arguments, `dwgRenderer`, and `buildStructuralEvidence`
- Produces: JSON summary containing source, entity/text/block counts, tile count, coverage flag, recovered tags, and image dimensions

- [ ] **Step 1: Add a failing script-level test for summary validation**

Extract and test `assertHybridSmokeSummary(summary)` so an empty entity set, zero tiles, empty image, or missing required tags fails with a stable error code.

- [ ] **Step 2: Run the focused test and verify RED**

Run the smoke test file before implementation and confirm it fails for the missing export.

- [ ] **Step 3: Implement the smoke CLI and package command**

The CLI accepts real DWG paths, calls the configured LibreDWG renderer, validates non-empty tiles and images, indexes structural evidence, and prints JSON. It never calls the vision API or writes to Prisma.

- [ ] **Step 4: Make test database location portable for this Mac workspace**

Keep the existing relative test database default, but allow `TEST_DATABASE_URL` to override it. Update the isolation assertion to require a filename ending in `dwg-electrical-test.db` and to reject the live `dwg-electrical.db` path.

- [ ] **Step 5: Run both real drawings**

Run:

```bash
DWG_CONVERTER=/opt/homebrew/bin/dwg2dxf npm run smoke:hybrid-dwg -- \
  "/Users/ljp/Documents/10KV高压配电柜一二次系统原理/35-6~10KV变压器二次电路图/M-T1-01.dwg" \
  "/Users/ljp/Documents/10KV高压配电柜一二次系统原理/35-6~10KV变压器二次电路图/M-T1-02.dwg"
```

Expected: both summaries report non-empty CAD context, multiple populated tiles, non-empty PNG dimensions, and `M-T1-02` includes native evidence for `TA1`, `KA1`, and `YCT1`.

- [ ] **Step 6: Run verification**

Run targeted Vitest files, `npm run typecheck`, `npm run lint`, the Python 7-test suite, and the two-file Python gate. Record any pre-existing unrelated suite failure separately rather than hiding it.

- [ ] **Step 7: Commit Task 3**

```bash
git add package.json scripts/smoke-hybrid-dwg.ts src/lib/cad/structural-evidence-smoke.test.ts vitest.config.ts src/lib/db-isolation.test.ts
git commit -m "test: add real hybrid DWG smoke gate"
```
