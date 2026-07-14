# Real DWG Local Conversion Design

## Goal

Allow the current Mac demonstration to accept and analyze ordinary 2D DWG files by converting them to DXF before using the existing DXF rendering and OpenAI vision pipeline.

## Scope

- Target the current macOS development machine.
- Install LibreDWG with Homebrew and use its `dwg2dxf` executable.
- Continue accepting `.dwg` and `.dxf` through the existing upload interface.
- Preserve the prepared DWG fixture fallback.
- Do not add Autodesk cloud services, ODA licensing, or production container packaging in this change.

## Architecture

Add a replaceable `DwgConverter` boundary. Its local LibreDWG implementation receives a source DWG path and a destination directory, invokes `dwg2dxf` without a shell, enforces a timeout and output-size limit, verifies that the expected DXF exists, and returns its path.

Add a DWG renderer adapter that:

1. Creates an isolated temporary directory.
2. Converts the uploaded DWG to DXF.
3. Passes the converted file to the existing DXF renderer.
4. Returns the same `RenderedCadDrawing` contract used by DXF uploads.
5. Removes temporary files in a `finally` block.

The analysis service will send converted DWG render output to the existing OpenAI vision analyzer and consolidate detections using the same logic as DXF. The prepared `control-panel-a.dwg` fixture may continue using its deterministic demo analyzer so existing tests and demonstrations remain stable.

## Processing Flow

```text
DWG upload
→ validate and store existing upload
→ background analysis job
→ local dwg2dxf conversion
→ validate generated DXF
→ existing DXF parser and SVG renderer
→ existing OpenAI vision analysis
→ categorized components and preliminary BOM
→ one-sheet Excel export
```

## Error Handling and Security

- Invoke `dwg2dxf` with `execFile`, never through a shell.
- Use a configurable executable path, defaulting to `dwg2dxf` from `PATH`.
- Default conversion timeout: 60 seconds.
- Default maximum generated DXF size: 100 MB.
- Remove the temporary conversion directory after success or failure.
- Map missing converter, timeout, invalid output, and conversion failure to clear Chinese user messages without exposing command output or internal paths.
- Continue validating uploaded content and file size through the existing upload boundary.

## Testing

- Unit test command arguments, successful conversion, missing output, timeout, and cleanup using an injected process runner.
- Unit test that the DWG renderer delegates converted output to the existing DXF renderer.
- Analysis-service test that an ordinary DWG uses conversion plus OpenAI analysis while the prepared fixture remains deterministic.
- Run type checking, linting, unit tests, production build, and a local smoke test with the installed converter.

## Limitations

- LibreDWG compatibility varies by DWG version and feature set.
- This MVP analyzes a rendered 2D representation; it does not reconstruct full native AutoCAD topology.
- External references, custom objects, encrypted drawings, or damaged files may fail conversion.
- Production deployment will require packaging LibreDWG or replacing the converter adapter with ODA or Autodesk infrastructure.
