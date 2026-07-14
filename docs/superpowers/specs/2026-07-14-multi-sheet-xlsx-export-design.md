# Multi-sheet Excel analysis export design

## Goal

Add a server-generated `.xlsx` export that captures the complete preliminary drawing-analysis result in a labeled, engineer-reviewable workbook. The workbook must preserve stable drawing and component identifiers, distinguish extracted and corrected values, include confidence and review state, and embed an annotated drawing preview whose marker numbers match the component inventory.

The workbook is preliminary output. Every relevant sheet must state that an electrical engineer must verify the result.

## Scope

This change adds:

- A real Excel workbook generated with `exceljs`.
- Seven Chinese-labeled worksheets.
- An annotated preview image generated from the persisted drawing preview and normalized component coordinates.
- An Excel export option in the existing chat and BOM actions.
- Persisted export status and an export-result chat message.
- Persistence of the OpenAI provider/model used by an analysis job so the workbook records the actual analysis configuration.
- Unit and integration coverage for workbook contents, image annotation, API behavior, authorization, and failure handling.

This change does not add new CAD recognition, arbitrary DWG conversion, wire topology, terminal reconstruction, or manufacturer/SKU inference.

## Selected approach

Use `exceljs` in the Node.js server runtime. It supports native `.xlsx` files, multiple worksheets, frozen panes, filters, styling, and embedded PNG images. `sharp`, which is already installed, will composite a deterministic SVG marker overlay onto the persisted PNG drawing preview before the result is embedded.

SheetJS Community was rejected because image embedding is not a clean fit for this requirement. A ZIP of CSV files was rejected because it is not a single labeled Excel workbook and cannot carry the annotated preview.

## API and service boundaries

The existing route remains the export boundary:

```text
POST /api/drawings/:drawingId/exports
```

The request accepts runtime-validated JSON:

```json
{ "format": "xlsx" }
```

An absent request body remains compatible with the current CSV behavior. The user-facing UI and the deterministic `export_bom` chat command will request `xlsx` by default.

Successful Excel responses use:

```text
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="<safe-drawing-name>-preliminary-analysis.xlsx"
Cache-Control: no-store
```

The route resolves the drawing through the existing owner-scoped repository before generating any content. It calls a new workbook service rather than constructing worksheets in the route.

Proposed service boundary:

```ts
interface AnalysisWorkbookInput {
  snapshot: AnalysisSnapshot;
  exportedAt: Date;
}

interface AnalysisWorkbookResult {
  buffer: Buffer;
  filename: string;
}

function buildAnalysisWorkbook(input: AnalysisWorkbookInput): Promise<AnalysisWorkbookResult>;
```

## Workbook structure

Sheet names stay below Excel's 31-character limit.

### 1. 分析摘要

A labeled two-column summary containing:

- Preliminary-result and engineer-verification warning.
- Original drawing filename and source type.
- Drawing ID, conversation ID, and analysis job ID.
- Analysis status and completion stage.
- Total active, confirmed, review-required, and unknown component counts.
- BOM group count and total purchasing quantity.
- Analysis provider and model.
- Drawing and analysis timestamps.
- Export timestamp.

### 2. 元件清单

One row per component detection, including removed detections for auditability. Columns:

- Marker number.
- Stable component ID and temporary detection ID.
- Tag.
- Chinese category label and controlled category key.
- Description.
- Specifications.
- Manufacturer and model number.
- Confidence percentage.
- Recognition method.
- Source tile.
- Normalized bounding-box X, Y, width, and height.
- Review status.
- Original category and corrected category.
- Active/removed state.
- Created and updated timestamps.

Missing drawing values use `图纸中未显示`; they are never fabricated.

### 3. 采购 BOM

One row per persisted BOM group:

- Item number and stable BOM ID.
- Chinese category label and controlled category key.
- Description.
- Manufacturer and model.
- Specifications.
- Quantity.
- Lowest contributing confidence.
- Review status.

The sheet states that it is a preliminary purchasing list and cannot be used for purchasing without engineer confirmation.

### 4. 复核项目

One row for every unknown, unconfirmed, low-confidence, corrected, or removed detection. Columns include marker number, stable ID, tag, category, confidence, review status, derived review reason, and correction state. For workbook reporting, low confidence means below `0.80`; this threshold only adds a review reason and never automatically confirms or rejects a component.

Review reasons are deterministic labels such as `未知类别`, `AI 结果尚未确认`, `置信度低于 80%`, `用户已修改分类`, and `用户已移除`.

### 5. 图纸预览

Embed a PNG generated from the persisted preview image. `sharp` composites numbered marker boxes and labels using normalized component coordinates and the preview dimensions. Marker numbers are stable within the workbook and match `元件清单`, `复核项目`, and `来源证据`.

Markers use both a number and a status label, not color alone. Confirmed, review-required, unknown, and removed components receive distinct colors. If no preview is available, the sheet contains a labeled explanation instead of failing the entire export.

A marker legend appears below or beside the image with marker number, tag/detection ID, category, confidence, and review status.

### 6. 来源证据

One row per evidence statement:

- Marker number.
- Stable component ID and temporary detection ID.
- Tag and category.
- Evidence sequence number and evidence text.
- Recognition method.
- Source tile.
- Normalized bounding box.
- Original and corrected category.

Components with no evidence receive a row labeled `无可显示证据` so they are not silently omitted.

### 7. 分析元数据

A labeled key/value audit sheet containing:

- Drawing, conversation, and analysis job identifiers.
- Original and sanitized filenames, without exposing the private storage key.
- Source type and byte size.
- Preview dimensions and tile count.
- Job status, progress, stage, provider, model, error code, and safe user-facing error message.
- Drawing, job, and export timestamps.
- Component and BOM counts.
- Current demo limitations, including preliminary image-based detection and the lack of arbitrary DWG conversion.

## Formatting

- Use a consistent Chinese workbook title and sheet header style.
- Freeze header rows and enable auto-filters on tabular sheets.
- Apply readable column widths and wrapped text to descriptions, specifications, and evidence.
- Format confidence as percentages and timestamps as localized date-time values.
- Use status text in every row; color is supporting information only.
- Highlight unknown and review-required records, while retaining readable contrast.
- Preserve stable ordering: marker number, BOM item number, and evidence sequence.
- Set workbook creator and creation/modification timestamps without including secrets.

## Data and persistence changes

Add nullable `provider` and `modelName` fields to `AnalysisJob`. Real OpenAI analysis writes `openai` and the exact configured model. Fixture analysis writes `demo_fixture` and `fixture`. Existing jobs remain valid with null values and export as `未记录`.

`DrawingExport` continues to store filename, kind, and status. Excel exports use kind `analysis_xlsx`. Export creation follows `processing -> completed` or `processing -> failed` so failed attempts remain auditable.

No component or BOM migration is required.

## UI behavior

- Replace the primary `导出 CSV` result action with `导出 Excel`.
- Keep CSV available as a secondary compatibility action.
- The `导出 BOM` chat command generates the complete workbook, not a BOM-only CSV.
- While exporting, the current action is disabled and the user sees an exporting state.
- Success adds an export message containing the generated `.xlsx` filename.
- Failure adds a safe Chinese error message without stack traces.

This milestone does not redesign the chat composer or unrelated screens.

## Security and correctness

- Reuse existing owner-scoped drawing authorization.
- Validate export format with Zod.
- Never include storage keys, API keys, request authorization headers, or internal stack traces.
- Sanitize the download filename.
- Neutralize Excel formula injection by prefixing user/model-derived strings beginning with `=`, `+`, `-`, or `@`.
- Build the workbook only in the Node.js server runtime.
- Set `Cache-Control: no-store`.
- Treat all model-derived fields as preliminary unless their persisted review state is confirmed.
- Generate marker coordinates from persisted normalized geometry; do not estimate them manually from a screenshot.

## Error handling

- Missing drawing or cross-owner access returns the existing not-found response.
- Invalid export format returns a Chinese `400` response.
- No components still produces a valid workbook with headers and an explicit `未检测到元件` message.
- A missing preview produces the workbook without an image and explains the omission in `图纸预览`.
- Corrupt preview data fails only the image annotation step when safe fallback is possible.
- Workbook-generation failure records a failed export and returns a generic Chinese error.
- The route does not expose library exceptions.

## Testing

### Unit tests

- Workbook contains all seven sheets in stable order.
- Summary totals and engineer-verification warning are correct.
- Component inventory includes active, corrected, unknown, and removed records.
- Missing values use `图纸中未显示`.
- BOM quantities and confidence are preserved.
- Review reasons are deterministic.
- Evidence rows preserve IDs and source references.
- Formula-like cell values are neutralized.
- Annotated preview contains an embedded image and marker legend.
- Missing preview and zero-component inputs still produce a valid workbook.

### Integration tests

- Authorized XLSX export returns the correct content type, filename, and ZIP/XLSX signature.
- The returned workbook can be reopened with `exceljs` and contains expected rows.
- Cross-owner access cannot export a drawing.
- Export status and export-result messages persist.
- CSV compatibility remains functional.
- Analysis provider/model metadata is persisted for real and fixture analysis paths.

### UI tests

- `导出 Excel` requests the XLSX format.
- The export loading state prevents duplicate requests.
- Success and failure states render in Chinese.
- The deterministic chat export command downloads the workbook.

### Verification commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The browser flow will verify: open an analyzed conversation, export Excel, open the downloaded workbook, confirm all sheets and the annotated preview, and verify stable IDs against the component list.

## Acceptance criteria

- An analyzed drawing can be exported as one valid `.xlsx` file.
- The workbook contains all seven labeled worksheets.
- Every component is represented with stable identifiers, labels, confidence, evidence, coordinates, and review state.
- The purchasing BOM is separate from symbol detections.
- The annotated preview uses numbered markers that match workbook rows.
- Missing manufacturer, model, and specification values are explicit and never invented.
- Corrected and removed components remain auditable.
- The workbook records the actual analysis provider/model when available.
- Export actions and chat commands download the workbook.
- Existing CSV export remains available.
- Tests, type checking, linting, production build, and the manual export workflow pass.
