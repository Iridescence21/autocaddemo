# DWG Python Validation Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove with an independent Python harness that `M-T1-01.dwg` and `M-T1-02.dwg` can be converted to ASCII DXF, parsed into native CAD evidence, and rendered to non-empty PNGs before any application code changes.

**Architecture:** A repository-local Python package invokes LibreDWG through a bounded subprocess, inspects the resulting DXF with `ezdxf`, writes traceable JSON evidence, renders with the `ezdxf` Matplotlib backend, and emits a per-file report plus an aggregate gate manifest. Tests inject the converter runner and use generated DXF fixtures so automated verification never depends on real confidential DWG files.

**Tech Stack:** Python 3.12, Python `unittest`, LibreDWG 0.13.3, ezdxf 1.4.4, Matplotlib 3.11.0, Pillow from the bundled Codex Python runtime.

## Global Constraints

- Do not modify application TypeScript, Prisma, API, UI, or database code during this plan.
- Do not copy or commit the supplied DWG files or generated DXF files.
- Write generated validation artifacts only under `.artifacts/dwg-validation/`.
- Preserve a source hash and source handle or stable validation ID for every extracted record.
- Treat `M-T1-01` and `M-T1-02` as related sheets, not revisions.
- Stop after the validation report if either drawing fails conversion, parsing, text recovery, or rendering.
- Do not substitute prepared fixture output for either real drawing.

---

## File Structure

- Create `tools/__init__.py`: marks repository tools as an importable Python package.
- Create `tools/dwg_validation/__init__.py`: exposes the validation package.
- Create `tools/dwg_validation/requirements.txt`: pins validation-only Python dependencies.
- Create `tools/dwg_validation/validate_dwg.py`: conversion, extraction, rendering, reporting, and CLI orchestration.
- Create `tools/dwg_validation/test_validate_dwg.py`: unit tests for header validation, converter boundaries, evidence extraction, rendering, and gate aggregation.
- Create `tools/dwg_validation/README.md`: exact environment, install, test, and real-file commands.
- Modify `.gitignore`: excludes `.artifacts/` and `.venv-dwg-validation/`.

### Task 1: Validation package and converter boundary

**Files:**
- Create: `tools/__init__.py`
- Create: `tools/dwg_validation/__init__.py`
- Create: `tools/dwg_validation/requirements.txt`
- Create: `tools/dwg_validation/validate_dwg.py`
- Create: `tools/dwg_validation/test_validate_dwg.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `read_dwg_header(path: Path) -> str`
- Produces: `sha256_file(path: Path) -> str`
- Produces: `run_converter(source: Path, output_dir: Path, executable: str, runner: ConverterRunner = subprocess.run) -> Path`
- Produces: `ValidationFailure(code: str, message: str)`

- [ ] **Step 1: Add validation-only ignores and package markers**

Add these entries to `.gitignore`:

```gitignore
.artifacts/
.venv-dwg-validation/
```

Create empty `tools/__init__.py` and `tools/dwg_validation/__init__.py` files.

- [ ] **Step 2: Pin validation dependencies**

Create `tools/dwg_validation/requirements.txt`:

```text
ezdxf==1.4.4
matplotlib==3.11.0
```

Pillow is supplied by the selected Python 3.12 runtime and is not duplicated in this file.

- [ ] **Step 3: Write failing converter-boundary tests**

Create tests that assert:

```python
def test_read_dwg_header_accepts_ac1018(self):
    source = self.write_bytes("sample.dwg", b"AC1018\x00" + b"x" * 64)
    self.assertEqual(read_dwg_header(source), "AC1018")

def test_read_dwg_header_rejects_non_dwg(self):
    source = self.write_bytes("sample.dwg", b"not-a-dwg")
    with self.assertRaisesRegex(ValidationFailure, "DWG_HEADER_INVALID"):
        read_dwg_header(source)

def test_run_converter_requires_output(self):
    def runner(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], 0, "", "")
    with self.assertRaisesRegex(ValidationFailure, "DWG_CONVERTER_OUTPUT_MISSING"):
        run_converter(self.source, self.output_dir, "dwg2dxf", runner)

def test_run_converter_returns_ascii_dxf(self):
    def runner(command, **kwargs):
        (self.output_dir / "sample.dxf").write_text("0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n")
        return subprocess.CompletedProcess(command, 0, "", "")
    self.assertEqual(run_converter(self.source, self.output_dir, "dwg2dxf", runner), self.output_dir / "sample.dxf")
```

- [ ] **Step 4: Run tests and confirm the expected import failure**

Run:

```bash
PY=/Users/ljp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
$PY -m unittest tools.dwg_validation.test_validate_dwg -v
```

Expected: `ERROR` because `tools.dwg_validation.validate_dwg` does not yet define the imported interfaces.

- [ ] **Step 5: Implement the bounded converter boundary**

Implement:

```python
class ValidationFailure(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


def read_dwg_header(path: Path) -> str:
    header = path.read_bytes()[:6].decode("ascii", errors="replace")
    if not re.fullmatch(r"AC\d{4}", header):
        raise ValidationFailure("DWG_HEADER_INVALID", f"Unexpected DWG header {header!r}")
    return header


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_converter(
    source: Path,
    output_dir: Path,
    executable: str,
    runner: ConverterRunner = subprocess.run,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{source.stem}.dxf"
    try:
        completed = runner(
            [executable, "--overwrite", str(source.resolve())],
            cwd=output_dir,
            text=True,
            capture_output=True,
            timeout=120,
            check=False,
        )
    except FileNotFoundError as error:
        raise ValidationFailure("DWG_CONVERTER_NOT_INSTALLED", executable) from error
    except subprocess.TimeoutExpired as error:
        raise ValidationFailure("DWG_CONVERSION_TIMEOUT", source.name) from error
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "conversion failed")[-4000:]
        raise ValidationFailure("DWG_CONVERSION_FAILED", detail)
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise ValidationFailure("DWG_CONVERTER_OUTPUT_MISSING", str(output_path))
    if output_path.stat().st_size > 100 * 1024 * 1024:
        raise ValidationFailure("DWG_CONVERTER_OUTPUT_TOO_LARGE", str(output_path.stat().st_size))
    prefix = output_path.read_bytes()[:128].lstrip()
    if not prefix.startswith(b"0"):
        raise ValidationFailure("DXF_NOT_ASCII", str(output_path))
    return output_path
```

- [ ] **Step 6: Run converter-boundary tests**

Run the same `unittest` command.

Expected: all Task 1 tests pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add .gitignore tools/__init__.py tools/dwg_validation/__init__.py tools/dwg_validation/requirements.txt tools/dwg_validation/validate_dwg.py tools/dwg_validation/test_validate_dwg.py
git commit -m "test: add isolated DWG validation boundary"
```

### Task 2: Native DXF evidence extraction

**Files:**
- Modify: `tools/dwg_validation/validate_dwg.py`
- Modify: `tools/dwg_validation/test_validate_dwg.py`

**Interfaces:**
- Consumes: `run_converter(...) -> Path`
- Produces: `extract_dxf_evidence(dxf_path: Path) -> dict[str, object]`
- Produces: `stable_entity_id(layout: str, handle: str | None, index: int) -> str`
- Produces evidence keys: `audit`, `extents`, `layouts`, `entity_counts`, `entities`, `blocks`, `texts`, `layers`, `warnings`

- [ ] **Step 1: Write a generated DXF fixture helper and failing extraction tests**

Generate a DXF inside the test rather than committing fixture data:

```python
def make_sample_dxf(path: Path) -> None:
    doc = ezdxf.new("R2010")
    doc.layers.add("ELECTRICAL")
    block = doc.blocks.new("RELAY_COIL")
    block.add_line((0, 0), (4, 0), dxfattribs={"layer": "ELECTRICAL"})
    block.add_circle((2, 0), 1, dxfattribs={"layer": "ELECTRICAL"})
    model = doc.modelspace()
    model.add_blockref("RELAY_COIL", (10, 20), dxfattribs={"layer": "ELECTRICAL"})
    model.add_text("KA1", height=2, dxfattribs={"layer": "ELECTRICAL"}).set_placement((10, 24))
    model.add_line((0, 0), (20, 0), dxfattribs={"layer": "ELECTRICAL"})
    doc.saveas(path)
```

Assert that extraction returns finite extents, a `RELAY_COIL` block, native text `KA1`, non-empty entity counts, and stable IDs containing either the native handle or layout/index fallback.

- [ ] **Step 2: Run the extraction test and confirm failure**

Run:

```bash
$PY -m unittest tools.dwg_validation.test_validate_dwg.DwgValidationTests.test_extract_dxf_evidence -v
```

Expected: `ERROR` because `extract_dxf_evidence` is undefined.

- [ ] **Step 3: Implement safe JSON extraction**

Use `ezdxf.readfile`, `doc.audit()`, and `ezdxf.bbox.extents`. Serialize only bounded fields needed for validation:

```python
SUPPORTED_TYPES = {
    "LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC", "ELLIPSE",
    "TEXT", "MTEXT", "INSERT", "ATTRIB", "DIMENSION", "POINT",
}


def stable_entity_id(layout: str, handle: str | None, index: int) -> str:
    return f"{layout}:{handle}" if handle else f"{layout}:index-{index}"


def extract_dxf_evidence(dxf_path: Path) -> dict[str, object]:
    try:
        doc = ezdxf.readfile(dxf_path)
    except (IOError, ezdxf.DXFError) as error:
        raise ValidationFailure("DXF_PARSE_FAILED", str(error)) from error
    auditor = doc.audit()
    layouts: list[dict[str, object]] = []
    entities: list[dict[str, object]] = []
    texts: list[dict[str, object]] = []
    entity_counts: Counter[str] = Counter()
    for layout in doc.layouts:
        layout_count = 0
        for index, entity in enumerate(layout):
            entity_type = entity.dxftype()
            entity_counts[entity_type] += 1
            layout_count += 1
            handle = entity.dxf.get("handle")
            record = serialize_entity(layout.name, index, entity)
            entities.append(record)
            if entity_type in {"TEXT", "MTEXT", "ATTRIB"}:
                texts.append(record)
        layouts.append({"name": layout.name, "entity_count": layout_count})
    blocks = [
        {"name": block.name, "entity_count": len(block), "base_point": vector_json(block.block.dxf.base_point)}
        for block in doc.blocks
        if not block.name.startswith("*")
    ]
    drawing_extents = bbox.extents(doc.modelspace(), fast=True)
    extents = box_json(drawing_extents)
    if extents is None:
        raise ValidationFailure("DXF_EXTENTS_EMPTY", dxf_path.name)
    return {
        "audit": {"errors": len(auditor.errors), "fixes": len(auditor.fixes)},
        "extents": extents,
        "layouts": layouts,
        "entity_counts": dict(sorted(entity_counts.items())),
        "entities": entities,
        "blocks": blocks,
        "texts": texts,
        "layers": sorted(layer.dxf.name for layer in doc.layers),
        "warnings": unsupported_entity_warnings(entity_counts),
    }
```

`serialize_entity` must include `id`, `handle`, `layout`, `type`, `layer`, `color`, `linetype`, bounds, and type-specific values. For `INSERT`, include block name, insertion point, scale, rotation, and attached attributes. For text-like entities, include raw text and plain text.

- [ ] **Step 4: Add bounded serialization tests**

Assert that no entity record lacks `id`, `type`, `layer`, or `bounds`; assert that text and insert values survive JSON serialization through `json.dumps`.

- [ ] **Step 5: Run the full validation test module**

Run:

```bash
$PY -m unittest tools.dwg_validation.test_validate_dwg -v
```

Expected: all Task 1 and Task 2 tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add tools/dwg_validation/validate_dwg.py tools/dwg_validation/test_validate_dwg.py
git commit -m "feat: extract native evidence from converted DXF"
```

### Task 3: Rendering, artifacts, and aggregate gate

**Files:**
- Modify: `tools/dwg_validation/validate_dwg.py`
- Modify: `tools/dwg_validation/test_validate_dwg.py`
- Create: `tools/dwg_validation/README.md`

**Interfaces:**
- Consumes: `extract_dxf_evidence(dxf_path: Path) -> dict[str, object]`
- Produces: `render_dxf(dxf_path: Path, output_path: Path) -> dict[str, int]`
- Produces: `validate_one(source: Path, output_root: Path, converter: str) -> dict[str, object]`
- Produces: `run_gate(sources: Sequence[Path], output_root: Path, converter: str, required_terms: Mapping[str, Sequence[str]]) -> dict[str, object]`

- [ ] **Step 1: Write failing rendering and gate tests**

Use the generated DXF fixture and assert:

```python
dimensions = render_dxf(dxf_path, png_path)
self.assertTrue(png_path.is_file())
self.assertGreater(dimensions["width"], 100)
self.assertGreater(dimensions["height"], 100)
self.assertGreater(dimensions["non_background_pixels"], 0)
```

For the gate, inject or patch conversion so two fake DWG inputs produce sample DXFs. Assert `passed` is true only when conversion, extents, native text, required-term matching, and rendering all pass.

- [ ] **Step 2: Run the new tests and confirm failure**

Run:

```bash
$PY -m unittest tools.dwg_validation.test_validate_dwg.DwgValidationTests.test_render_dxf tools.dwg_validation.test_validate_dwg.DwgValidationTests.test_run_gate -v
```

Expected: `ERROR` because rendering and gate functions are undefined.

- [ ] **Step 3: Implement high-resolution rendering**

Use the non-interactive Matplotlib backend before importing pyplot:

```python
matplotlib.use("Agg")


def render_dxf(dxf_path: Path, output_path: Path) -> dict[str, int]:
    doc = ezdxf.readfile(dxf_path)
    figure = plt.figure(figsize=(24, 16), dpi=150, facecolor="black")
    axes = figure.add_axes((0, 0, 1, 1), facecolor="black")
    context = RenderContext(doc)
    backend = MatplotlibBackend(axes)
    Frontend(context, backend).draw_layout(doc.modelspace(), finalize=True)
    axes.set_axis_off()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=150, facecolor="black", bbox_inches="tight", pad_inches=0.02)
    plt.close(figure)
    with Image.open(output_path) as image:
        rgb = image.convert("RGB")
        extrema = rgb.getextrema()
        non_background = sum(1 for pixel in rgb.resize((256, 256)).getdata() if max(pixel) > 8)
        if non_background == 0 or all(low == high for low, high in extrema):
            raise ValidationFailure("DXF_RENDER_EMPTY", dxf_path.name)
        return {"width": image.width, "height": image.height, "non_background_pixels": non_background}
```

- [ ] **Step 4: Implement per-file artifacts and gate manifest**

`validate_one` writes:

- `manifest.json` with source hash/header, converter, DXF hash, pass/fail checks, artifact filenames, and warnings.
- `entities.json`, `blocks.json`, `texts.json`, and `layers.json` from native evidence.
- `overview.png` from the renderer.
- `validation-report.md` containing the same checks in readable form.

`run_gate` writes `.artifacts/dwg-validation/gate-manifest.json` and returns exit code `0` only when every source passes. Required-term matching is case-insensitive and searches native `TEXT`, `MTEXT`, and `ATTRIB` plain text. For `M-T1-02`, passing requires at least one of `M-T1-02`, `TA1`, `KA1`, or `YCT1`.

- [ ] **Step 5: Add a complete argparse CLI**

The CLI signature is:

```text
python -m tools.dwg_validation.validate_dwg \
  --converter /opt/homebrew/bin/dwg2dxf \
  --output .artifacts/dwg-validation \
  --required-term M-T1-02=M-T1-02,TA1,KA1,YCT1 \
  /absolute/path/M-T1-01.dwg \
  /absolute/path/M-T1-02.dwg
```

It prints a compact summary for each file and the aggregate gate result. It never prints full entity JSON or source bytes.

- [ ] **Step 6: Document exact local commands**

Create `tools/dwg_validation/README.md` with:

```bash
brew install libredwg

PY=/Users/ljp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
$PY -m venv .venv-dwg-validation
.venv-dwg-validation/bin/python -m pip install --upgrade pip
.venv-dwg-validation/bin/python -m pip install -r tools/dwg_validation/requirements.txt
.venv-dwg-validation/bin/python -m unittest tools.dwg_validation.test_validate_dwg -v
```

Then include the full two-file real validation command with quoted absolute paths.

- [ ] **Step 7: Run all unit tests**

Run:

```bash
.venv-dwg-validation/bin/python -m unittest tools.dwg_validation.test_validate_dwg -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit Task 3**

```bash
git add tools/dwg_validation/validate_dwg.py tools/dwg_validation/test_validate_dwg.py tools/dwg_validation/README.md
git commit -m "feat: render and report real DWG validation"
```

### Task 4: Run the real-file validation gate

**Files:**
- Generated but ignored: `.venv-dwg-validation/`
- Generated but ignored: `.artifacts/dwg-validation/`
- No application code modifications.

**Interfaces:**
- Consumes the Task 3 CLI.
- Produces `.artifacts/dwg-validation/gate-manifest.json` and per-file evidence/report artifacts.

- [ ] **Step 1: Install LibreDWG 0.13.3**

Run:

```bash
brew install libredwg
dwg2dxf --version
```

Expected: LibreDWG reports version `0.13.3` and `dwg2dxf` is discoverable.

- [ ] **Step 2: Create the isolated Python 3.12 environment**

Run the README environment commands.

Expected: `ezdxf 1.4.4` and `matplotlib 3.11.0` install inside `.venv-dwg-validation` without modifying system Python.

- [ ] **Step 3: Re-run unit tests inside the isolated environment**

Expected: all validation tests pass.

- [ ] **Step 4: Run the real two-file gate**

Run:

```bash
.venv-dwg-validation/bin/python -m tools.dwg_validation.validate_dwg \
  --converter "$(command -v dwg2dxf)" \
  --output .artifacts/dwg-validation \
  --required-term M-T1-02=M-T1-02,TA1,KA1,YCT1 \
  '/Users/ljp/Documents/10KV高压配电柜一二次系统原理/35-6~10KV变压器二次电路图/M-T1-01.dwg' \
  '/Users/ljp/Documents/10KV高压配电柜一二次系统原理/35-6~10KV变压器二次电路图/M-T1-02.dwg'
```

Expected: process exits `0`, both files report `PASS`, and the aggregate manifest has `"passed": true`.

- [ ] **Step 5: Visually inspect both rendered PNGs**

Open with the image inspection tool:

- `.artifacts/dwg-validation/M-T1-01/overview.png`
- `.artifacts/dwg-validation/M-T1-02/overview.png`

Expected: both pages contain readable drawing geometry rather than a blank or clipped image.

- [ ] **Step 6: Inspect native evidence and reports**

Run:

```bash
jq '{passed, source, checks, counts, warnings}' .artifacts/dwg-validation/M-T1-01/manifest.json
jq '{passed, source, checks, counts, warnings}' .artifacts/dwg-validation/M-T1-02/manifest.json
jq '.' .artifacts/dwg-validation/gate-manifest.json
```

Expected: finite extents, non-zero entity/text counts, preserved handles, and required `M-T1-02` evidence.

- [ ] **Step 7: Apply the gate decision**

If `passed` is false, stop and report the exact converter, text, extents, or rendering failure without modifying application code.

If `passed` is true, record the verified converter command, entity/text/block counts, known recovered tags, render dimensions, and warnings. Then create the separate application integration implementation plan based on the actual evidence shape.
