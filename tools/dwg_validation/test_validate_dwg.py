from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

import ezdxf

from tools.dwg_validation.validate_dwg import (
    ValidationFailure,
    extract_dxf_evidence,
    read_dwg_header,
    render_dxf,
    run_converter,
    stable_entity_id,
)


class DwgValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.output_dir = self.root / "output"
        self.source = self.write_bytes("sample.dwg", b"AC1018\x00" + b"x" * 64)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_bytes(self, name: str, value: bytes) -> Path:
        path = self.root / name
        path.write_bytes(value)
        return path

    def make_sample_dxf(self, path: Path) -> None:
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

    def test_read_dwg_header_accepts_ac1018(self) -> None:
        self.assertEqual(read_dwg_header(self.source), "AC1018")

    def test_read_dwg_header_rejects_non_dwg(self) -> None:
        source = self.write_bytes("bad.dwg", b"not-a-dwg")
        with self.assertRaisesRegex(ValidationFailure, "DWG_HEADER_INVALID"):
            read_dwg_header(source)

    def test_run_converter_requires_output(self) -> None:
        def runner(*args, **kwargs):
            return subprocess.CompletedProcess(args[0], 0, "", "")
        with self.assertRaisesRegex(ValidationFailure, "DWG_CONVERTER_OUTPUT_MISSING"):
            run_converter(self.source, self.output_dir, "dwg2dxf", runner)

    def test_run_converter_returns_ascii_dxf(self) -> None:
        def runner(command, **kwargs):
            self.output_dir.mkdir(parents=True, exist_ok=True)
            (self.output_dir / "sample.dxf").write_text("999\nLibreDWG\n0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n")
            return subprocess.CompletedProcess(command, 0, "", "")
        self.assertEqual(run_converter(self.source, self.output_dir, "dwg2dxf", runner), self.output_dir / "sample.dxf")

    def test_stable_entity_id_prefers_handle(self) -> None:
        self.assertEqual(stable_entity_id("Model", "AB", 2), "Model:AB")
        self.assertEqual(stable_entity_id("Model", None, 2), "Model:index-2")

    def test_extract_dxf_evidence(self) -> None:
        dxf_path = self.root / "sample.dxf"
        self.make_sample_dxf(dxf_path)
        evidence = extract_dxf_evidence(dxf_path)
        self.assertEqual(evidence["texts"][0]["text"], "KA1")
        self.assertIn("RELAY_COIL", [block["name"] for block in evidence["blocks"]])
        self.assertGreater(len(evidence["entities"]), 0)
        self.assertTrue(all(record["id"] and record["type"] and record["layer"] for record in evidence["entities"]))
        self.assertLess(evidence["extents"]["min_x"], evidence["extents"]["max_x"])

    def test_render_dxf(self) -> None:
        dxf_path = self.root / "sample.dxf"
        png_path = self.root / "sample.png"
        self.make_sample_dxf(dxf_path)
        dimensions = render_dxf(dxf_path, png_path)
        self.assertTrue(png_path.is_file())
        self.assertGreater(dimensions["width"], 100)
        self.assertGreater(dimensions["height"], 100)
        self.assertGreater(dimensions["non_background_pixels"], 0)


if __name__ == "__main__":
    unittest.main()
