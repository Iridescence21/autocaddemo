# Real DWG Local Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary 2D DWG uploads on the current Mac convert to DXF and continue through the existing OpenAI vision analysis, categorized component list, BOM, and Excel export.

**Architecture:** Add a replaceable `DwgConverter` implemented with LibreDWG's `dwg2dxf`, then wrap the existing DXF renderer in a temporary-directory DWG renderer. Keep the prepared DWG fixture deterministic, while ordinary DWGs use the converter, DXF renderer, OpenAI analyzer, and vision-result consolidation.

**Tech Stack:** Next.js 16, TypeScript, Node.js `execFile`, LibreDWG 0.13.x installed with Homebrew, existing DXF parser/renderer, OpenAI vision adapter, Vitest.

## Global Constraints

- Target the current macOS development machine.
- Invoke `dwg2dxf` with `execFile`, never through a shell.
- Default conversion timeout is 60 seconds.
- Default maximum generated DXF size is 100 MB.
- Always remove conversion temporary directories.
- Preserve the prepared `control-panel-a.dwg` fixture fallback.
- Do not expose command output, source paths, or internal stack traces in user-facing errors.
- Keep `.dxf` uploads and the existing Excel export behavior unchanged.

---

## File map

- `src/lib/cad/dwg-converter.ts`: isolated LibreDWG process invocation and output validation.
- `src/lib/cad/dwg-converter.test.ts`: converter success and failure tests with an injected process runner.
- `src/lib/cad/dwg-renderer.ts`: temporary conversion lifecycle and delegation to the DXF renderer.
- `src/lib/cad/dwg-renderer.test.ts`: renderer delegation and cleanup tests.
- `src/lib/cad/registry.ts`: return the real DWG renderer for ordinary DWG processing.
- `src/lib/analysis/service.ts`: choose demo mode only for the prepared fixture and vision mode for ordinary DWGs.
- `src/lib/analysis/service.test.ts`: verify real-DWG adapter selection and Chinese failure mapping.
- `scripts/smoke-real-dwg.ts`: optional local round-trip converter and application-analysis smoke test.
- `package.json`: expose `smoke:dwg`.

---

### Task 1: Add the isolated LibreDWG converter

**Files:**
- Create: `src/lib/cad/dwg-converter.ts`
- Create: `src/lib/cad/dwg-converter.test.ts`

**Interfaces:**
- Consumes: a readable DWG source path, writable output directory, and optional injected process runner.
- Produces: `DwgConverter.convert({ sourcePath, outputDir }): Promise<string>` returning a validated ASCII DXF path.

- [ ] **Step 1: Write failing converter tests**

Create tests that inject this runner contract:

```ts
export type DwgProcessRunner = (
  executable: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<void>;
```

The success runner writes `${parse(sourcePath).name}.dxf` into `options.cwd`. Assert the converter calls `dwg2dxf` with `--overwrite`, uses `60000` milliseconds, and returns the generated path. Add tests that assert `DWG_CONVERTER_OUTPUT_MISSING` for no output, `DWG_CONVERTER_OUTPUT_TOO_LARGE` for an output over the injected size limit, `DWG_CONVERTER_NOT_INSTALLED` for a runner error with code `ENOENT`, `DWG_CONVERSION_TIMEOUT` for a runner error with `killed: true`, and `DWG_CONVERSION_FAILED` for other runner errors.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- src/lib/cad/dwg-converter.test.ts
```

Expected: FAIL because `dwg-converter.ts` does not exist.

- [ ] **Step 3: Implement the converter**

Create these public types and factory:

```ts
export type DwgConversionInput = { sourcePath: string; outputDir: string };
export interface DwgConverter { convert(input: DwgConversionInput): Promise<string> }
export type DwgConverterOptions = {
  executable?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  runner?: DwgProcessRunner;
};
export function createLibreDwgConverter(options: DwgConverterOptions = {}): DwgConverter;
export const libreDwgConverter: DwgConverter;
```

Use `promisify(execFile)` in the default runner. Run:

```ts
await runner(executable, ["--overwrite", resolve(input.sourcePath)], {
  cwd: input.outputDir,
  timeout: timeoutMs,
  maxBuffer: 1024 * 1024,
});
```

Validate with `stat`: the expected `.dxf` must be a regular non-empty file no larger than `maxOutputBytes`. Map a runner error with `code === "ENOENT"` to `DWG_CONVERTER_NOT_INSTALLED`, a runner error with `killed === true` to `DWG_CONVERSION_TIMEOUT`, and all other runner errors to `DWG_CONVERSION_FAILED`; preserve explicit output-validation error codes.

- [ ] **Step 4: Run focused tests and type checking**

Run:

```bash
npm test -- src/lib/cad/dwg-converter.test.ts
npm run typecheck
```

Expected: converter tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cad/dwg-converter.ts src/lib/cad/dwg-converter.test.ts
git commit -m "feat: add isolated LibreDWG converter"
```

---

### Task 2: Add the DWG-to-DXF rendering adapter

**Files:**
- Create: `src/lib/cad/dwg-renderer.ts`
- Create: `src/lib/cad/dwg-renderer.test.ts`
- Modify: `src/lib/cad/registry.ts`

**Interfaces:**
- Consumes: `DwgConverter`, existing `CadRenderAdapter`, and `mkdtemp`/`rm` lifecycle helpers.
- Produces: `createDwgRenderer(converter?, downstreamRenderer?): CadRenderAdapter` and `dwgRenderer`.

- [ ] **Step 1: Write failing renderer tests**

Use an injected converter that records the DWG source and writes a minimal valid DXF into the supplied output directory. Use an injected downstream renderer that asserts it receives:

```ts
{
  drawingId: "drawing-1",
  sourcePath: convertedPath,
  sourceType: "dxf",
}
```

Assert the downstream render result is returned and the converter's temporary directory no longer exists after success. Add a failure test proving cleanup also occurs when the downstream renderer throws.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- src/lib/cad/dwg-renderer.test.ts
```

Expected: FAIL because `dwg-renderer.ts` does not exist.

- [ ] **Step 3: Implement temporary conversion and delegation**

Implement:

```ts
export function createDwgRenderer(
  converter: DwgConverter = libreDwgConverter,
  downstreamRenderer: CadRenderAdapter = dxfRenderer,
): CadRenderAdapter {
  return {
    async render(input) {
      if (input.sourceType !== "dwg") throw new Error("DWG_RENDERER_SOURCE_TYPE_MISMATCH");
      const outputDir = await mkdtemp(join(tmpdir(), "dwg-electrical-"));
      try {
        const sourcePath = await converter.convert({ sourcePath: input.sourcePath, outputDir });
        return await downstreamRenderer.render({ drawingId: input.drawingId, sourcePath, sourceType: "dxf" });
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    },
  };
}

export const dwgRenderer = createDwgRenderer();
```

Change `getCadRenderer("dwg")` to return `dwgRenderer`; keep `getCadRenderer("dxf")` unchanged.

- [ ] **Step 4: Run focused tests and type checking**

```bash
npm test -- src/lib/cad/dwg-renderer.test.ts src/lib/cad/dxf-renderer.test.ts
npm run typecheck
```

Expected: both renderer suites pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cad/dwg-renderer.ts src/lib/cad/dwg-renderer.test.ts src/lib/cad/registry.ts
git commit -m "feat: render DWG through local DXF conversion"
```

---

### Task 3: Route ordinary DWGs through OpenAI analysis

**Files:**
- Modify: `src/lib/analysis/service.ts`
- Modify: `src/lib/analysis/service.test.ts`

**Interfaces:**
- Consumes: prepared-fixture detection, `getCadRenderer`, `openAiVisionAnalyzer`, and existing vision consolidation.
- Produces: deterministic demo mode for the fixture and `vision` mode for ordinary DWGs.

- [ ] **Step 1: Write failing service-selection tests**

Export a testable adapter selector:

```ts
export type AnalysisMode = "demo" | "vision";
export async function selectDefaultAdapters(
  sourceType: CadSourceType,
  sourcePath: string,
): Promise<{ renderer: CadRenderAdapter; analyzer: Analyzer; mode: AnalysisMode }>;
```

Assert:

- DXF returns mode `vision`.
- `control-panel-a.dwg` returns mode `demo`.
- a temporary non-fixture DWG returns mode `vision` and the registered DWG renderer.
- converter errors map to Chinese stages/messages for missing executable, timeout/failure, missing output, and oversized output.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- src/lib/analysis/service.test.ts
```

Expected: FAIL because `selectDefaultAdapters` and DWG conversion failure mappings are absent.

- [ ] **Step 3: Implement mode-aware adapter selection**

Use direct `demoRenderer` and `demoAnalyzer` only when `isPreparedDemoDwg(sourcePath)` is true. For ordinary DWG return `getCadRenderer("dwg")`, `openAiVisionAnalyzer`, and mode `vision`.

Extend `AnalysisDeps` with:

```ts
analysisMode?: AnalysisMode;
```

Resolve mode in `runDrawingAnalysis`; use `consolidateVisionComponents` whenever mode is `vision`, regardless of whether the original file was DXF or DWG. Keep demo components unchanged when mode is `demo`.

Map internal errors to user-safe Chinese messages:

```ts
DWG_CONVERTER_NOT_INSTALLED    → "此 Mac 尚未安装 DWG 转换器。"
DWG_CONVERSION_TIMEOUT         → "DWG 转换超时，请尝试简化图纸后重试。"
DWG_CONVERSION_FAILED          → "DWG 转换失败，请确认文件未损坏且版本受支持。"
DWG_CONVERTER_OUTPUT_MISSING   → "DWG 转换未生成可分析的图纸。"
DWG_CONVERTER_OUTPUT_TOO_LARGE → "DWG 转换结果超过当前处理限制。"
```

- [ ] **Step 4: Run focused and regression tests**

```bash
npm test -- src/lib/analysis/service.test.ts src/lib/analysis/real-dxf.integration.test.ts src/lib/cad/demo-adapters.test.ts
npm run typecheck
```

Expected: all tests pass; fixture DWG remains deterministic and DXF behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analysis/service.ts src/lib/analysis/service.test.ts
git commit -m "feat: analyze converted DWG files with vision"
```

---

### Task 4: Install LibreDWG and verify a real local DWG round trip

**Files:**
- Create: `scripts/smoke-real-dwg.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Homebrew `dwg2dxf` and `dxf2dwg`, `fixtures/cad/synthetic-control-panel.dxf`, and `runDrawingAnalysis`.
- Produces: `npm run smoke:dwg` and a verified arbitrary-DWG demo path.

- [ ] **Step 1: Install LibreDWG**

Run:

```bash
brew install libredwg
dwg2dxf --version
dxf2dwg --version
```

Expected: both executables exit 0 and print the installed LibreDWG version.

- [ ] **Step 2: Write the smoke script**

The script must:

1. Create a temporary directory and ensure `data/smoke` exists.
2. Copy `synthetic-control-panel.dxf` into it.
3. Invoke `dxf2dwg --overwrite synthetic-control-panel.dxf` using `execFile` with that directory as `cwd`.
4. Assert `synthetic-control-panel.dwg` exists and starts with an `AC10` DWG signature.
5. Invoke `libreDwgConverter.convert` and parse the resulting DXF with `parseDxfFile`.
6. Assert at least one entity and text item survive the round trip.
7. Copy the generated DWG to `data/smoke/synthetic-control-panel.dwg` for browser testing.
8. Remove the temporary directory in `finally`.

Add:

```json
"smoke:dwg": "node --env-file-if-exists=.env.local --import tsx scripts/smoke-real-dwg.ts"
```

- [ ] **Step 3: Run the smoke test**

```bash
npm run smoke:dwg
```

Expected output contains a JSON object with `dwgBytes > 0`, `entities > 0`, `texts > 0`, and `outputPath` pointing to `data/smoke/synthetic-control-panel.dwg`.

- [ ] **Step 4: Run final verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all tests pass and every command exits 0.

- [ ] **Step 5: Test through the running application**

Upload `data/smoke/synthetic-control-panel.dwg` through the Ant Design X attachment control, send `分析这张 DWG 图纸，并按类别列出所有元件`, wait for status `requires_review` or `completed`, verify component rows and BOM exist, then download `元件分析清单.xlsx`.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-real-dwg.ts package.json
git commit -m "test: add real DWG conversion smoke workflow"
```
