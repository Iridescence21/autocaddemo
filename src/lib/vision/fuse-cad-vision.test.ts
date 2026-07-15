import { describe, expect, it } from "vitest";
import type { ComponentInput } from "@/lib/domain";
import type { StructuralTextEvidence } from "@/lib/cad/structural-evidence";
import { fuseCadAndVisionComponents } from "@/lib/vision/fuse-cad-vision";

function visual(overrides: Partial<ComponentInput> = {}): ComponentInput {
  return {
    temporaryId: "visual-1",
    category: "circuit_breaker",
    tag: "QF1",
    description: "可能为断路器",
    specifications: [],
    manufacturer: null,
    modelNumber: null,
    confidence: 0.78,
    evidence: ["视觉断路器符号"],
    method: "openai_vision",
    reviewStatus: "requires_review",
    sourceTileId: "tile-1",
    location: { x: 0.4, y: 0.4, width: 0.1, height: 0.1 },
    ...overrides,
  };
}

function cad(overrides: Partial<StructuralTextEvidence> = {}): StructuralTextEvidence {
  return {
    id: "cad-text:10:QF1",
    rawText: "QF1",
    tag: "QF1",
    category: "circuit_breaker",
    handle: "10",
    layer: "DEVICE",
    cadPosition: { x: 100, y: 100 },
    overviewPosition: { x: 0.45, y: 0.45 },
    confidence: 0.99,
    method: "cad_native_text",
    ...overrides,
  };
}

describe("CAD and vision evidence fusion", () => {
  it("marks agreeing nearby native and visual evidence as hybrid", () => {
    const [result] = fuseCadAndVisionComponents([visual()], [cad()]);

    expect(result.tag).toBe("QF1");
    expect(result.category).toBe("circuit_breaker");
    expect(result.method).toBe("hybrid_cad_vision");
    expect(result.confidence).toBe(0.99);
    expect(result.evidence).toContain("CAD原生文字 QF1（句柄 10，图层 DEVICE）");
    expect(result.evidence).not.toContain(expect.stringContaining("冲突"));
  });

  it("lets native CAD labels win while preserving a visual conflict", () => {
    const [result] = fuseCadAndVisionComponents([
      visual({ tag: "KM1", category: "contactor", reviewStatus: "confirmed" }),
    ], [cad()]);

    expect(result.tag).toBe("QF1");
    expect(result.category).toBe("circuit_breaker");
    expect(result.method).toBe("hybrid_cad_vision");
    expect(result.reviewStatus).toBe("requires_review");
    expect(result.evidence).toContain("结构/视觉标签冲突：CAD=QF1，视觉=KM1");
    expect(result.evidence).toContain("结构/视觉类别冲突：CAD=circuit_breaker，视觉=contactor");
  });

  it("does not attach unrelated CAD evidence", () => {
    const source = visual();
    const [result] = fuseCadAndVisionComponents([source], [cad({ overviewPosition: { x: 0.9, y: 0.9 } })]);

    expect(result).toEqual(source);
  });

  it("keeps unmatched visual candidates unchanged", () => {
    const source = visual({ tag: undefined, category: "unknown" });
    const [result] = fuseCadAndVisionComponents([source], []);

    expect(result).toEqual(source);
  });
});
