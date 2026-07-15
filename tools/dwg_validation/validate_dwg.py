from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import ezdxf
from ezdxf import bbox
from ezdxf.addons.drawing.matplotlib import qsave
from PIL import Image


ConverterRunner = Callable[..., subprocess.CompletedProcess[str]]


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
    prefix = output_path.read_bytes()[:4096]
    if prefix.startswith(b"AutoCAD Binary DXF") or b"SECTION" not in prefix:
        raise ValidationFailure("DXF_NOT_ASCII", str(output_path))
    return output_path


def stable_entity_id(layout: str, handle: str | None, index: int) -> str:
    return f"{layout}:{handle}" if handle else f"{layout}:index-{index}"


def vector_json(value: Any) -> list[float] | None:
    if value is None:
        return None
    try:
        return [float(value.x), float(value.y), float(getattr(value, "z", 0.0))]
    except (AttributeError, TypeError, ValueError):
        return None


def box_json(value: Any) -> dict[str, float] | None:
    if value is None or not getattr(value, "has_data", False):
        return None
    return {
        "min_x": float(value.extmin.x),
        "min_y": float(value.extmin.y),
        "max_x": float(value.extmax.x),
        "max_y": float(value.extmax.y),
    }


def plain_text(entity: Any) -> str | None:
    entity_type = entity.dxftype()
    if entity_type == "MTEXT":
        return entity.plain_text().strip()
    if entity_type in {"TEXT", "ATTRIB", "ATTDEF"}:
        return str(entity.dxf.get("text", "")).strip()
    return None


def serialize_entity(layout: str, index: int, entity: Any, cache: bbox.Cache) -> dict[str, Any]:
    entity_type = entity.dxftype()
    handle = entity.dxf.get("handle")
    bounds = box_json(bbox.extents([entity], fast=True, cache=cache))
    record: dict[str, Any] = {
        "id": stable_entity_id(layout, str(handle) if handle else None, index),
        "handle": str(handle) if handle else None,
        "layout": layout,
        "type": entity_type,
        "layer": str(entity.dxf.get("layer", "0")),
        "color": int(entity.dxf.get("color", 256)),
        "linetype": str(entity.dxf.get("linetype", "BYLAYER")),
        "bounds": bounds,
    }
    text = plain_text(entity)
    if text is not None:
        record["text"] = text
        record["insert"] = vector_json(entity.dxf.get("insert"))
        record["height"] = float(entity.dxf.get("height", 0.0))
        record["rotation"] = float(entity.dxf.get("rotation", 0.0))
    elif entity_type == "INSERT":
        record.update({
            "name": str(entity.dxf.get("name", "")),
            "insert": vector_json(entity.dxf.get("insert")),
            "xscale": float(entity.dxf.get("xscale", 1.0)),
            "yscale": float(entity.dxf.get("yscale", 1.0)),
            "rotation": float(entity.dxf.get("rotation", 0.0)),
            "attributes": [
                {"tag": str(attrib.dxf.get("tag", "")), "text": str(attrib.dxf.get("text", "")), "handle": attrib.dxf.get("handle")}
                for attrib in entity.attribs
            ],
        })
    elif entity_type == "LINE":
        record["start"] = vector_json(entity.dxf.get("start"))
        record["end"] = vector_json(entity.dxf.get("end"))
    elif entity_type == "LWPOLYLINE":
        record["points"] = [[float(p[0]), float(p[1])] for p in entity.get_points("xy")]
        record["closed"] = bool(entity.closed)
    elif entity_type in {"CIRCLE", "ARC"}:
        record["center"] = vector_json(entity.dxf.get("center"))
        record["radius"] = float(entity.dxf.get("radius", 0.0))
        if entity_type == "ARC":
            record["start_angle"] = float(entity.dxf.get("start_angle", 0.0))
            record["end_angle"] = float(entity.dxf.get("end_angle", 0.0))
    return record


def extract_dxf_evidence(dxf_path: Path) -> dict[str, Any]:
    try:
        doc = ezdxf.readfile(dxf_path)
    except (OSError, ezdxf.DXFError) as error:
        raise ValidationFailure("DXF_PARSE_FAILED", str(error)) from error
    auditor = doc.audit()
    cache = bbox.Cache()
    layouts: list[dict[str, Any]] = []
    entities: list[dict[str, Any]] = []
    texts: list[dict[str, Any]] = []
    entity_counts: Counter[str] = Counter()
    for layout in doc.layouts:
        layout_count = 0
        for index, entity in enumerate(layout):
            entity_counts[entity.dxftype()] += 1
            layout_count += 1
            record = serialize_entity(layout.name, index, entity, cache)
            entities.append(record)
            if entity.dxftype() in {"TEXT", "MTEXT", "ATTRIB", "ATTDEF"}:
                texts.append(record)
        layouts.append({"name": layout.name, "entity_count": layout_count})
    blocks = [
        {
            "name": block.name,
            "entity_count": len(block),
            "base_point": vector_json(block.block.dxf.get("base_point")),
        }
        for block in doc.blocks
        if not block.name.startswith("*")
    ]
    drawing_extents = box_json(bbox.extents(doc.modelspace(), fast=True, cache=cache))
    if drawing_extents is None:
        raise ValidationFailure("DXF_EXTENTS_EMPTY", dxf_path.name)
    unsupported = sorted(entity_type for entity_type in entity_counts if entity_type not in {
        "LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC", "ELLIPSE", "SPLINE",
        "TEXT", "MTEXT", "INSERT", "ATTRIB", "ATTDEF", "DIMENSION", "POINT", "HATCH",
    })
    return {
        "audit": {"errors": len(auditor.errors), "fixes": len(auditor.fixes)},
        "extents": drawing_extents,
        "layouts": layouts,
        "entity_counts": dict(sorted(entity_counts.items())),
        "entities": entities,
        "blocks": blocks,
        "texts": texts,
        "layers": sorted(layer.dxf.name for layer in doc.layers),
        "warnings": [f"Unsupported entity type for detailed serialization: {item}" for item in unsupported],
    }


def render_dxf(dxf_path: Path, output_path: Path) -> dict[str, int]:
    try:
        doc = ezdxf.readfile(dxf_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        qsave(doc.modelspace(), output_path, bg="#000000", fg="#FFFFFF", dpi=180)
    except Exception as error:
        raise ValidationFailure("DXF_RENDER_FAILED", str(error)) from error
    with Image.open(output_path) as image:
        rgb = image.convert("RGB")
        sample = rgb.resize((256, 256))
        pixels = list(sample.get_flattened_data())
        non_background = sum(1 for pixel in pixels if max(pixel) > 8)
        colors = len(set(pixels))
        if non_background == 0 or colors < 2:
            raise ValidationFailure("DXF_RENDER_EMPTY", dxf_path.name)
        return {"width": image.width, "height": image.height, "non_background_pixels": non_background}


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def native_text_values(evidence: Mapping[str, Any]) -> list[str]:
    values: list[str] = []
    for record in evidence.get("texts", []):
        text = record.get("text")
        if isinstance(text, str) and text.strip():
            values.append(text.strip())
    for record in evidence.get("entities", []):
        if record.get("type") == "INSERT":
            for attrib in record.get("attributes", []):
                text = attrib.get("text")
                if isinstance(text, str) and text.strip():
                    values.append(text.strip())
    return values


def validate_one(source: Path, output_root: Path, converter: str, required_terms: Sequence[str]) -> dict[str, Any]:
    output_dir = output_root / source.stem
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {
        "source": {"name": source.name, "path": str(source), "sha256": None, "dwg_header": None},
        "passed": False,
        "checks": {},
        "counts": {},
        "warnings": [],
        "error": None,
    }
    try:
        manifest["source"]["sha256"] = sha256_file(source)
        manifest["source"]["dwg_header"] = read_dwg_header(source)
        manifest["checks"]["dwg_header"] = True
        dxf_path = run_converter(source, output_dir, converter)
        manifest["checks"]["conversion"] = True
        manifest["dxf"] = {"path": dxf_path.name, "sha256": sha256_file(dxf_path), "bytes": dxf_path.stat().st_size}
        evidence = extract_dxf_evidence(dxf_path)
        manifest["checks"]["parse"] = True
        manifest["checks"]["finite_extents"] = evidence["extents"] is not None
        values = native_text_values(evidence)
        manifest["checks"]["native_text"] = bool(values)
        folded = "\n".join(values).casefold()
        matched_terms = [term for term in required_terms if term.casefold() in folded]
        manifest["checks"]["required_terms"] = not required_terms or bool(matched_terms)
        render_info = render_dxf(dxf_path, output_dir / "overview.png")
        manifest["checks"]["render"] = True
        manifest["counts"] = {
            "entities": len(evidence["entities"]),
            "texts": len(values),
            "blocks": len(evidence["blocks"]),
            "layers": len(evidence["layers"]),
            "entity_types": evidence["entity_counts"],
        }
        manifest["matched_terms"] = matched_terms
        manifest["render"] = render_info
        manifest["warnings"] = evidence["warnings"]
        write_json(output_dir / "entities.json", evidence["entities"])
        write_json(output_dir / "blocks.json", evidence["blocks"])
        write_json(output_dir / "texts.json", values)
        write_json(output_dir / "layers.json", evidence["layers"])
        manifest["passed"] = all(manifest["checks"].values())
    except (ValidationFailure, OSError) as error:
        code = error.code if isinstance(error, ValidationFailure) else "VALIDATION_IO_ERROR"
        message = error.message if isinstance(error, ValidationFailure) else str(error)
        manifest["error"] = {"code": code, "message": message}
    write_json(output_dir / "manifest.json", manifest)
    checks = "\n".join(f"- {'PASS' if passed else 'FAIL'}: {name}" for name, passed in manifest["checks"].items())
    error_line = "" if manifest["error"] is None else f"\n- Error: `{manifest['error']['code']}` {manifest['error']['message']}"
    report = f"# {source.name} validation\n\n- Result: {'PASS' if manifest['passed'] else 'FAIL'}\n{checks}{error_line}\n"
    (output_dir / "validation-report.md").write_text(report, encoding="utf-8")
    return manifest


def run_gate(
    sources: Sequence[Path],
    output_root: Path,
    converter: str,
    required_terms: Mapping[str, Sequence[str]],
) -> dict[str, Any]:
    output_root.mkdir(parents=True, exist_ok=True)
    results = [validate_one(source, output_root, converter, required_terms.get(source.stem, ())) for source in sources]
    gate = {
        "passed": bool(results) and all(result["passed"] for result in results),
        "converter": converter,
        "results": [
            {
                "source": result["source"]["name"],
                "passed": result["passed"],
                "checks": result["checks"],
                "error": result["error"],
            }
            for result in results
        ],
    }
    write_json(output_root / "gate-manifest.json", gate)
    return gate


def parse_required_terms(values: Sequence[str]) -> dict[str, list[str]]:
    parsed: dict[str, list[str]] = {}
    for value in values:
        if "=" not in value:
            raise ValidationFailure("REQUIRED_TERM_INVALID", value)
        source, terms = value.split("=", 1)
        parsed[source] = [term.strip() for term in terms.split(",") if term.strip()]
    return parsed


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate real DWG conversion, native evidence, and rendering")
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("--converter", default="dwg2dxf")
    parser.add_argument("--output", type=Path, default=Path(".artifacts/dwg-validation"))
    parser.add_argument("--required-term", action="append", default=[])
    args = parser.parse_args(argv)
    gate = run_gate(args.sources, args.output, args.converter, parse_required_terms(args.required_term))
    for result in gate["results"]:
        suffix = "" if result["error"] is None else f" ({result['error']['code']})"
        print(f"{'PASS' if result['passed'] else 'FAIL'} {result['source']}{suffix}")
    print(f"GATE {'PASS' if gate['passed'] else 'FAIL'}")
    return 0 if gate["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
