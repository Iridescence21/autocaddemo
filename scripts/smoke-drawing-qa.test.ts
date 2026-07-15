import { describe, expect, it } from "vitest";
import { assertDrawingQaSummary, type DrawingQaSmokeSummary } from "./smoke-drawing-qa";

describe("real drawing QA smoke assertions", () => {
  it("accepts the expected M-T1 current-relay evidence", () => {
    const summary: DrawingQaSmokeSummary = {
      drawings: [
        { filename: "M-T1-01.dwg", bomRows: 42, currentRelayModels: ["LL-61E/□", "LL-63E/□"], currentRelayQuantity: 4 },
        { filename: "M-T1-02.dwg", bomRows: 42, currentRelayModels: ["LL-61E/□", "LL-63E/□"], currentRelayQuantity: 7 },
      ],
      answers: { modelCount: "2 种型号", quantity: "共 4 只", distribution: "M-T1-02.dwg 最多，共 7 只", location: "2 张已分析图纸" },
    };

    expect(() => assertDrawingQaSummary(summary)).not.toThrow();
  });

  it("rejects a regression that swaps or miscounts the drawings", () => {
    const summary: DrawingQaSmokeSummary = {
      drawings: [
        { filename: "M-T1-01.dwg", bomRows: 42, currentRelayModels: ["LL-61E/□", "LL-63E/□"], currentRelayQuantity: 7 },
        { filename: "M-T1-02.dwg", bomRows: 42, currentRelayModels: ["LL-61E/□", "LL-63E/□"], currentRelayQuantity: 4 },
      ],
      answers: { modelCount: "2 种型号", quantity: "共 7 只", distribution: "M-T1-01.dwg 最多，共 7 只", location: "2 张已分析图纸" },
    };

    expect(() => assertDrawingQaSummary(summary)).toThrow("DRAWING_QA_M_T1_01_QUANTITY");
  });
});
