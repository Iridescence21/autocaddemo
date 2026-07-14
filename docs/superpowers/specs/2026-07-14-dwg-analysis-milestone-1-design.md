# DWG Electrical Drawing Analysis — Milestone 1 Design

## Goal

Create a new, isolated project that proves the first vertical slice of the
electrical-drawing workflow: a user uploads one `.dwg`, the file is validated
and stored privately, an asynchronous analysis job is persisted, a fixture-backed
CAD extractor produces normalized native-entity JSON, and the UI exposes status
and raw entities without implying that recognition is complete.

This milestone is deliberately not a screenshot-to-AI pipeline. It establishes
the provider-neutral extraction boundary that later structured-block parsing,
exploded-symbol grouping, topology reconstruction, review, and BOM generation
will consume.

## Architecture

The project uses Next.js App Router with TypeScript for the web surface and API,
Prisma with SQLite for local persistence, and a filesystem-backed private upload
store for development. The upload route validates the request, creates a
`Drawing` and `AnalysisJob`, and returns immediately. A worker function runs
outside the request handler, updates the job through explicit states, invokes a
`CadExtractor`, and persists normalized raw entities as JSON. A development
worker command processes queued jobs; the adapter interface keeps the DWG
provider replaceable without changing the API or UI.

AutoCAD desktop is not part of the system. A production deployment will use a
non-AutoCAD `CadExtractor` provider: LibreDWG/WebAssembly is a viable open-source
option where GPL licensing is acceptable, while ODA Drawings SDK is the commercial
option when broader DWG-version coverage and a closed-product license are
required. Both remain isolated behind the same worker adapter. The checked-in
development provider is fixture-backed rather than a fake DWG parser: fixtures
are explicit native-extraction outputs used only for deterministic tests and
demo verification. Real `.dwg` uploads are stored and accepted by the workflow,
but fail safely with `REAL_EXTRACTOR_NOT_CONFIGURED` until a real provider is
configured. This avoids presenting fixture data as facts about an uploaded
drawing.

The milestone also includes a deterministic component classifier. It uses block
names/attributes first, then geometry signatures and nearby text, and emits
controlled categories such as `circuit_breaker`, `fuse`, `contactor_coil`,
`relay_contact`, `terminal_block`, `motor`, `push_button`, `indicator_light`,
`ground`, and `unknown`. A classifier result is never silently confirmed: it
stores confidence, identification method, evidence, source handles, and a
review status. AI is not required for exact block mappings or template matches.

## Domain model

Persist these records in the first slice:

- `Drawing`: stable ID, sanitized display name, private storage key, original
  MIME/size, upload status, owner scope, timestamps, and optional failure data.
- `AnalysisJob`: stable ID, drawing ID, status, progress, stage message, retry
  count, error code/message, timestamps, and idempotency key.
- `RawCadExtraction`: one versioned normalized JSON document per successful
  extraction, linked to the drawing and job.
- `ComponentCandidate`: one candidate component with category, confidence,
  identification method, evidence, source handles, and review status.

The normalized extraction schema preserves source handles and source drawing ID.
It includes metadata, layouts, layers, block definitions, block references,
primitive entities, text, and bounding boxes. It is not coupled to a component
inventory or BOM schema.

## Job and API flow

1. `POST /api/drawings` receives multipart form data with one `file`.
2. Validation checks file count, extension, declared MIME, size, sanitized name,
   and the DWG magic/header bytes used by the fixture/test contract. Unsupported
   files return a structured 400 response without creating records.
3. The route stores the stream under `data/uploads/<drawingId>/<safeName>` and
   creates an `uploaded` drawing with a `queued` analysis job in one database
   transaction.
4. `POST /api/drawings/:drawingId/analyze` claims the queued job idempotently
   and invokes the worker asynchronously from the request boundary. The worker
   updates `extracting`, then `generating_results`, and finally `completed` for
   fixture-backed input or `failed` with a safe actionable error when no real
   extractor is configured.
5. The worker classifies candidates from normalized entities and persists them
   separately from raw extraction. `GET /api/drawings/:drawingId` returns
   drawing, job, extraction summary, and candidate counts.
   `GET /api/drawings/:drawingId/entities` returns normalized raw entities only
   after authorization and successful extraction. `GET
   /api/drawings/:drawingId/components` returns candidate classifications and
   their evidence.
6. The UI uploads with `XMLHttpRequest` so it can display byte progress, then
   polls the status endpoint and renders explicit uploading, queued, processing,
   failed, completed, and raw-entity states.

## Security boundaries

- Only `.dwg` is accepted in this milestone; `.dxf` is not accepted.
- A configurable `MAX_UPLOAD_BYTES` default is enforced before storage.
- Names are reduced to a safe basename; the internal storage key never uses the
  original filename.
- Uploaded bytes stay outside `public/` and are never executed or served by a
  static route.
- The worker is a separate process entry point; the web handler does not parse
  CAD content synchronously.
- The local development owner is a fixed demo scope until authentication is
  added as a separate milestone. API IDs are validated as UUIDs and ownership
  checks are centralized.
- Error responses expose stable codes and safe messages, not stack traces or
  storage paths.

## Testing strategy

Use Vitest for pure validation, normalization, fixture selection, job
transitions, and worker failure behavior. Use route-level tests with an
in-memory test database or repository fakes so upload validation and idempotency
are deterministic. Add browser verification for the upload → queued →
completed/failed status experience against the local dev server. Fixtures cover
structured blocks, mixed content, exploded primitives, and malformed input; the
first milestone asserts preservation and classification-ready shape, not final
electrical recognition.

## Later milestones

The next boundary consumes `RawCadExtraction` and `ComponentCandidate` and adds
structure classification, non-component regions, more complete block/attribute
extraction, exploded-symbol grouping, wire classification, template matching,
text association, symbol instances, devices, terminals/nets, review corrections,
annotated overlays, inventory, BOM, and JSON/CSV exports. Every later result must
retain confidence, method, source handles, original/corrected values, and review
status. No later milestone may replace deterministic native extraction with
screenshot-only vision inference.
