# Real DXF Vision Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze an uploaded, non-fixture ASCII DXF through a native renderer and a validated server-side OpenAI vision request, then persist and display a Chinese categorized component list and preliminary BOM.

**Architecture:** Keep CAD rendering and model analysis behind replaceable interfaces. Parse DXF entities into a normalized context, rasterize a bounded overview and four overlapping tiles, send those images and CAD context to the OpenAI Responses API, validate and consolidate detections, and reuse the existing repositories for persistence and exports. Preserve the fixture-backed DWG demo path while failing unfamiliar DWG files honestly until a real DWG renderer is configured.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Ant Design X 2.8, Prisma/SQLite, Vitest, Zod 4, `dxf-parser`, `sharp`, OpenAI Responses API.

## Global Constraints

- All model calls are server-side; never expose `OPENAI_API_KEY` to the browser.
- The default model is `gpt-5.6-terra`, configurable with `OPENAI_VISION_MODEL`.
- Real DXF failures never fall back to prepared fixture detections.
- AI classifications remain `requires_review`; unknown detections remain `unknown` until an engineer edits or confirms them.
- Every persisted component has a confidence, method, evidence, source tile, and normalized location.
- User-facing UI and analysis messages are Simplified Chinese; code identifiers and controlled enums remain English.
- The chat interaction layer uses Ant Design X components and the approved independent-chat layout; no standalone custom stylesheet is introduced.
- Automated tests never require a secret or consume model quota.

---

### Task 1: DXF parser and normalized CAD context

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `fixtures/cad/synthetic-control-panel.dxf`
- Create: `src/lib/cad/dxf-types.ts`
- Create: `src/lib/cad/dxf-parser.ts`
- Test: `src/lib/cad/dxf-parser.test.ts`

**Interfaces:**
- Consumes: an ASCII DXF source path.
- Produces: `parseDxfFile(sourcePath: string): Promise<NormalizedDxfDrawing>` and `parseDxfText(source: string): NormalizedDxfDrawing`.

- [ ] **Step 1: Install rendering dependencies**

Run: `npm install dxf-parser sharp`

Expected: `package.json` and `package-lock.json` contain both dependencies.

- [ ] **Step 2: Add a real synthetic DXF fixture and failing parser test**

Create a minimal ASCII DXF with a LINE wire, CIRCLE symbol, TEXT tag `KM1`, layer names, and a block definition/reference. Assert:

```ts
const drawing = await parseDxfFile(fixturePath);
expect(drawing.entities.some((entity) => entity.type === "LINE")).toBe(true);
expect(drawing.texts.map((text) => text.value)).toContain("KM1");
expect(drawing.layers).toContain("WIRE");
expect(drawing.blockNames).toContain("CONTACTOR_COIL");
expect(drawing.extents.maxX).toBeGreaterThan(drawing.extents.minX);
```

- [ ] **Step 3: Run the parser test to verify failure**

Run: `npm test -- src/lib/cad/dxf-parser.test.ts`

Expected: FAIL because `@/lib/cad/dxf-parser` does not exist.

- [ ] **Step 4: Implement normalization**

Define normalized geometry as discriminated records containing `type`, `layer`, source handle, points/center/radius/text as appropriate. Parse LINE, LWPOLYLINE/POLYLINE, CIRCLE, ARC, ELLIPSE, TEXT, MTEXT, and INSERT records, collect layer/block/text context, calculate finite extents, and report unsupported entity kinds in `warnings` without throwing.

- [ ] **Step 5: Run the focused test**

Run: `npm test -- src/lib/cad/dxf-parser.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json fixtures/cad/synthetic-control-panel.dxf src/lib/cad/dxf-types.ts src/lib/cad/dxf-parser.ts src/lib/cad/dxf-parser.test.ts
git commit -m "feat: parse and normalize DXF drawings"
```

### Task 2: SVG/PNG overview and overlapping tiles

**Files:**
- Modify: `src/lib/cad/types.ts`
- Create: `src/lib/cad/dxf-svg.ts`
- Create: `src/lib/cad/dxf-renderer.ts`
- Test: `src/lib/cad/dxf-renderer.test.ts`

**Interfaces:**
- Consumes: `NormalizedDxfDrawing` from Task 1.
- Produces: `renderDxfSvg(drawing, options): DxfSvgRenderResult` and `dxfRenderer: CadRenderAdapter`.

- [ ] **Step 1: Write the failing rendering test**

Assert the SVG contains line, circle, and escaped text, then assert `dxfRenderer.render(...)` returns a PNG data URL, positive dimensions, exactly four tiles, tile IDs and overview-coordinate metadata, and non-empty PNG tile data URLs.

- [ ] **Step 2: Run the test to verify failure**

Run: `npm test -- src/lib/cad/dxf-renderer.test.ts`

Expected: FAIL because the renderer modules do not exist.

- [ ] **Step 3: Implement the SVG coordinate transform**

Map CAD extents to a bounded viewport with padding, preserve aspect ratio, invert Y for screen coordinates, escape all text, apply INSERT translation/rotation/scale, and render supported entities with dark strokes on a light background. Include normalized DXF context in `RenderedCadDrawing.metadata.context`.

- [ ] **Step 4: Implement PNG and tile generation**

Use `sharp` to rasterize the overview to a maximum 2048-pixel side. Generate a 2×2 grid with 96-pixel overlap, encode overview and tile buffers as `data:image/png;base64,...`, and retain each tile's overview pixel bounds.

- [ ] **Step 5: Run renderer tests and typecheck**

Run: `npm test -- src/lib/cad/dxf-renderer.test.ts && npm run typecheck`

Expected: PASS for both commands.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cad/types.ts src/lib/cad/dxf-svg.ts src/lib/cad/dxf-renderer.ts src/lib/cad/dxf-renderer.test.ts
git commit -m "feat: render DXF overview and analysis tiles"
```

### Task 3: Strict vision schema and OpenAI request adapter

**Files:**
- Create: `src/lib/vision/types.ts`
- Create: `src/lib/vision/schema.ts`
- Create: `src/lib/vision/openai-analyzer.ts`
- Test: `src/lib/vision/openai-analyzer.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `RenderedCadDrawing` with DXF context.
- Produces: `DrawingVisionAnalyzer.analyze(input): Promise<ValidatedVisionResult>`, `createOpenAiVisionAnalyzer(options?)`, and stable `VisionAnalysisError.code` values.

- [ ] **Step 1: Write failing request/validation tests**

Use an injected fake `fetch` to assert that the request targets `/responses`, includes `gpt-5.6-terra`, one input text part, overview/tile `input_image` parts, `text.format.type === "json_schema"`, controlled categories, extracted `KM1` context, and `store: false`. Add tests proving malformed output retries once then throws `AI_RESPONSE_INVALID`, and missing key throws `AI_NOT_CONFIGURED` without issuing a request.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/lib/vision/openai-analyzer.test.ts`

Expected: FAIL because the vision modules do not exist.

- [ ] **Step 3: Define the schema and stable errors**

Create a Zod schema that constrains category to `COMPONENT_CATEGORIES`, confidence and normalized box values to 0..1, nullable manufacturer/model fields, evidence/specification arrays, and warnings. Export the equivalent strict JSON Schema used in the Responses request. Define `VisionAnalysisError` with `AI_NOT_CONFIGURED`, `AI_TIMEOUT`, `AI_PROVIDER_ERROR`, and `AI_RESPONSE_INVALID` codes plus sanitized Chinese messages.

- [ ] **Step 4: Implement the Responses API adapter**

Build the request from the overview, tiles, and normalized CAD context. Use `OPENAI_API_KEY`, `OPENAI_VISION_MODEL`, `OPENAI_BASE_URL`, and `OPENAI_TIMEOUT_MS`; extract `output_text` from the response; parse JSON; validate with Zod; retry one invalid payload; and never log request authorization or raw secrets.

- [ ] **Step 5: Add environment documentation and run tests**

Append:

```dotenv
OPENAI_API_KEY=
OPENAI_VISION_MODEL=gpt-5.6-terra
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_TIMEOUT_MS=120000
```

Run: `npm test -- src/lib/vision/openai-analyzer.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .env.example src/lib/vision/types.ts src/lib/vision/schema.ts src/lib/vision/openai-analyzer.ts src/lib/vision/openai-analyzer.test.ts
git commit -m "feat: add validated OpenAI vision adapter"
```

### Task 4: Tile-coordinate consolidation and component mapping

**Files:**
- Create: `src/lib/vision/consolidate.ts`
- Test: `src/lib/vision/consolidate.test.ts`

**Interfaces:**
- Consumes: `ValidatedVisionResult`, overview size, and `CadDrawingTile[]`.
- Produces: `consolidateVisionComponents(result, rendered): ComponentInput[]`.

- [ ] **Step 1: Write failing overlap tests**

Create two detections of `KM1` in overlapping tiles that map to the same overview box and assert they become one component with merged evidence and a comma-separated source-tile audit value. Create two adjacent breakers and assert they remain two components. Assert every output is `requires_review` except unknown category outputs use `unknown`, method is `openai_vision`, and manufacturer/model stay null when absent.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/lib/vision/consolidate.test.ts`

Expected: FAIL because the consolidation module does not exist.

- [ ] **Step 3: Implement coordinate conversion and conservative merging**

Convert tile-normalized boxes through tile pixel bounds into overview-normalized boxes. Merge compatible categories when IoU is greater than 0.45 or centers fall within a size-relative tolerance; retain the highest-confidence category/description, union evidence/specifications/source tile IDs, and calculate the union location.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/lib/vision/consolidate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vision/consolidate.ts src/lib/vision/consolidate.test.ts
git commit -m "feat: consolidate tiled component detections"
```

### Task 5: Real DXF analysis pipeline integration

**Files:**
- Modify: `src/lib/cad/registry.ts`
- Modify: `src/lib/analysis/service.ts`
- Modify: `src/app/api/drawings/[id]/analyze/route.ts`
- Modify: `src/lib/analysis/service.test.ts`
- Create: `src/lib/analysis/real-dxf.integration.test.ts`

**Interfaces:**
- Consumes: `dxfRenderer`, `DrawingVisionAnalyzer`, `consolidateVisionComponents`.
- Produces: `runDrawingAnalysis(drawingId, ownerScope, overrides?)` while retaining `runDemoAnalysis` as a compatibility alias for existing tests.

- [ ] **Step 1: Write failing pipeline tests**

Upload/use the synthetic DXF, inject a fake analyzer result with duplicate tile detections, run analysis with zero delay, and assert one consolidated component, a generated BOM item, Chinese progress messages, categorized result payload, and final `requires_review`. Add a missing-key route/service test that asserts status `failed`, stable code `AI_NOT_CONFIGURED`, and a Chinese sanitized assistant error.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/lib/analysis/service.test.ts src/lib/analysis/real-dxf.integration.test.ts`

Expected: FAIL because the service still uses the fixture analyzer directly.

- [ ] **Step 3: Select pipeline adapters honestly**

Route `sourceType === "dxf"` to the native DXF renderer and OpenAI analyzer. Route the prepared DWG marker to the demo adapter. Throw `DWG_RENDERER_NOT_CONFIGURED` for unfamiliar DWG input instead of inventing results. Keep dependency overrides available for deterministic tests.

- [ ] **Step 4: Persist validated consolidated results**

Update job stages in Chinese, persist preview and components, regenerate the BOM, append drawing summary/component/BOM messages, and convert known errors to stable sanitized Chinese messages. Component result payloads include a complete categorized markdown/list representation so the transcript survives reload.

- [ ] **Step 5: Run integration tests**

Run: `npm test -- src/lib/analysis/service.test.ts src/lib/analysis/real-dxf.integration.test.ts src/lib/bom.test.ts src/lib/export.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cad/registry.ts src/lib/analysis/service.ts src/app/api/drawings/[id]/analyze/route.ts src/lib/analysis/service.test.ts src/lib/analysis/real-dxf.integration.test.ts
git commit -m "feat: run real DXF vision analysis jobs"
```

### Task 6: Chinese categorized results and Ant Design X chatbox

**Files:**
- Create: `src/lib/presentation/component-list.ts`
- Test: `src/lib/presentation/component-list.test.ts`
- Modify: `src/components/drawing-workspace.tsx`
- Create: `src/components/drawing-workspace.test.tsx`

**Interfaces:**
- Consumes: active `Component[]`, persisted result payloads, conversation/job snapshots.
- Produces: `groupComponentsForDisplay(components)` and `formatCategorizedComponents(components)` plus the Chinese Ant Design X workspace.

- [ ] **Step 1: Write failing presentation tests**

Assert stable Chinese category order, every active component appears exactly once, removed components do not appear, unknown symbols are grouped under `未知元件（需工程师复核）`, null manufacturer/model render as `图纸中未显示`, and confidence/review text is visible.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/lib/presentation/component-list.test.ts`

Expected: FAIL because the presentation module does not exist.

- [ ] **Step 3: Implement categorized list formatting**

Create an exhaustive Chinese label map for `COMPONENT_CATEGORIES`, a stable category order, grouped records for structured rendering, and Markdown that lists tag/stable identifier, category, description, specifications, confidence percentage, and review status.

- [ ] **Step 4: Refactor the workspace to the approved chat style**

Use `XProvider`, `Conversations`, `Welcome`, `Prompts`, `Bubble.List`, `Sender`, `Sender.Header`, `Attachments`, `FileCard`, `ThoughtChain`, `Actions`, and `XMarkdown`. Match the independent example's 280-pixel conversation rail and centered approximately 700-pixel transcript/composer; move drawing/components/BOM/review into contextual Ant Design X prompt/result content instead of a permanent third custom panel. Translate every user-facing label, error, placeholder, stage, action, and warning into Simplified Chinese while keeping assistant replies safe Markdown.

- [ ] **Step 5: Add shell behavior tests**

Render the workspace with mocked fetch responses and assert the Chinese welcome, new-analysis action, file accept types, engineer-verification warning, categorized component text, and responsive drawer/result trigger are present without importing a second chat library.

- [ ] **Step 6: Run UI tests and checks**

Run: `npm test -- src/lib/presentation/component-list.test.ts src/components/drawing-workspace.test.tsx && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/presentation/component-list.ts src/lib/presentation/component-list.test.ts src/components/drawing-workspace.tsx src/components/drawing-workspace.test.tsx
git commit -m "feat: show Chinese categorized analysis results"
```

### Task 7: End-to-end verification and operator handoff

**Files:**
- Modify: `README.md` if present, otherwise create it
- Create: `scripts/smoke-real-dxf.ts`
- Modify: `package.json`
- Test: all existing and new tests

**Interfaces:**
- Consumes: the complete upload/analysis/edit/BOM/export workflow.
- Produces: `npm run smoke:dxf` opt-in live smoke command and documented setup.

- [ ] **Step 1: Add a key-gated live smoke script**

The script exits with a clear setup message when `OPENAI_API_KEY` is absent. When present, it runs the native parser/renderer/analyzer against `fixtures/cad/synthetic-control-panel.dxf`, validates at least one result or a valid zero-result response, prints counts without printing the key or raw authorization, and exits nonzero on provider/schema failures.

- [ ] **Step 2: Document setup and limitations**

Document `cp .env.example .env.local`, server-only key placement, `npm run dev`, fixture demo behavior, real DXF behavior, current unsupported unfamiliar DWG boundary, preliminary engineer-review requirement, and the opt-in `npm run smoke:dxf` quota warning.

- [ ] **Step 3: Run the complete automated verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Inspect the browser workflow**

Run `npm run dev`, open the local app, create a Chinese conversation, attach the synthetic DXF, verify the explicit missing-key failure is Chinese and retryable, then use the prepared DWG fixture to verify upload, progress, categorized list, correction, BOM generation, CSV export, and persistence after reload. Inspect desktop and narrow viewport layouts.

- [ ] **Step 5: Run live smoke only when the user supplies the key**

Run: `npm run smoke:dxf`

Expected with key: a validated real model response and no leaked secret. Expected before key: a clean setup message and no network request.

- [ ] **Step 6: Commit**

```bash
git add README.md scripts/smoke-real-dxf.ts package.json package-lock.json
git commit -m "test: verify DXF analysis workflow"
```
