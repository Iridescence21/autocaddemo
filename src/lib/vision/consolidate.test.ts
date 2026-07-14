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

function box(x: number, y: number, width: number, height: number): VisionDetection["location"] {
  return { x, y, width, height };
}

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

  it("does not merge two close repeated symbols with separate boxes", () => {
    const components = consolidateVisionComponents(result([
      detection({ temporaryId: "QF-1", label: "QF", location: box(0.40, 0.3, 0.08, 0.1) }),
      detection({ temporaryId: "QF-2", label: "QF", location: box(0.49, 0.3, 0.08, 0.1) }),
    ]), rendered);

    expect(components).toHaveLength(2);
  });

  it("merges the same high-overlap detection returned by verification", () => {
    const components = consolidateVisionComponents(result([
      detection({ temporaryId: "tile-1-enumerate-1", confidence: 0.75, evidence: ["enumerated"], location: box(0.4, 0.3, 0.1, 0.1) }),
      detection({ temporaryId: "tile-1-verify-1", confidence: 0.9, evidence: ["verified"], location: box(0.402, 0.301, 0.1, 0.1) }),
    ]), rendered);

    expect(components).toHaveLength(1);
    const [component] = components;
    if (!component) throw new Error("expected one consolidated component");
    if (!component.location) throw new Error("expected consolidated location");
    expect(component.temporaryId).toBe("tile-1-verify-1");
    expect(component.location.x).toBeCloseTo(0.2412);
    expect(component.location.y).toBeCloseTo(0.188125);
    expect(component.location.width).toBeCloseTo(0.06);
    expect(component.location.height).toBeCloseTo(0.0625);
    expect(component.evidence).toEqual(expect.arrayContaining(["enumerated", "verified"]));
  });

  it("keeps unknown when a high-overlap detection disagrees with a known category", () => {
    const components = consolidateVisionComponents(result([
      detection({
        temporaryId: "tile-1-enumerate-1",
        category: "unknown",
        label: null,
        confidence: 0.75,
        evidence: ["enumeration category claim: unknown"],
        tileId: "tile-1-1",
        location: box(0.75, 0.3, 0.1, 0.1),
      }),
      detection({
        temporaryId: "tile-1-verify-1",
        category: "contactor",
        label: "KM1",
        confidence: 0.9,
        evidence: ["verification category claim: contactor"],
        tileId: "tile-1-2",
        location: box(0.0833, 0.3, 0.1, 0.1),
      }),
    ]), rendered);

    expect(components).toHaveLength(1);
    const [component] = components;
    if (!component) throw new Error("expected one consolidated component");
    if (!component.location) throw new Error("expected consolidated location");
    expect(component.category).toBe("unknown");
    expect(component.reviewStatus).toBe("unknown");
    expect(component.temporaryId).toBe("tile-1-verify-1");
    expect(component.sourceTileId).toBe("tile-1-1,tile-1-2");
    expect(component.location.x).toBeCloseTo(0.44998);
    expect(component.location.y).toBeCloseTo(0.1875);
    expect(component.location.width).toBeCloseTo(0.06);
    expect(component.location.height).toBeCloseTo(0.0625);
    expect(component.evidence).toEqual(expect.arrayContaining([
      "enumeration category claim: unknown",
      "verification category claim: contactor",
      "category claim: unknown",
      "category claim: contactor",
    ]));
  });
});
