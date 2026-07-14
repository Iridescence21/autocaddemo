# Real DXF Vision Analysis Design

## Objective

Replace fixture-only DXF analysis with a real, server-side pipeline that parses
an uploaded DXF without AutoCAD, renders the drawing, sends the rendered drawing
and extracted CAD context to OpenAI, validates the response, deduplicates tile
detections, and persists the resulting categorized component list.

This milestone supports real DXF analysis. DWG remains on the existing adapter
boundary until a licensed or deployment-compatible DWG converter is selected.
The application must not claim that a DWG was analyzed when only a fixture path
was available.

## Architecture

The pipeline is:

```text
DXF upload
  -> native DXF parse
  -> normalized entities and extracted text/block context
  -> SVG overview
  -> PNG overview and overlapping PNG tiles
  -> OpenAI Responses API vision analysis
  -> Zod validation
  -> coordinate normalization and duplicate consolidation
  -> persisted components and preliminary BOM
  -> Chinese categorized result message
```

The existing `CadRenderAdapter` remains the rendering boundary. A new
`DxfRenderAdapter` implements the real DXF path. A separate
`DrawingVisionAnalyzer` interface owns model calls so the provider and model can
be replaced independently.

## DXF Parsing and Rendering

Use the maintained npm `dxf-parser` package to parse ASCII DXF files. Normalize
supported entities before rendering:

- LINE
- LWPOLYLINE and POLYLINE
- CIRCLE
- ARC
- ELLIPSE when exposed by the parser
- TEXT and MTEXT
- INSERT block references, including translation, scale, and rotation
- Block definitions and layer names

Unsupported entities remain in the parsed metadata and generate a warning;
they do not crash the job.

The renderer calculates drawing extents from geometry, adds bounded padding,
preserves aspect ratio, flips the CAD Y axis for screen coordinates, and emits
an SVG. `sharp` rasterizes the SVG into a high-resolution PNG overview and four
overlapping PNG tiles. The persisted preview uses a data URL in the demo, while
the analyzer receives base64 PNG data URLs.

## OpenAI Vision Analysis

Use the OpenAI Responses API from the server only. The default model is
`gpt-5.6-terra`, configurable with `OPENAI_VISION_MODEL`. The API key is read
only from `OPENAI_API_KEY`. An optional `OPENAI_BASE_URL` supports compatible
deployment endpoints without changing application code.

The model receives:

- The overview PNG
- Each overlapping tile PNG with tile coordinates
- Extracted DXF text, layer names, and block names
- The controlled electrical category enum
- Instructions to identify only visible evidence
- Instructions to return normalized locations and never invent manufacturer,
  model, or specification data

The request uses JSON Schema structured output. The response is also validated
with Zod before persistence. Invalid output is retried once with the validation
error summarized. A second invalid response fails the job safely.

If `OPENAI_API_KEY` is missing, real DXF analysis fails with the stable code
`AI_NOT_CONFIGURED` and a Chinese user-facing message. The system never falls
back to prepared fixture detections for an unfamiliar DXF.

## Detection Schema

Each model detection contains:

- `temporaryId`
- Controlled `category`
- Optional `label`
- Chinese or source-language `description`
- Nullable `manufacturer` and `modelNumber`
- Visible `specifications`
- Confidence from 0 to 1
- Source tile ID
- Normalized bounding box
- Evidence strings
- `reviewRequired`

The application assigns stable persisted IDs. Confidence does not convert an
inference into a confirmed fact: high-confidence AI results still use
`requires_review` until an engineer confirms them.

## Duplicate Consolidation

Tile coordinates are converted to overview-normalized coordinates. Detections
with the same category or compatible unknown/category pairing are merged when
their intersection-over-union exceeds 0.45 or their centers are within a small
size-relative tolerance. The merged detection keeps the highest-confidence
classification, unions evidence, and preserves all source tile IDs.

Detections that cannot be merged remain separate. The algorithm prefers false
duplicates over incorrectly merging two neighboring physical components.

## Categorized Results

All active persisted detections are grouped in stable category order and shown
exactly once in the Chinese assistant result. Each item displays tag or stable
identifier, category, description, visible specifications, confidence, and
review status. Unknown items appear under `未知元件（需工程师复核）`.

The BOM is regenerated from the consolidated persisted components. Missing
manufacturer and model values remain `图纸中未显示`.

## Security and Failure Handling

- The model key is never returned to or logged by the browser.
- Model requests have a configurable timeout, defaulting to 120 seconds.
- Image dimensions and tile count are bounded.
- Uploaded file limits remain enforced before parsing.
- Parser, renderer, provider, timeout, and schema failures use stable internal
  codes and sanitized Chinese messages.
- Raw uploaded files remain outside public static paths.

## Testing

Tests use a real synthetic DXF fixture and a fake model transport:

- Parse entities, layers, blocks, and text from DXF
- Calculate extents and render non-empty SVG/PNG output
- Produce overview and overlapping tile metadata
- Build a server-side OpenAI request containing image and CAD context
- Reject malformed model output
- Consolidate overlapping duplicate detections
- Preserve neighboring detections
- Persist consolidated components and regenerate the BOM
- Fail explicitly when the model key is absent
- Render a Chinese category-grouped result with every active component once

The live OpenAI call is an opt-in smoke test because it consumes API quota. The
automated suite remains deterministic and never requires a secret.

## Acceptance Boundary

The milestone is complete when a non-fixture ASCII DXF can be uploaded, parsed,
rendered, analyzed with the configured OpenAI key, and returned as a validated,
categorized preliminary component list with counts and a BOM.

This does not guarantee detection of every component in every electrical DXF.
Results remain preliminary and require engineer verification.
