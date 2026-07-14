import { describe, expect, it } from "vitest";
import type { NormalizedDxfDrawing } from "@/lib/cad/dxf-types";
import type { RenderedCadDrawing } from "@/lib/cad/types";
import {
  buildStructuralEvidence,
  findNearbyStructuralEvidence,
  parseDeviceTags,
} from "@/lib/cad/structural-evidence";

const drawing: NormalizedDxfDrawing = {
  entities: [],
  blockDefinitions: {},
  layers: ["0"],
  blockNames: [],
  extents: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
  units: "millimeters",
  warnings: [],
  texts: [
    { value: "M-T1-02", layer: "0", handle: "sheet", position: { x: 10, y: 5 } },
    { value: "QF1", layer: "DEVICE", handle: "qf", position: { x: 20, y: 30 } },
    { value: "KA1,2,3", layer: "DEVICE", handle: "ka", position: { x: 40, y: 30 } },
    { value: "YCT1,2,3", layer: "DEVICE", handle: "yct", position: { x: 60, y: 30 } },
    { value: "TA1:1K2", layer: "WIRE", handle: "ta", position: { x: 80, y: 30 } },
    { value: "35/6~10KV变压器二次电路图", layer: "0", handle: "title", position: { x: 20, y: 10 } },
    { value: "418", layer: "WIRE", handle: "wire", position: { x: 50, y: 20 } },
  ],
};

const rendered: RenderedCadDrawing = {
  overviewImageUrl: "data:image/png;base64,test",
  width: 296,
  height: 196,
  tiles: [],
  metadata: { context: drawing },
};

describe("native CAD structural evidence", () => {
  it("recognizes controlled device tags and expands comma-family notation", () => {
    expect(parseDeviceTags("M-T1-02")).toEqual([]);
    expect(parseDeviceTags("QF1")).toEqual([{ tag: "QF1", category: "circuit_breaker" }]);
    expect(parseDeviceTags("KA1,2,3")).toEqual([
      { tag: "KA1", category: "relay" },
      { tag: "KA2", category: "relay" },
      { tag: "KA3", category: "relay" },
    ]);
    expect(parseDeviceTags("YCT1,2,3").map((item) => item.tag)).toEqual(["YCT1", "YCT2", "YCT3"]);
    expect(parseDeviceTags("TA1:1K2")).toEqual([{ tag: "TA1", category: "transformer" }]);
    expect(parseDeviceTags("35/6~10KV变压器二次电路图")).toEqual([]);
    expect(parseDeviceTags("418")).toEqual([]);
  });

  it("retains native handles and maps CAD coordinates into overview coordinates", () => {
    const evidence = buildStructuralEvidence(drawing, rendered);
    const breaker = evidence.find((item) => item.tag === "QF1");

    expect(breaker).toMatchObject({
      id: "cad-text:qf:QF1",
      rawText: "QF1",
      tag: "QF1",
      category: "circuit_breaker",
      handle: "qf",
      layer: "DEVICE",
      cadPosition: { x: 20, y: 30 },
      overviewPosition: { x: 88 / 296, y: 88 / 196 },
      method: "cad_native_text",
    });
    expect(evidence.some((item) => item.rawText === "M-T1-02")).toBe(false);
  });

  it("returns nearby native evidence before farther evidence", () => {
    const evidence = buildStructuralEvidence(drawing, rendered);
    const nearby = findNearbyStructuralEvidence(evidence, {
      x: 0.22,
      y: 0.48,
      width: 0.18,
      height: 0.18,
    }, { margin: 0.04, maxDistance: 0.22 });

    expect(nearby[0].tag).toBe("QF1");
    expect(nearby.some((item) => item.tag === "TA1")).toBe(false);
  });
});
