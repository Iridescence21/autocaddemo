# Exhaustive Component Counting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze populated DWG/DXF regions at readable resolution, enumerate visible symbol occurrences, group them into physical devices, and export both views in one Excel worksheet.

**Architecture:** Replace fixed four-quadrant raster crops with a vector-backed adaptive tile plan driven by normalized CAD entity bounds. Analyze each tile independently with a verification pass for dense regions, reconcile only true overlap duplicates, then persist symbol occurrences and conservative physical-device groups as separate entities.

**Tech Stack:** Next.js 16 App Router, TypeScript, Sharp, dxf-parser, LibreDWG, OpenAI Responses API structured outputs, Prisma 7 with SQLite/libSQL adapter, ExcelJS, Vitest, Ant Design X 2.8.

## Global Constraints

- Results are preliminary and require engineer verification.
- Every symbol occurrence keeps category, source location, source tile, confidence, evidence, and review status.
- Missing manufacturer, model, or specification values are never invented.
- The one-sheet Excel export contains both symbol occurrences and grouped physical-device/BOM totals.
- Tile count, dimensions, overlap, verification threshold, concurrency, and timeout are environment-configurable and bounded.
- If tile limits or partial failures prevent full coverage, show and export a visible warning.
- Preserve the existing prepared DWG demo path and unrelated application behavior.
- Do not modify the user's unrelated dirty documentation files.

---

## File Structure

- Create `src/lib/cad/analysis-tiles.ts`: entity bounds, adaptive tile planning, occupancy, and tile metadata.
- Create `src/lib/cad/analysis-tiles.test.ts`: adaptive coverage and limit tests.
- Modify `src/lib/cad/dxf-svg.ts`: render a specified CAD viewport at analysis resolution.
- Modify `src/lib/cad/dxf-renderer.ts`: overview plus vector-backed adaptive analysis tiles.
- Modify `src/lib/cad/types.ts`: tile CAD bounds, density, and coverage metadata.
- Modify `src/lib/cad/dxf-renderer.test.ts`: prove dense fixtures receive more than four readable tiles.
- Modify `src/lib/vision/openai-analyzer.ts`: one structured request per tile and verification requests for dense tiles.
- Modify `src/lib/vision/types.ts`: analysis diagnostics and coverage fields.
- Modify `src/lib/vision/openai-analyzer.test.ts`: request isolation, verification, concurrency, and partial failure.
- Modify `src/lib/vision/consolidate.ts`: conservative duplicate reconciliation.
- Modify `src/lib/vision/consolidate.test.ts`: duplicate and neighboring-repeat regression cases.
- Create `src/lib/devices/group.ts`: pure symbol-to-physical-device grouping.
- Create `src/lib/devices/group.test.ts`: tag grouping and conservative unlabeled behavior.
- Modify `prisma/schema.prisma`: persisted `PhysicalDevice` and occurrence relation.
- Modify `src/lib/domain.ts`: physical-device input and analysis summary types.
- Modify `src/lib/repositories/components.ts`: replace physical devices and generate BOM from devices.
- Modify `src/lib/repositories/drawings.ts`: include physical devices in snapshots.
- Modify `src/lib/db.ts`: delete physical devices during isolated test resets.
- Modify `src/lib/repositories/domain.test.ts`: persistence and ownership behavior.
- Modify `src/lib/analysis/service.ts`: persist occurrences, groups, diagnostics, and separate counts.
- Modify `src/lib/analysis/service.test.ts`: end-to-end analysis service assertions.
- Modify `src/components/drawing-workspace.tsx`: Chinese symbol/device counts and coverage warnings.
- Modify `src/components/drawing-workspace.test.ts`: source-level UI contract assertions.
- Modify `src/lib/export.ts`: one worksheet with occurrence table and device/BOM summary.
- Modify `src/lib/export.test.ts`: workbook structure and values.
- Modify `src/app/api/drawings/[id]/exports/route.ts`: pass physical devices and BOM into workbook.
- Modify `src/app/api/drawings/[id]/exports/route.test.ts`: download assertions.
- Modify `scripts/smoke-real-dxf.ts`: report tiles, raw detections, occurrences, devices, and category totals.
- Modify `scripts/smoke-real-dwg.ts`: consume a genuine DWG source instead of testing the experimental writer.

---

### Task 1: Adaptive Vector-Backed Analysis Tiles

**Files:**
- Create: `src/lib/cad/analysis-tiles.ts`
- Create: `src/lib/cad/analysis-tiles.test.ts`
- Modify: `src/lib/cad/types.ts`
- Modify: `src/lib/cad/dxf-svg.ts`
- Modify: `src/lib/cad/dxf-renderer.ts`
- Modify: `src/lib/cad/dxf-renderer.test.ts`

**Interfaces:**
- Consumes: `NormalizedDxfDrawing`, `DxfExtents`, and normalized entities from `src/lib/cad/dxf-types.ts`.
- Produces: `planAnalysisTiles(drawing, options): AnalysisTilePlan`, `renderDxfSvg(drawing, options)` with optional viewport, and `CadDrawingTile.cadBounds/entityCount/textCount/blockCount`.

- [ ] **Step 1: Write failing adaptive-plan tests**

```ts
import { describe, expect, it } from "vitest";
import { planAnalysisTiles } from "@/lib/cad/analysis-tiles";

it("uses more than four occupied tiles for a dense wide drawing", () => {
  const drawing = denseDrawing({ entities: 1800, extents: { minX: 0, minY: 0, maxX: 5000, maxY: 900 } });
  const plan = planAnalysisTiles(drawing, { maxTiles: 24, overlapRatio: 0.1, targetEntitiesPerTile: 140 });
  expect(plan.tiles.length).toBeGreaterThan(4);
  expect(plan.tiles.length).toBeLessThanOrEqual(24);
  expect(plan.limited).toBe(false);
  expect(plan.tiles.every((tile) => tile.entityCount > 0)).toBe(true);
});

it("marks coverage as limited when occupied cells exceed the cap", () => {
  const plan = planAnalysisTiles(denseDrawing({ entities: 5000 }), { maxTiles: 3, overlapRatio: 0.1, targetEntitiesPerTile: 50 });
  expect(plan.tiles).toHaveLength(3);
  expect(plan.limited).toBe(true);
  expect(plan.warnings).toContain("分析区域达到上限，部分图纸区域可能未完整扫描。");
});
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run: `npm test -- --run src/lib/cad/analysis-tiles.test.ts`

Expected: FAIL because `@/lib/cad/analysis-tiles` does not exist.

- [ ] **Step 3: Implement entity bounds and adaptive occupied-cell planning**

```ts
export type AnalysisTilePlan = {
  tiles: Array<{ id: string; cadBounds: DxfExtents; entityCount: number; textCount: number; blockCount: number }>;
  limited: boolean;
  warnings: string[];
};

export function planAnalysisTiles(drawing: NormalizedDxfDrawing, options: AnalysisTileOptions): AnalysisTilePlan {
  const desired = Math.max(1, Math.ceil(drawing.entities.length / options.targetEntitiesPerTile));
  const aspect = Math.max(0.1, (drawing.extents.maxX - drawing.extents.minX) / (drawing.extents.maxY - drawing.extents.minY));
  const columns = Math.max(1, Math.ceil(Math.sqrt(desired * aspect)));
  const rows = Math.max(1, Math.ceil(desired / columns));
  const occupied = buildOccupiedCells(drawing, rows, columns, options.overlapRatio);
  const limited = occupied.length > options.maxTiles;
  return {
    tiles: occupied.slice(0, options.maxTiles).map((tile, index) => ({ ...tile, id: `tile-${index + 1}` })),
    limited,
    warnings: limited ? ["分析区域达到上限，部分图纸区域可能未完整扫描。"] : [],
  };
}
```

`buildOccupiedCells` must count an entity only when its geometric bounds intersect the cell, include overlap in CAD units, sort cells by top-to-bottom then left-to-right, and skip cells with zero supported entities.

- [ ] **Step 4: Add viewport rendering and tile metadata**

Extend `SvgOptions`:

```ts
type SvgOptions = {
  maxWidth?: number;
  maxHeight?: number;
  padding?: number;
  viewport?: DxfExtents;
};
```

Use `options.viewport ?? drawing.extents` for scale and coordinate conversion. In `dxf-renderer.ts`, keep the existing overview, then render every planned CAD viewport independently at `CAD_ANALYSIS_TILE_PIXELS` (default `1536`) before rasterizing with Sharp. Set each tile's overview `x/y/width/height`, CAD bounds, and density counters. Set `metadata.coverageLimited` and append plan warnings to the normalized CAD context.

- [ ] **Step 5: Replace the fixed-four-tile renderer assertion**

```ts
expect(rendered.tiles.length).toBeGreaterThan(0);
expect(rendered.tiles.every((tile) => tile.width > 0 && tile.height > 0)).toBe(true);
expect(rendered.tiles.every((tile) => tile.cadBounds && tile.entityCount > 0)).toBe(true);
expect(rendered.metadata?.coverageLimited).toBe(false);
```

- [ ] **Step 6: Run focused tests and type checking**

Run: `npm test -- --run src/lib/cad/analysis-tiles.test.ts src/lib/cad/dxf-renderer.test.ts src/lib/cad/dwg-renderer.test.ts`

Expected: all listed tests PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cad/analysis-tiles.ts src/lib/cad/analysis-tiles.test.ts src/lib/cad/types.ts src/lib/cad/dxf-svg.ts src/lib/cad/dxf-renderer.ts src/lib/cad/dxf-renderer.test.ts
git commit -m "feat: render adaptive CAD analysis tiles"
```

---

### Task 2: Per-Tile Enumeration and Verification Passes

**Files:**
- Modify: `src/lib/vision/types.ts`
- Modify: `src/lib/vision/openai-analyzer.ts`
- Modify: `src/lib/vision/openai-analyzer.test.ts`

**Interfaces:**
- Consumes: adaptive `RenderedCadDrawing.tiles` from Task 1.
- Produces: `ValidatedVisionResult` with combined tile detections plus `analysisDiagnostics: { attemptedTiles; completedTiles; failedTiles; verificationTiles; rawDetectionCount; coverageLimited }`.

- [ ] **Step 1: Write failing request-isolation and verification tests**

```ts
it("enumerates each tile in a separate request", async () => {
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(modelResponse(resultFor("tile-1", ["QF1", "QF2"])))
    .mockResolvedValueOnce(modelResponse(resultFor("tile-2", ["KM1"])));
  const analyzer = createOpenAiVisionAnalyzer({ apiKey: "test-secret", fetchImpl, verificationEntityThreshold: 9999 });
  const result = await analyzer.analyze(inputWithTiles(2));
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(result.components.map((item) => item.label)).toEqual(["QF1", "QF2", "KM1"]);
  expect(result.analysisDiagnostics.completedTiles).toBe(2);
});

it("runs a missed-candidate verification pass for dense tiles", async () => {
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(modelResponse(resultFor("tile-1", ["QF1"])))
    .mockResolvedValueOnce(modelResponse(resultFor("tile-1", ["QF2"])));
  const analyzer = createOpenAiVisionAnalyzer({ apiKey: "test-secret", fetchImpl, verificationEntityThreshold: 100 });
  const result = await analyzer.analyze(inputWithTile({ entityCount: 300 }));
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(fetchImpl.mock.calls[1][1]?.body)).toContain("QF1");
  expect(result.analysisDiagnostics.verificationTiles).toBe(1);
});
```

Add a third test proving one failed tile returns partial results and a warning, while all failed tiles throw `AI_PROVIDER_ERROR`.

- [ ] **Step 2: Run the tests and verify they fail against the aggregate request**

Run: `npm test -- --run src/lib/vision/openai-analyzer.test.ts`

Expected: FAIL because the analyzer performs one request for all tiles and has no diagnostics.

- [ ] **Step 3: Implement a bounded per-tile request worker**

```ts
type TilePass = "enumerate" | "verify";

async function analyzeTile(tile: CadDrawingTile, pass: TilePass, existing: VisionDetection[]) {
  const body = buildTileBody(input, tile, model, pass, existing);
  return requestValidatedResult(body);
}

const settled = await mapWithConcurrency(input.rendered.tiles, concurrency, async (tile) => {
  const first = await analyzeTile(tile, "enumerate", []);
  if (tile.entityCount < verificationEntityThreshold) return { tile, results: [first], verified: false };
  const verification = await analyzeTile(tile, "verify", first.components);
  return { tile, results: [first, verification], verified: true };
});
```

Default `OPENAI_ANALYSIS_CONCURRENCY` to `2`, `OPENAI_VERIFY_ENTITY_THRESHOLD` to `180`, and preserve the existing per-request timeout. Normalize temporary IDs in application code as `${tile.id}-${pass}-${index + 1}` and force every detection's `tileId` to the tile being analyzed.

- [ ] **Step 4: Make the prompt exhaustive and region-scoped**

The enumeration prompt must state:

```text
逐个枚举此区域内每一个可见的独立电气符号实例。重复符号必须分别输出。无法分类的可见符号输出 unknown。不要把多个相邻符号概括为一个“图元簇”。不要在此阶段合并同类项或推算采购数量。
```

The verification prompt must include first-pass labels and normalized boxes and state:

```text
这是漏检复核。只输出第一遍遗漏的独立符号，或位置明显错误的替代检测；不要重复第一遍已列出的对象。
```

Pass only tile-intersecting text, layers, and block references from normalized CAD context.

- [ ] **Step 5: Run focused tests and type checking**

Run: `npm test -- --run src/lib/vision/openai-analyzer.test.ts`

Expected: all analyzer tests PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/vision/types.ts src/lib/vision/openai-analyzer.ts src/lib/vision/openai-analyzer.test.ts
git commit -m "feat: enumerate components per analysis tile"
```

---

### Task 3: Conservative Duplicate Reconciliation

**Files:**
- Modify: `src/lib/vision/consolidate.ts`
- Modify: `src/lib/vision/consolidate.test.ts`

**Interfaces:**
- Consumes: raw per-pass `VisionDetection[]` from Task 2 and overview tile coordinates from Task 1.
- Produces: one `ComponentInput` per distinct symbol occurrence.

- [ ] **Step 1: Add failing regressions for repeated neighbors and verification duplicates**

```ts
it("does not merge two close repeated symbols with separate boxes", () => {
  const components = consolidateVisionComponents(result([
    detection({ temporaryId: "QF-1", label: "QF", location: { x: 0.40, y: 0.3, width: 0.08, height: 0.1 } }),
    detection({ temporaryId: "QF-2", label: "QF", location: { x: 0.49, y: 0.3, width: 0.08, height: 0.1 } }),
  ]), rendered);
  expect(components).toHaveLength(2);
});

it("merges the same high-overlap detection returned by verification", () => {
  const components = consolidateVisionComponents(result([
    detection({ temporaryId: "tile-1-enumerate-1", location: box(0.4, 0.3, 0.1, 0.1) }),
    detection({ temporaryId: "tile-1-verify-1", location: box(0.402, 0.301, 0.1, 0.1) }),
  ]), rendered);
  expect(components).toHaveLength(1);
});
```

- [ ] **Step 2: Run the tests and verify the neighbor regression fails**

Run: `npm test -- --run src/lib/vision/consolidate.test.ts`

Expected: at least the neighboring-symbol test FAILS under center-distance merging.

- [ ] **Step 3: Replace center-distance merging with strict spatial evidence**

```ts
function compatible(left: LocatedDetection, right: LocatedDetection) {
  const iou = intersectionOverUnion(left.overviewLocation, right.overviewLocation);
  const labelsAgree = normalizedLabel(left.label) && normalizedLabel(left.label) === normalizedLabel(right.label);
  const categoriesAgree = left.category === right.category || left.category === "unknown" || right.category === "unknown";
  if (!categoriesAgree) return false;
  if (left.label && right.label && !labelsAgree) return false;
  return iou >= 0.72 || (labelsAgree && iou >= 0.48);
}
```

Do not union boxes when one contains a neighboring symbol; keep the higher-confidence box and aggregate tile IDs/evidence. Keep unknown review status explicit.

- [ ] **Step 4: Run focused tests and type checking**

Run: `npm test -- --run src/lib/vision/consolidate.test.ts`

Expected: all consolidation tests PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vision/consolidate.ts src/lib/vision/consolidate.test.ts
git commit -m "fix: preserve distinct repeated symbol detections"
```

---

### Task 4: Persist Physical Devices Separately from Symbol Occurrences

**Files:**
- Create: `src/lib/devices/group.ts`
- Create: `src/lib/devices/group.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/domain.ts`
- Modify: `src/lib/repositories/components.ts`
- Modify: `src/lib/repositories/drawings.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/repositories/domain.test.ts`

**Interfaces:**
- Consumes: persisted active `ComponentCandidate` symbol occurrences.
- Produces: `groupPhysicalDevices(occurrences): PhysicalDeviceInput[]`, persisted `PhysicalDevice[]`, and BOM quantities derived from devices rather than symbol rows.

- [ ] **Step 1: Write failing pure grouping tests**

```ts
it("groups repeated occurrences with the same normalized tag into one device", () => {
  const groups = groupPhysicalDevices([
    occurrence({ temporaryId: "KM1-coil", tag: "KM1", category: "contactor" }),
    occurrence({ temporaryId: "KM1-contact-1", tag: "KM1", category: "switch" }),
    occurrence({ temporaryId: "KM1-contact-2", tag: "KM1", category: "switch" }),
  ]);
  expect(groups).toHaveLength(1);
  expect(groups[0].occurrenceTemporaryIds).toHaveLength(3);
  expect(groups[0].quantity).toBe(1);
});

it("keeps unlabeled occurrences as separate physical devices", () => {
  const groups = groupPhysicalDevices([
    occurrence({ temporaryId: "motor-a", tag: null, category: "motor", modelNumber: "M-100" }),
    occurrence({ temporaryId: "motor-b", tag: null, category: "motor", modelNumber: "M-100" }),
  ]);
  expect(groups).toHaveLength(2);
});
```

- [ ] **Step 2: Run the grouping tests and verify the missing-module failure**

Run: `npm test -- --run src/lib/devices/group.test.ts`

Expected: FAIL because `src/lib/devices/group.ts` does not exist.

- [ ] **Step 3: Implement conservative grouping**

```ts
export function groupPhysicalDevices(occurrences: DeviceOccurrence[]): PhysicalDeviceInput[] {
  const groups = new Map<string, DeviceOccurrence[]>();
  for (const item of occurrences) {
    const tag = normalizeTag(item.tag);
    const key = tag ? `tag:${tag}` : `occurrence:${item.temporaryId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([key, items], index) => buildDevice(`device-${index + 1}`, key, items));
}
```

`buildDevice` uses the tagged occurrence with highest confidence as the representative, lowers device confidence to the minimum member confidence, marks multi-category groups for review, and preserves every occurrence temporary ID as evidence.

- [ ] **Step 4: Add Prisma persistence**

Add `Drawing.physicalDevices`, optional `ComponentCandidate.physicalDeviceId`, and `ComponentCandidate.physicalDevice` with `onDelete: SetNull`, then add:

```prisma
model PhysicalDevice {
  id             String   @id @default(cuid())
  drawingId      String
  temporaryId    String
  tag            String?
  category       String
  description    String
  manufacturer   String?
  modelNumber    String?
  specifications Json
  confidence     Float
  evidence       Json
  reviewStatus   String
  quantity       Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  drawing        Drawing  @relation(fields: [drawingId], references: [id], onDelete: Cascade)
  occurrences    ComponentCandidate[]

  @@unique([drawingId, temporaryId])
  @@index([drawingId, reviewStatus])
}
```

Run: `DATABASE_URL=file:./data/dwg-electrical-test.db npx prisma db push && npm run db:generate`

Expected: schema synchronization and Prisma client generation succeed.

Update `resetTestDatabase()` to delete component candidates before physical devices, and physical devices before drawings.

- [ ] **Step 5: Persist groups and generate BOM from devices**

Implement:

```ts
export async function replacePhysicalDevices(
  drawingId: string,
  ownerScope: string,
  devices: PhysicalDeviceInput[],
): Promise<PhysicalDevice[]>;
```

Within a transaction, delete prior devices, create each device, and update matching components by `temporaryId` with `physicalDeviceId`. Change `generateBom` to group active physical devices by category, description, manufacturer, model, and specifications; use device count as quantity. Do not count multiple occurrences linked to one device more than once.

- [ ] **Step 6: Add repository persistence test**

Create three KM1 occurrences and one QF1 occurrence, persist groups, and assert the snapshot has two physical devices while retaining four components. Assert generated BOM total quantity is `2`, not `4`.

- [ ] **Step 7: Run focused tests and type checking**

Run: `npm test -- --run src/lib/devices/group.test.ts src/lib/repositories/domain.test.ts src/lib/bom.test.ts`

Expected: all listed tests PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma src/lib/devices/group.ts src/lib/devices/group.test.ts src/lib/domain.ts src/lib/repositories/components.ts src/lib/repositories/drawings.ts src/lib/repositories/domain.test.ts src/lib/bom.test.ts src/lib/db.ts
git commit -m "feat: separate symbols from physical devices"
```

---

### Task 5: Integrate Counts, Chinese UI, and One-Sheet Export

**Files:**
- Modify: `src/lib/analysis/service.ts`
- Modify: `src/lib/analysis/service.test.ts`
- Modify: `src/lib/presentation/component-list.ts`
- Modify: `src/lib/presentation/component-list.test.ts`
- Modify: `src/components/drawing-workspace.tsx`
- Modify: `src/components/drawing-workspace.test.ts`
- Modify: `src/lib/export.ts`
- Modify: `src/lib/export.test.ts`
- Modify: `src/app/api/drawings/[id]/exports/route.ts`
- Modify: `src/app/api/drawings/[id]/exports/route.test.ts`

**Interfaces:**
- Consumes: occurrences and physical devices from Tasks 3 and 4, analyzer diagnostics from Task 2.
- Produces: persisted separate counts, Chinese chat/workspace summaries, and one worksheet with two tables.

- [ ] **Step 1: Write failing service assertions for separate counts**

```ts
expect(result.components).toHaveLength(4);
expect(result.physicalDevices).toHaveLength(2);
expect(result.analysisDiagnostics.completedTiles).toBe(2);
expect(messages.find((message) => message.type === "component_results")?.payload).toMatchObject({
  symbolOccurrenceCount: 4,
  physicalDeviceCount: 2,
});
```

Add a partial-coverage fixture and assert the drawing summary warning contains `部分区域未完整扫描`.

- [ ] **Step 2: Run the service tests and verify missing device/diagnostic fields**

Run: `npm test -- --run src/lib/analysis/service.test.ts`

Expected: FAIL because analysis currently returns only components and BOM items.

- [ ] **Step 3: Integrate grouping and diagnostics in the service**

After consolidation:

```ts
const components = await replaceComponents(drawingId, ownerScope, componentInputs);
const deviceInputs = groupPhysicalDevices(components.filter((item) => !item.removedAt));
const physicalDevices = await replacePhysicalDevices(drawingId, ownerScope, deviceInputs);
const bom = await generateBom(drawingId, ownerScope);
```

Persist `symbolOccurrenceCount`, `physicalDeviceCount`, category counts, diagnostics, and warnings in the `component_results` message. Include coverage warnings in `drawing_summary`. Return `{ components, physicalDevices, bomItems, analysisDiagnostics }`.

- [ ] **Step 4: Update Chinese presentation**

Use Ant Design X `Prompts`, `Bubble`, and existing workspace primitives to show:

```text
符号实例：{symbolOccurrenceCount}
物理设备：{physicalDeviceCount}
待复核：{requiresReview}
未知符号：{unknown}
```

Rename the occurrence view to `符号清单`, retain `初步 BOM` for grouped devices, and display `扫描区域受限，结果可能不完整` whenever diagnostics indicate limited or failed tiles. Do not add a new generic-div chat system or unrelated CSS.

- [ ] **Step 5: Write failing workbook tests**

```ts
const sheet = workbook.getWorksheet("元件分析清单")!;
expect(sheet.getCell("A1").value).toBe("符号实例清单");
expect(findCell(sheet, "物理设备与初步 BOM")).toBeTruthy();
expect(findCell(sheet, "KM1-coil")).toBeTruthy();
expect(findCell(sheet, "device-KM1")).toBeTruthy();
expect(findCell(sheet, 1)).toBeTruthy();
```

- [ ] **Step 6: Build both tables in one worksheet**

Change the workbook input to:

```ts
buildComponentWorkbook({ drawingId, filename, components, physicalDevices, bomItems, analysisWarnings })
```

Write a title and verification warning, then the symbol-occurrence table with `物理设备 ID` and `物理设备标签` columns. After two blank rows, write the `物理设备与初步 BOM` heading and a grouped table containing device ID, tag, category, description, manufacturer, model, specifications, linked symbol count, purchasing quantity, confidence, review status, and evidence. Apply filters only to the occurrence header range and preserve formula-injection escaping.

- [ ] **Step 7: Run focused tests and checks**

Run: `npm test -- --run src/lib/analysis/service.test.ts src/lib/presentation/component-list.test.ts src/components/drawing-workspace.test.ts src/lib/export.test.ts src/app/api/drawings/[id]/exports/route.test.ts`

Expected: all listed tests PASS.

Run: `npm run typecheck && npm run lint`

Expected: both commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/analysis/service.ts src/lib/analysis/service.test.ts src/lib/presentation/component-list.ts src/lib/presentation/component-list.test.ts src/components/drawing-workspace.tsx src/components/drawing-workspace.test.ts src/lib/export.ts src/lib/export.test.ts src/app/api/drawings/[id]/exports/route.ts src/app/api/drawings/[id]/exports/route.test.ts
git commit -m "feat: show symbol and physical device counts"
```

---

### Task 6: Deterministic and Real-DWG Verification

**Files:**
- Modify: `scripts/smoke-real-dxf.ts`
- Modify: `scripts/smoke-real-dwg.ts`
- Modify: `package.json` only if a script name must be corrected.

**Interfaces:**
- Consumes: the complete adaptive analysis pipeline.
- Produces: machine-readable smoke metrics and a verified browser/API demonstration path.

- [ ] **Step 1: Update the deterministic smoke output**

Both smoke commands must print:

```ts
{
  source: sourcePath,
  analysisTiles: rendered.tiles.length,
  coverageLimited: rendered.metadata?.coverageLimited ?? false,
  rawDetections: result.analysisDiagnostics.rawDetectionCount,
  symbolOccurrences: components.length,
  physicalDevices: devices.length,
  categories: categoryCounts,
  failedTiles: result.analysisDiagnostics.failedTiles,
}
```

`smoke-real-dwg.ts` must accept `DWG_SMOKE_SOURCE`, otherwise use `data/smoke/source.dwg`. It must validate an existing genuine `AC10` DWG, run the real `dwg2dxf` converter and renderer, and must not call experimental `dxf2dwg`.

- [ ] **Step 2: Run focused smoke prerequisites**

Run: `dwg2dxf --version`

Expected: LibreDWG version output and exit 0.

Run: `DWG_SMOKE_SOURCE=data/smoke/source.dwg npm run smoke:dwg`

Expected: JSON with `analysisTiles > 0`, `symbolOccurrences >= 0`, `physicalDevices >= 0`, and no unhandled error. If the source has visible electrical content, require `symbolOccurrences > 0`.

- [ ] **Step 3: Run the API end-to-end flow**

Against `http://localhost:3001`:

1. Create a new conversation.
2. Upload a genuine DWG.
3. Start analysis.
4. Poll until `requires_review` or `completed`.
5. Fetch the drawing snapshot and assert symbol/device counts are present.
6. Export XLSX and verify its MIME type and non-zero size.
7. Reopen the conversation and verify persisted messages and edits.

Expected: every request succeeds; no API key or stack trace appears in responses.

- [ ] **Step 4: Inspect the browser workflow**

Open `http://localhost:3001`, create `新建分析`, upload the genuine DWG, and verify:

- progress advances by actual job stages;
- symbol and physical-device counts are visibly distinct;
- category lists contain every persisted symbol occurrence;
- selecting a symbol focuses its marker;
- BOM quantities use physical devices;
- the coverage warning appears when limits are forced;
- the downloaded one-sheet workbook contains both tables.

- [ ] **Step 5: Run full verification**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run lint`

Expected: exit 0.

Run: `npm run build`

Expected: production build succeeds.

- [ ] **Step 6: Commit smoke changes**

```bash
git add scripts/smoke-real-dxf.ts scripts/smoke-real-dwg.ts package.json
git commit -m "test: verify exhaustive DWG component analysis"
```

---

## Completion Notes

Record the tested DWG filename, tile count, raw detection count, reconciled symbol count, physical-device count, category totals, failed regions, elapsed time, model identifier, and Excel file size. Do not describe the analyzer as universally accurate; report the measured fixture results and remaining engineer-review requirement.
