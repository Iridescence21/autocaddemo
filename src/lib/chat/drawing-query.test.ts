import { describe, expect, it } from "vitest";
import { answerDrawingQuestion, type StructuralDrawingRecord } from "@/lib/chat/drawing-query";
import type { NativeBomRow, StructuralSnapshot } from "@/lib/cad/native-bom";

function row(itemNumber: number, rawSymbol: string, modelSpec: string, quantity: number): NativeBomRow {
  const prefix = rawSymbol.match(/^[A-Z]+/)?.[0] ?? "";
  const numbers = rawSymbol.match(/\d+/g) ?? [];
  return { itemNumber, rawSymbol, symbolTags: numbers.map((number) => `${prefix}${number}`), name: "电流继电器", modelSpec, quantity, cadPosition: { x: 0, y: 0 }, evidenceHandles: [`h${itemNumber}`] };
}

function snapshot(bomRows: NativeBomRow[], reviewIssues: StructuralSnapshot["reviewIssues"] = []): StructuralSnapshot {
  return { schemaVersion: 1, counts: { entities: 1, texts: 1, blocks: 0, layers: 1, structuralTags: 0, bomRows: bomRows.length }, tags: [], bomRows, reviewIssues };
}

const drawings: StructuralDrawingRecord[] = [
  { id: "drawing-01", conversationId: "conversation-01", originalFilename: "M-T1-01.dwg", status: "requires_review", structuralSnapshot: snapshot([
    row(6, "KC1,2,3", "LL-63E/□", 3),
    row(7, "KC4", "LL-61E/□", 1),
  ]) },
  { id: "drawing-02", conversationId: "conversation-02", originalFilename: "M-T1-02.dwg", status: "requires_review", structuralSnapshot: snapshot([
    row(5, "KC1,2,3", "LL-61E/□", 3),
    row(6, "KC4,5,6", "LL-63E/□", 3),
    row(7, "KC7", "LL-61E/□", 1),
  ], [{ code: "BOM_MODEL_MISSING", severity: "warning", message: "测试审查项", tags: ["KC7"], itemNumbers: [7] }]) },
];

describe("drawing evidence questions", () => {
  it("answers how many current-relay models exist in the current drawing", () => {
    const answer = answerDrawingQuestion({ question: "电流继电器有几种类型？", currentDrawingId: "drawing-02", drawings });

    expect(answer).toMatchObject({ intent: "model_count", entityName: "电流继电器" });
    expect(answer.text).toContain("2 种型号");
    expect(answer.text).toContain("LL-61E/□");
    expect(answer.text).toContain("LL-63E/□");
    expect(answer.evidence).toEqual(expect.arrayContaining([expect.stringContaining("M-T1-02.dwg"), expect.stringContaining("KC1,2,3")]));
  });

  it("answers the current drawing quantity from native BOM quantities", () => {
    const answer = answerDrawingQuestion({ question: "这张图有多少只电流继电器？", currentDrawingId: "drawing-01", drawings });

    expect(answer.intent).toBe("quantity");
    expect(answer.text).toContain("共 4 只");
  });

  it("compares all analyzed drawings and identifies the drawing with the most devices", () => {
    const answer = answerDrawingQuestion({ question: "哪张图纸分布的电流继电器多？", currentDrawingId: "drawing-01", drawings });

    expect(answer.intent).toBe("distribution");
    expect(answer.text).toContain("M-T1-02.dwg 最多，共 7 只");
    expect(answer.text).toContain("M-T1-01.dwg：4 只");
    expect(answer.text).toContain("M-T1-02.dwg：7 只");
  });

  it("lists every drawing containing the requested device", () => {
    const answer = answerDrawingQuestion({ question: "电流继电器在那个图纸里面？", currentDrawingId: "drawing-01", drawings });

    expect(answer.intent).toBe("location");
    expect(answer.text).toContain("2 张已分析图纸");
    expect(answer.text).toContain("M-T1-01.dwg");
    expect(answer.text).toContain("M-T1-02.dwg");
  });

  it("reports structural review findings and states the audit boundary", () => {
    const answer = answerDrawingQuestion({ question: "审查这张图纸", currentDrawingId: "drawing-02", drawings });

    expect(answer.intent).toBe("review");
    expect(answer.text).toContain("测试审查项");
    expect(answer.text).toContain("不包含保护整定、回路连通性或结构干涉校核");
  });

  it("returns an actionable response when no analyzed device matches", () => {
    const answer = answerDrawingQuestion({ question: "真空接触器有多少只？", currentDrawingId: "drawing-02", drawings });

    expect(answer.intent).toBe("unknown");
    expect(answer.text).toContain("未在当前已分析 CAD BOM 中找到");
  });
});
