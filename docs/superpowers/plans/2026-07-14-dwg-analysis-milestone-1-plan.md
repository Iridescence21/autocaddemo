# DWG Electrical Drawing Analysis — Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a new Next.js project that accepts one validated DWG, persists a private drawing and asynchronous analysis job, runs a provider-neutral native-entity extractor in a separate worker process, deterministically classifies fixture/native candidates with evidence, and exposes status plus results in the browser.

**Architecture:** Next.js App Router serves the upload UI and typed API routes. Prisma 7 with the libSQL SQLite adapter persists `Drawing`, `AnalysisJob`, `RawCadExtraction`, and `ComponentCandidate`; filesystem storage keeps uploaded files under `data/uploads` outside `public`. The web process creates queued jobs and spawns a separate Node worker; the worker uses the `CadExtractor` interface, a fixture provider selected by an explicit test marker, and a deterministic component classifier. A future LibreDWG/WebAssembly or ODA provider plugs into the same interface without AutoCAD desktop.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Prisma 7, SQLite via `@libsql/client` and `@prisma/adapter-libsql`, Vitest, tsx, and browser verification with the in-app browser.

## Global Constraints

- Accept `.dwg` only in Milestone 1; do not add `.dxf` support.
- Keep uploads private under `data/uploads`; never place raw uploads in `public`.
- Do not parse CAD bytes in the web request process; extraction runs from `npm run worker` or a spawned worker process.
- Preserve AutoCAD handles in normalized entities and keep raw extraction separate from future component/BOM models.
- Fixture extraction must be explicit and must never be presented as facts extracted from an arbitrary DWG.
- AutoCAD desktop and AutoCAD automation APIs must not be required.
- Component classification must use a controlled category enum and persist confidence, method, evidence, source handles, and review status.
- Every API input is runtime validated and every response error uses a stable safe code/message.
- Do not modify the existing repositories.
- Use test-first implementation for validation, normalization, persistence, and job transitions.

---

### Task 1: Scaffold the standalone project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`

**Interfaces:**
- Produces the runnable Next.js, Vitest, and TypeScript environment used by every later task.

- [ ] **Step 1: Write package and compiler configuration**

Use Next 16, React 19, Prisma 7, `@libsql/client`, `@prisma/adapter-libsql`, `@prisma/client`, `zod`, Vitest, and tsx. Add scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `db:generate`, `db:push`, and `worker`.

- [ ] **Step 2: Install dependencies and generate the Prisma client**

Run:

```bash
npm install
npm run db:generate
```

Expected: dependency installation and Prisma client generation succeed without modifying any other repository.

- [ ] **Step 3: Run the empty app checks**

Run:

```bash
npm run typecheck
npm test -- --run
```

Expected: both commands exit 0 before feature code exists.

- [ ] **Step 4: Commit the standalone scaffold**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts vitest.config.ts .gitignore .env.example src/app/layout.tsx src/app/globals.css
git commit -m "chore: scaffold DWG analysis app"
```

### Task 2: Define persisted entities and repository access

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma.config.ts`
- Create: `src/lib/db.ts`
- Create: `src/lib/drawings/domain.ts`
- Create: `src/lib/drawings/repository.ts`
- Test: `src/lib/drawings/repository.test.ts`

**Interfaces:**
- `DrawingStatus = "uploaded" | "failed"`
- `AnalysisJobStatus = "queued" | "extracting" | "generating_results" | "requires_review" | "completed" | "failed"`
- `DrawingRepository.createQueuedDrawing(input): Promise<{ drawingId: string; jobId: string }>`
- `DrawingRepository.getAuthorizedDrawing(drawingId, ownerScope): Promise<DrawingRecord | null>`
- `DrawingRepository.claimQueuedJob(drawingId, jobId): Promise<boolean>`
- `DrawingRepository.updateJob(jobId, patch): Promise<void>`
- `DrawingRepository.saveExtraction(jobId, extraction): Promise<void>`

- [ ] **Step 1: Write failing repository tests**

Cover atomic creation of one drawing/job, owner-scope filtering, idempotent claim (first call true, second false), job update persistence, and extraction persistence.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run `npm test -- src/lib/drawings/repository.test.ts --run`. Expected: FAIL because schema and repository functions are absent.

- [ ] **Step 3: Add the Prisma schema and client**

Create `Drawing`, `AnalysisJob`, and `RawCadExtraction` with stable IDs, original filename, sanitized name, storage key, MIME, byte size, owner scope, status, progress, stage message, retry count, error fields, idempotency key, timestamps, and the extraction JSON/version.

- [ ] **Step 4: Implement repository methods**

Use a transaction for drawing/job creation. Use an atomic conditional update for job claim. Scope every read by `ownerScope`. Store extraction JSON only after the worker reaches `generating_results`.

- [ ] **Step 5: Push the local schema and rerun tests**

Run `npm run db:push && npm test -- src/lib/drawings/repository.test.ts --run`. Expected: PASS.

- [ ] **Step 6: Commit the persistence boundary**

```bash
git add prisma prisma.config.ts src/lib/db.ts src/lib/drawings/domain.ts src/lib/drawings/repository.ts src/lib/drawings/repository.test.ts
git commit -m "feat: persist drawings and analysis jobs"
```

### Task 3: Add DWG validation and private storage

**Files:**
- Create: `src/lib/drawings/validation.ts`
- Create: `src/lib/drawings/storage.ts`
- Test: `src/lib/drawings/validation.test.ts`
- Test: `src/lib/drawings/storage.test.ts`
- Create: `fixtures/drawings/structured.dwg`
- Create: `fixtures/drawings/mixed.dwg`
- Create: `fixtures/drawings/exploded.dwg`
- Create: `fixtures/drawings/malformed.dwg`

**Interfaces:**
- `validateDwgFile(input): ValidatedUpload | UploadValidationError`
- `storeUpload(input): Promise<{ storageKey: string; byteSize: number }>`
- `MAX_UPLOAD_BYTES` defaults to `25 * 1024 * 1024` and can be overridden by an environment variable.

- [ ] **Step 1: Write failing validation tests**

Test a valid `AC1027` fixture marker, wrong extension, wrong MIME, empty file, oversized file, unsafe filename, and malformed header. Assert stable error codes and no path traversal.

- [ ] **Step 2: Run focused validation tests**

Run `npm test -- src/lib/drawings/validation.test.ts --run`. Expected: FAIL.

- [ ] **Step 3: Implement validation and storage**

Require exactly one file, sanitize the display name to a basename, inspect the first bytes for a supported DWG signature, enforce the byte limit, and write to `data/uploads/<drawingId>/<safeName>` with exclusive directory creation.

- [ ] **Step 4: Run validation and storage tests**

Run `npm test -- src/lib/drawings/validation.test.ts src/lib/drawings/storage.test.ts --run`. Expected: PASS.

- [ ] **Step 5: Commit secure upload primitives**

```bash
git add src/lib/drawings/validation.ts src/lib/drawings/storage.ts src/lib/drawings/validation.test.ts src/lib/drawings/storage.test.ts fixtures/drawings
git commit -m "feat: validate and privately store DWG uploads"
```

### Task 4: Implement the normalized extraction contract and provider adapters

**Files:**
- Create: `src/lib/cad/types.ts`
- Create: `src/lib/cad/normalization.ts`
- Create: `src/lib/cad/fixture-extractor.ts`
- Create: `src/lib/cad/real-extractor.ts`
- Create: `src/lib/cad/registry.ts`
- Create: `fixtures/extractions/structured.json`
- Create: `fixtures/extractions/mixed.json`
- Create: `fixtures/extractions/exploded.json`
- Test: `src/lib/cad/normalization.test.ts`
- Test: `src/lib/cad/fixture-extractor.test.ts`

**Interfaces:**
- `interface CadExtractor { extract(input: CadExtractionInput): Promise<CadExtractionResult>; }`
- `CadExtractionInput = { drawingId: string; storageKey: string; originalFilename: string }`
- `CadExtractionResult = { schemaVersion: 1; metadata; layouts; layers; blockDefinitions; blockReferences; entities }`
- Every entity contains `entityId`, `handle`, `entityType`, `layer`, `layout`, `boundingBox`, `geometry`, and `source.drawingId`.
- `real-extractor.ts` exposes the non-AutoCAD provider slot and returns `REAL_EXTRACTOR_NOT_CONFIGURED` until LibreDWG/WebAssembly or ODA is installed; it must not silently select fixtures.

- [ ] **Step 1: Write failing fixture and normalization tests**

Assert that structured fixtures preserve attributed block references, mixed fixtures preserve both block and primitive entities, exploded fixtures preserve lines/arcs/circles/text, and malformed/unknown markers return a safe `FIXTURE_NOT_FOUND` error. Assert stable IDs and handle preservation.

- [ ] **Step 2: Run focused extraction tests**

Run `npm test -- src/lib/cad/normalization.test.ts src/lib/cad/fixture-extractor.test.ts --run`. Expected: FAIL.

- [ ] **Step 3: Implement schemas and normalization**

Use Zod to validate fixture JSON at the adapter boundary. Normalize missing optional collections to empty arrays, reject duplicate entity IDs/handles, and preserve all source handles without converting the output into UI or component models.

- [ ] **Step 4: Implement the fixture extractor and registry**

Read only the first bounded header window from the stored file. Select a fixture only when the explicit marker `DWG-ELECTRICAL-FIXTURE:<name>` is present. Otherwise return `REAL_EXTRACTOR_NOT_CONFIGURED`; never fall back to a fixture by filename alone.

- [ ] **Step 5: Run extraction tests**

Run `npm test -- src/lib/cad/normalization.test.ts src/lib/cad/fixture-extractor.test.ts --run`. Expected: PASS.

- [ ] **Step 6: Commit the extraction boundary**

```bash
git add src/lib/cad fixtures/extractions
git commit -m "feat: add normalized CAD extractor contract"
```

### Task 5: Add deterministic component classification

**Files:**
- Create: `src/lib/components/types.ts`
- Create: `src/lib/components/rules.ts`
- Create: `src/lib/components/classifier.ts`
- Create: `src/lib/components/classifier.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/drawings/repository.ts`

**Interfaces:**
- `ComponentCategory` is a controlled enum containing the initial electrical categories used by the classifier plus `unknown_electrical_symbol`.
- `classifyComponents(extraction): ComponentCandidateInput[]`
- Each candidate has `category`, `confidence`, `method`, `evidence[]`, `sourceEntityHandles[]`, and `reviewStatus`.

- [ ] **Step 1: Write failing classifier tests**

Cover attributed blocks named `QF1`, `FU1`, `KM1`, `KA1`, `XT1`, `M1`, `S1`, `PB1`, `H1`, and `PE`; assert controlled category, source handles, method, and confidence. Cover exploded line/circle candidates and an unknown candidate. Assert high-confidence mappings become `confirmed`, medium-confidence matches become `requires_review`, and low-confidence candidates become `unknown`.

- [ ] **Step 2: Run classifier tests**

Run `npm test -- src/lib/components/classifier.test.ts --run`. Expected: FAIL.

- [ ] **Step 3: Add the component candidate model and rules**

Persist original category/confidence/method/evidence JSON, source handles, review status, optional corrected category, and drawing/job relations. Keep regex mappings configurable in `src/lib/components/rules.ts`.

- [ ] **Step 4: Implement block-first and geometry-fallback classification**

Use block attributes/name patterns first, then geometry signatures and nearby text. Never invent manufacturer, model, or catalog data. Emit `unknown_electrical_symbol` when no rule meets the threshold.

- [ ] **Step 5: Run classifier and persistence tests**

Run `npm run db:push && npm test -- src/lib/components/classifier.test.ts src/lib/drawings/repository.test.ts --run`. Expected: PASS.

- [ ] **Step 6: Commit component determination**

```bash
git add prisma/schema.prisma src/lib/components src/lib/drawings/repository.ts
git commit -m "feat: classify electrical component candidates"
```

### Task 6: Implement the worker and upload/status APIs

**Files:**
- Create: `src/lib/drawings/analysis-worker.ts`
- Create: `src/worker.ts`
- Create: `src/app/api/drawings/route.ts`
- Create: `src/app/api/drawings/[drawingId]/route.ts`
- Create: `src/app/api/drawings/[drawingId]/analyze/route.ts`
- Create: `src/app/api/drawings/[drawingId]/entities/route.ts`
- Create: `src/app/api/drawings/[drawingId]/components/route.ts`
- Test: `src/lib/drawings/analysis-worker.test.ts`
- Test: `src/app/api/drawings/route.test.ts`

**Interfaces:**
- `runAnalysisJob(jobId, deps): Promise<void>`
- `POST /api/drawings` → `201 { drawingId, jobId, status: "queued" }`
- `GET /api/drawings/:drawingId` → drawing/job summary
- `POST /api/drawings/:drawingId/analyze` → `202 { jobId, status }`
- `GET /api/drawings/:drawingId/entities` → `{ extraction }`
- `GET /api/drawings/:drawingId/components` → `{ components }`

- [ ] **Step 1: Write failing worker tests**

Cover queued → extracting → generating_results → completed with extraction, missing provider → failed with `REAL_EXTRACTOR_NOT_CONFIGURED`, retry-safe claim, and no leaked stack/path in persisted error messages.

- [ ] **Step 2: Run worker tests**

Run `npm test -- src/lib/drawings/analysis-worker.test.ts --run`. Expected: FAIL.

- [ ] **Step 3: Implement the worker**

Claim only queued jobs, update stage/progress at each boundary, invoke the registry adapter, save the normalized JSON, and mark the drawing completed or failed. Make repeated invocation a no-op after claim.

- [ ] **Step 4: Implement the upload route**

Parse multipart form data, reject more than one file, validate/store the file, create records, and return safe JSON. Do not invoke extraction in this route.

- [ ] **Step 5: Implement analyze spawning and read routes**

The analyze route claims via the repository and spawns the standalone worker entry point with a drawing/job ID; it returns 202 immediately. Read routes validate UUIDs, scope ownership to `demo-user`, and return 404 for inaccessible drawings.

- [ ] **Step 6: Add API tests and run the focused suite**

Run `npm test -- src/lib/drawings/analysis-worker.test.ts src/app/api/drawings/route.test.ts --run`. Expected: PASS.

- [ ] **Step 7: Commit the API and worker**

```bash
git add src/lib/drawings/analysis-worker.ts src/worker.ts src/app/api/drawings
git commit -m "feat: add asynchronous DWG analysis APIs"
```

### Task 7: Build the upload and analysis-status UI

**Files:**
- Create: `src/app/page.tsx`
- Create: `src/components/drawing-upload.tsx`
- Create: `src/components/analysis-status.tsx`
- Create: `src/components/raw-entity-list.tsx`
- Create: `src/components/component-list.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- `DrawingUpload` reports upload progress and passes the created `drawingId` to `AnalysisStatus`.
- `AnalysisStatus` polls `GET /api/drawings/:drawingId` until terminal status, exposes retry, and renders candidate counts, confidence/review labels, and raw entities.

- [ ] **Step 1: Write a component-level test for state rendering**

Assert that queued, processing, failed, completed, and no-entity states have visible, non-secret explanatory text and that a failed job exposes a retry action.

- [ ] **Step 2: Run the UI test to verify it fails**

Run `npm test -- src/components/analysis-status.test.tsx --run`. Expected: FAIL until the component exists.

- [ ] **Step 3: Implement the minimal UI**

Use existing browser APIs for upload progress and polling. Show file name, byte progress, job stage, status, normalized entity count, handle/entity type/layer/layout, and the explicit fixture/provider limitation. Keep the visual system compact and focused on the vertical slice.

- [ ] **Step 4: Run UI tests and typecheck**

Run `npm test -- src/components/analysis-status.test.tsx --run && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit the UI**

```bash
git add src/app/page.tsx src/components src/app/globals.css
git commit -m "feat: add DWG upload and analysis status UI"
```

### Task 8: Verify the complete milestone and document limitations

**Files:**
- Create: `docs/MILESTONE-1.md`
- Create: `tests/e2e/dwg-upload.spec.ts`

- [ ] **Step 1: Start the local app and worker**

Run:

```bash
npm run db:push
npm run dev
```

Run the worker command separately when verifying non-spawned processing:

```bash
npm run worker -- --once
```

- [ ] **Step 2: Run the full automated checks**

Run `npm test -- --run`, `npm run typecheck`, `npm run lint`, and `npm run build`. Expected: all exit 0.

- [ ] **Step 3: Verify the browser flow**

Use the in-app browser to upload `fixtures/drawings/structured.dwg`, observe byte progress and queued/processing states, inspect normalized entity handles, and retry a malformed/provider-unconfigured file. Capture the actual UI states, not just API responses.

- [ ] **Step 4: Add the E2E flow**

The test uploads the structured fixture, waits for a completed or explicit provider-limitation state, checks status text and source handles, and verifies that a malformed upload shows a safe validation error.

- [ ] **Step 5: Write the milestone report**

Record architecture, files, data model, API routes, commands, test results, browser evidence, and known limitations. State clearly that this milestone does not yet perform arbitrary DWG parsing or electrical symbol recognition.

- [ ] **Step 6: Commit verification artifacts**

```bash
git add docs/MILESTONE-1.md tests/e2e/dwg-upload.spec.ts
git commit -m "test: verify DWG upload milestone"
```
