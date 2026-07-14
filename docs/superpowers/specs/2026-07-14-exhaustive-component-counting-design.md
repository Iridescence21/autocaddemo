# Exhaustive Component Counting Design

## Objective

Improve the demonstration analyzer so dense DWG and DXF drawings produce two traceable outputs:

1. A symbol inventory containing every visible symbol occurrence the system can detect.
2. A physical-device inventory and preliminary BOM that group related symbol occurrences without confusing drawing occurrences with purchasing quantity.

All results remain preliminary and require engineer verification.

## Current Failure

The current renderer compresses each drawing into a maximum 2048 by 1536 overview and four fixed quadrants. The analyzer sends the overview and all four tiles in one request. Dense electrical content therefore occupies too few pixels, and the model tends to summarize representative components instead of enumerating every occurrence. Follow-up chat requests only list those already persisted detections and do not trigger a more exhaustive scan.

## Selected Approach

Use adaptive, multi-pass region analysis. Keep the native DXF context produced by DWG conversion and DXF parsing as supporting evidence, but use high-resolution drawing regions for visual classification.

Prompt-only changes are insufficient because the source images are too dense. A custom object-detection training pipeline is outside the MVP. Adaptive tiling provides the best accuracy improvement without replacing the current architecture.

## Rendering and Region Selection

- Render a readable overview for the workspace.
- Determine populated regions from normalized CAD entity bounds rather than splitting the entire sheet into four fixed quadrants.
- Divide populated regions into overlapping, approximately square analysis tiles at a configurable target resolution.
- Skip tiles that contain no supported CAD geometry.
- Preserve each tile's exact overview coordinates so every detection maps back to the drawing.
- Cap tile count and image dimensions to control runtime and API cost. If the cap is reached, emit a visible warning instead of implying complete coverage.

## Multi-Pass Detection

Each analysis tile is sent in its own structured-output request.

The first pass must enumerate every visible candidate, including repeated symbols, unlabeled symbols, and unknown symbols. It must not combine similar occurrences.

A verification pass runs for dense tiles or tiles where the first result appears incomplete. The verification request receives the first-pass count and asks only for missed candidates or corrections. Results from both passes are schema-validated before use.

Failures are isolated by tile. Successful regions remain available as partial results, while failed regions create review warnings and remain visibly uncovered.

## Deterministic CAD Evidence

The analyzer receives region-scoped evidence instead of the entire drawing context:

- Block references and block names inside or near the tile
- Text entities and their coordinates
- Layers represented in the tile
- Primitive-entity density
- Drawing units and conversion warnings

This evidence supports classification and counting. It does not silently override visual evidence or turn missing specifications into invented values.

## Duplicate Reconciliation

Overlapping tiles can produce duplicate detections. Reconciliation maps every candidate to overview coordinates and merges only candidates with strong spatial overlap and compatible category or label evidence.

Distinct neighboring symbols must remain separate even when they share a category or tag pattern. The system preserves all contributing tile IDs and records merged detections as requiring review when evidence conflicts.

## Symbol Occurrences and Physical Devices

Persist every surviving detection as a symbol occurrence. Each occurrence includes category, tag, location, source tiles, confidence, evidence, and review status.

Create a separate physical-device grouping result. Grouping uses, in priority order:

1. Exact normalized tag matches
2. Compatible category and model information
3. Standard coil/contact or parent/child conventions
4. Nearby cross-reference text
5. Conservative drawing-context evidence

Unlabeled or ambiguous occurrences remain separate unless an engineer groups them. A physical device references its symbol occurrences and supplies the preliminary purchasing quantity.

## User Experience

The Chinese analysis workspace will expose:

- Symbol occurrence count
- Physical-device count
- Category totals for both views
- Coverage warnings and failed-region warnings
- Filters for category, confidence, unknown, and review status
- Source highlighting for each occurrence

Chat requests such as “列出所有元件” return the exhaustive occurrence inventory. BOM requests return grouped physical-device quantities. The assistant explicitly distinguishes these two counts.

## Spreadsheet Export

Keep one worksheet. The top table contains one row per symbol occurrence with physical-device grouping columns. A grouped physical-device and BOM summary appears below it on the same worksheet.

Both sections include stable identifiers, category, tag, description, quantity where applicable, confidence, review status, source tile or location, and evidence. Missing manufacturer or model information is labeled as not visible rather than inferred.

## Configuration and Limits

Expose environment-backed settings for target tile size, overlap, maximum tile count, per-tile timeout, verification threshold, and analysis concurrency. Defaults favor accuracy while keeping the demo bounded.

The UI must disclose when processing limits prevent full-sheet coverage. The system must not call a bounded scan exhaustive without that warning.

## Testing

- Unit tests for adaptive tile selection and coverage
- Unit tests for region-scoped CAD evidence
- Unit tests for overlap reconciliation that preserve neighboring repeated symbols
- Unit tests for physical-device grouping
- Analyzer tests proving one request per tile and verification behavior
- Service tests for partial tile failure and coverage warnings
- Export tests for occurrence rows and grouped-device summary in one worksheet
- An end-to-end test using mocked deterministic tile responses
- A local real-DWG smoke test reporting tile count, raw detections, reconciled occurrences, physical devices, and category totals

## Acceptance Criteria

- Dense drawings are analyzed region by region instead of through four fixed quadrants in one request.
- Every returned symbol occurrence is listed and categorized, including unknowns.
- Physical-device counts remain separate from symbol-occurrence counts.
- Overlap reconciliation removes true duplicates without collapsing distinct repeated symbols.
- Partial coverage and analysis limits are visible.
- The one-sheet Excel export contains both detailed occurrences and grouped device/BOM totals.
- Focused tests, type checking, linting, production build, and the deterministic end-to-end flow pass.
- A real DWG smoke run demonstrates materially improved coverage, while results remain explicitly preliminary.
