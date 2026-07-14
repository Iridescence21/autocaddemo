import { describe, expect, it } from "vitest";
import { consolidateVisionComponents } from "@/lib/vision/consolidate";
import type { RenderedCadDrawing } from "@/lib/cad/types";
import type { ValidatedVisionResult, VisionDetection } from "@/lib/vision/types";

const rendered: RenderedCadDrawing = {
  overviewImageUrl: "data:image/png;base64,overview",
  width: 1000,
  height: 800,
  tiles: [
    { id: "tile-1-1", imageUrl: "data:image/png;base64,a", x: 0, y: 0, width: 600, height: 500, overlap: 100, cadBounds: { minX: 0, minY: 0, maxX: 600, maxY: 500 }, entityCount: 1, textCount: 0, blockCount: 0 },
    { id: "tile-1-2", imageUrl: "data:image/png;base64,b", x: 400, y: 0, width: 600, height: 500, overlap: 100, cadBounds: { minX: 400, minY: 0, maxX: 1000, maxY: 500 }, entityCount: 1, textCount: 0, blockCount: 0 },
  ],
};

function detection(overrides: Partial<VisionDetection>): VisionDetection {
  return {
    temporaryId: "detection-001",
    category: "contactor",
    label: "KM1",
    description: "可能为接触器",
    manufacturer: null,
    modelNumber: null,
    specifications: ["24VDC"],
    confidence: 0.8,
    tileId: "tile-1-1",
    location: { x: 0.75, y: 0.3, width: 0.1, height: 0.1 },
    evidence: ["附近文字 KM1"],
    reviewRequired: true,
    ...overrides,
  };
}

function result(components: VisionDetection[]): ValidatedVisionResult {
  return {
    drawingSummary: "电气控制图",
    components,
    warnings: [],
    analysisDiagnostics: { attemptedTiles: 0, completedTiles: 0, failedTiles: 0, verificationTiles: 0, rawDetectionCount: components.length, coverageLimited: false },
  };
}

describe("vision detection consolidation", () => {
  it("merges the same component detected in overlapping tiles", () => {
    const components = consolidateVisionComponents(result([
      detection({ temporaryId: "left-KM1", tileId: "tile-1-1", location: { x: 0.75, y: 0.3, width: 0.1, height: 0.1 }, confidence: 0.77 }),
      detection({ temporaryId: "right-KM1", tileId: "tile-1-2", location: { x: 0.0833, y: 0.3, width: 0.1, height: 0.1 }, confidence: 0.89, evidence: ["接触器线圈形状"] }),
    ]), rendered);

    expect(components).toHaveLength(1);
    expect(components[0].temporaryId).toBe("right-KM1");
    expect(components[0].confidence).toBe(0.89);
    expect(components[0].sourceTileId).toBe("tile-1-1,tile-1-2");
    expect(components[0].evidence).toEqual(expect.arrayContaining(["附近文字 KM1", "接触器线圈形状"]));
    expect(components[0].method).toBe("openai_vision");
    expect(components[0].reviewStatus).toBe("requires_review");
  });

  it("keeps neighboring components separate and marks unknowns explicitly", () => {
    const components = consolidateVisionComponents(result([
      detection({ temporaryId: "QF1", category: "circuit_breaker", label: "QF1", location: { x: 0.2, y: 0.3, width: 0.08, height: 0.1 } }),
      detection({ temporaryId: "QF2", category: "circuit_breaker", label: "QF2", location: { x: 0.42, y: 0.3, width: 0.08, height: 0.1 } }),
      detection({ temporaryId: "U1", category: "unknown", label: null, location: { x: 0.7, y: 0.7, width: 0.06, height: 0.06 } }),
    ]), rendered);

    expect(components).toHaveLength(3);
    expect(components.filter((component) => component.category === "circuit_breaker")).toHaveLength(2);
    expect(components.find((component) => component.category === "unknown")?.reviewStatus).toBe("unknown");
    expect(components.find((component) => component.category === "unknown")?.manufacturer).toBeNull();
  });
});
