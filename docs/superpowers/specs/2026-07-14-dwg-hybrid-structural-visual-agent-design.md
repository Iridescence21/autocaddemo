# DWG Structural + Visual Electrical Drawing Agent Design

## Objective

Build a real vertical slice for AutoCAD electrical drawings that combines two
independent evidence paths:

1. Structural DWG evidence obtained by converting DWG to ASCII DXF and parsing
   native CAD entities.
2. Visual evidence obtained by rendering the converted drawing to
   high-resolution images and analyzing focused regions.

An electrical-drawing agent will answer questions only after reconciling these
two paths. Exact native CAD evidence has priority for text, coordinates, block
identity, and line geometry. Visual evidence supplies layout understanding,
recognition of exploded symbols, and a second opinion. Conflicts are preserved
as review issues rather than silently resolved.

The first real inputs are:

- `M-T1-01.dwg`
- `M-T1-02.dwg`

Both are valid `AC1018` AutoCAD 2004/2005/2006 drawings. They are treated as
related sheets of one drawing set, not as revisions of the same sheet.

## Mandatory Verification Gate

No application code may be changed until an independent Python validation
script proves that the real files can be converted, parsed, and rendered.

The validation runs outside the application and writes only to a temporary or
explicit validation-output directory. It must not update the database, call
application APIs, or depend on the web UI.

### Python validation workflow

For each DWG file, the script will:

1. Read and report the DWG header and source hash.
2. Invoke a configured DWG-to-DXF converter through a subprocess boundary.
3. Require an ASCII DXF output with bounded, non-zero size.
4. Parse the DXF with Python `ezdxf`.
5. Inventory model-space and paper-space entities by type and layer.
6. Extract block definitions, block references, attributes, `TEXT`, `MTEXT`,
   dimensions, polylines, lines, circles, arcs, and insert transforms.
7. Render a full-sheet PNG using the DXF geometry.
8. Produce focused crops for populated drawing regions.
9. Emit a machine-readable validation manifest and a human-readable report.

Expected validation artifacts per source file:

- `manifest.json`
- `entities.json`
- `blocks.json`
- `texts.json`
- `layers.json`
- `overview.png`
- `validation-report.md`

### Gate criteria

The gate passes only when both supplied DWG files satisfy all of the following:

- Conversion exits successfully and produces a parseable ASCII DXF.
- Drawing extents are finite and non-empty.
- The entity inventory is non-empty and internally consistent.
- At least some native text is recovered; for `M-T1-02`, the script should find
  recognizable sheet or device evidence such as `M-T1-02`, `TA1`, `KA1`, or
  `YCT1`. A font or encoding warning is allowed if the raw text remains
  traceable.
- The rendered PNG is non-empty and visually contains drawing geometry.
- Every extracted object retains a source handle or stable validation ID.
- Missing fonts, external references, unsupported entities, and converter
  warnings are explicitly listed.

If this gate fails, work stops at the validation report. The application will
not be modified to conceal a failed conversion or substitute fixture data.

## Converter Boundary

The existing application already defines a replaceable `DwgConverter`
boundary. The validation and production paths will preserve that separation.

The initial validation may use LibreDWG `dwg2dxf` because it matches the
existing adapter and the supplied files use an older `AC1018` format. The
application must not depend on LibreDWG-specific output details beyond the
converter interface. A production deployment can replace it with ODA Drawings
SDK or another licensed converter when broader compatibility, dynamic blocks,
fonts, or external references require it.

Converter selection, executable path, timeout, maximum output size, and output
directory are configuration values. Converter stderr is captured for
diagnostics but sanitized before user display.

## Hybrid Analysis Architecture

```text
DWG source
  -> configured DWG converter
  -> ASCII DXF
     -> native structural parser
        -> entities, blocks, attributes, text, layers, exact geometry
        -> electrical structure candidates and connection graph
     -> high-resolution renderer
        -> overview and populated-region tiles
        -> visual symbol and layout candidates
  -> evidence fusion
     -> devices, symbols, terminals, nets, labels, review issues
  -> electrical-drawing agent tools
     -> search, explain, review, trace, export, compare
```

The structural and visual analyzers are independent. Either may produce a
partial result. Their raw evidence remains available for diagnosis and engineer
review.

## Structural Analysis Path

The structural analyzer consumes the normalized DXF representation and
produces traceable candidates.

### Native recognition priority

1. Named block and block-attribute mappings.
2. Native text and nearby-geometry association.
3. Canonical geometry signatures for unknown or anonymous blocks.
4. Grouping of exploded primitives by proximity and connectivity.
5. Controlled unknown candidates when evidence is insufficient.

It preserves source handles, layer, bounds, insertion transform, block name,
attributes, and nearby texts for every candidate.

### Electrical graph reconstruction

The graph builder represents:

- Physical or logical device as a device node.
- Symbol occurrence, such as a distributed relay contact, as an occurrence.
- Terminal or contact point as a port.
- Wire, bus, or continuation as an edge.
- Device tag, terminal number, contact number, and cross-reference as
  attributes.

Geometry determines candidate connections. Endpoint snapping uses bounded
drawing-unit tolerances. Intersections do not automatically become electrical
connections: junction markers, native topology, gaps, hops, and drawing
conventions contribute evidence. Ambiguous crossings remain review issues.

`M-T1-01` and `M-T1-02` may be linked through sheet references, matching device
tags, terminal numbers, or continuation labels. This is cross-sheet linking,
not version comparison.

## Visual Analysis Path

The visual path retains the current overview-and-tile approach with these
purposes:

- Segment the sheet into functional regions.
- Recognize symbols that have been exploded into primitives.
- Validate approximate symbol count and location.
- Read text only when native text extraction is unavailable or corrupted.
- Detect visual evidence that structural rules do not capture.

The model receives a focused image plus region-scoped CAD context. It returns a
strict structured result. It must not invent manufacturer, model, rating,
terminal number, or connection information that is not visible.

Visual bounding boxes are mapped back into CAD coordinates. Visual results are
preliminary evidence, not confirmed CAD facts.

## Evidence Fusion

Fusion is deterministic and explainable.

### Decision rules

- Native `TEXT`, `MTEXT`, block attributes, and exact handles outrank OCR or
  visual guesses for the same field.
- A known block mapping outranks a visual class prediction when the mapping is
  versioned and active.
- Visual evidence may raise a missing-symbol candidate when no structural
  candidate covers the same location.
- Geometry signatures and visual predictions may reinforce each other for
  exploded symbols.
- Conflicting labels, classes, counts, or locations generate a review issue.
- No evidence source may silently delete another source's candidate.
- Every final fact carries its contributing evidence, confidence, method, and
  review state.

The fusion output separates symbol occurrences from physical devices so relay
coils and distributed contacts are not counted as separate purchased devices.

## Domain Records

The hybrid slice introduces or extends these concepts:

- `DrawingSheet`: source identity, drawing number, title, set, page, version,
  conversion metadata, and coverage state.
- `CadEvidence`: source handle, entity type, layer, block, attributes, text,
  geometry, and bounds.
- `VisualEvidence`: tile, normalized bounds, predicted class, visible text, and
  model confidence.
- `SymbolOccurrence`: one visible or native symbol occurrence.
- `PhysicalDevice`: a conservatively grouped real device.
- `Terminal`: terminal or contact number and owning occurrence/device.
- `Net`: connected ports, wire labels, and cross-sheet references.
- `ReviewIssue`: rule, severity, evidence, location, recommendation, and state.
- `AgentCitation`: drawing ID, sheet, handle or region, and evidence type used
  in an answer.

## Electrical-Drawing Agent

The product exposes one coordinated electrical-drawing agent rather than
several unconstrained agents. The agent uses typed tools backed by the
structural database and analysis services:

- `search_drawings`: search title, number, device tag, class, rating, and text.
- `inspect_sheet`: return sheet metadata, regions, coverage, and warnings.
- `list_devices`: list occurrences or physical devices with evidence.
- `trace_circuit`: traverse terminals, contacts, nets, and cross-sheet links.
- `review_drawing`: run explicit completeness and consistency rules.
- `generate_artifact`: create equipment lists, terminal tables, review reports,
  circuit explanations, or draft SOPs.
- `compare_revisions`: compare only sheets explicitly linked as revisions.

Answers must cite source sheet and entity/region evidence. When topology is
partial, the answer states the uncovered or ambiguous section instead of
claiming completeness.

## Initial Review Rules

The first slice targets explainable checks that do not require protection
settings or simulation inputs:

- Duplicate or missing device tag.
- Native symbol without an associated tag.
- Dangling wire endpoint.
- Duplicate, missing, or malformed terminal number.
- Relay coil with no matching contact occurrence.
- Contact occurrence with no matching coil/device.
- Three-phase branch asymmetry.
- Inconsistent device-tag family across parallel phases.
- Unresolved cross-sheet continuation.
- Missing title-block field.
- Structural and visual count disagreement.

Protection selectivity, CT ratio suitability, trip-setting correctness, short
circuit calculations, and safety compliance are outside the first slice unless
the required engineering inputs and approved rules are supplied.

## Outputs

The first slice produces:

- Annotated drawing preview.
- Symbol-occurrence inventory.
- Physical-device inventory and preliminary BOM.
- Device-tag and terminal tables.
- Coil/contact association table.
- Partial circuit graph with coverage warnings.
- Explainable review report.
- Natural-language answers with drawing citations.
- Spreadsheet export.

Draft SOP generation is allowed, but every SOP is labeled as requiring
engineering approval.

## Failure Handling

- Missing converter: stop with `DWG_CONVERTER_NOT_CONFIGURED` and installation
  guidance.
- Conversion failure: preserve the source file, converter diagnostics, and
  failure code; do not use fixture output.
- Missing font or external reference: continue only when geometry remains
  usable and expose a visible coverage warning.
- Partial native parsing: retain supported entities and mark unsupported
  regions or types.
- Visual-provider failure: keep structural results and mark visual verification
  incomplete.
- Structural failure with a valid render: allow a visual-only preliminary result
  but clearly label it unsuitable for topology claims.
- Fusion conflict: create a review issue and preserve both evidence records.

## Test Strategy After the Gate

Only after the Python validation gate passes:

1. Add converter integration tests using a fake process runner.
2. Add parser regression fixtures produced from the two real drawings without
   committing confidential source DWG files unless explicitly approved.
3. Test block/text/attribute preservation and stable source handles.
4. Test endpoint snapping, crossings, junctions, and dangling endpoints.
5. Test coil/contact grouping without merging separate devices.
6. Test structural/visual conflict handling.
7. Test cross-sheet linking separately from revision comparison.
8. Test agent tools return citations and coverage limitations.
9. Run focused unit tests, type checking, linting, production build, and a real
   local DWG smoke test.

## Milestone Acceptance Criteria

The milestone is accepted when:

- The independent Python script converts, parses, and renders both supplied
  DWG files and saves a successful validation report.
- Application changes start only after that report passes.
- Both structural and visual paths run on the same real source sheets.
- Known device tags from `M-T1-02` are recovered with source locations.
- The system produces traceable device and occurrence lists.
- At least a partial terminal/net graph is available with explicit coverage.
- Initial review rules return evidence-backed findings.
- The agent answers drawing questions using fused evidence and citations.
- Visual-only claims never override exact native CAD facts.
- No prepared fixture result is presented as analysis of either supplied DWG.

## Deferred Scope

- Training a domain foundation model.
- Full protection-setting or selectivity verification.
- Three-dimensional interference, tolerance, or material analysis.
- Automatic release of engineering changes without human approval.
- Production-wide generalization claims before a representative gold-standard
  evaluation set exists.
