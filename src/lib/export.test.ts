import { describe, expect, it } from "vitest";
import { bomToCsv, buildComponentWorkbook } from "@/lib/export";

describe("BOM export", () => {
  it("exports stable identifiers and explicit missing-data labels", () => {
    const csv = bomToCsv([{ id: "bom-1", itemNumber: 1, category: "contactor", description: "Probable contactor", manufacturer: null, modelNumber: null, specifications: ["24VDC"], quantity: 1, confidence: 0.78, reviewStatus: "requires_review" }]);
    expect(csv).toContain("bom-1");
    expect(csv).toContain("需要工程师确认");
    expect(csv).toContain("图纸中未显示");
    expect(csv).toContain("类别");
  });

  it("builds one labeled Excel sheet with every detected component", async () => {
    const workbook = buildComponentWorkbook({
      drawingId: "drawing-1",
      filename: "Control_Panel_A.dxf",
      components: [{
        id: "component-1",
        temporaryId: "detection-001",
        category: "contactor",
        tag: "KM1",
        description: "Probable contactor",
        manufacturer: null,
        modelNumber: "=BAD",
        specifications: ["24VDC"],
        confidence: 0.78,
        reviewStatus: "requires_review",
        evidence: ["Nearby label KM1", "Contactor-like symbol"],
        method: "vision_model",
        sourceTileId: "tile-1-2",
        location: { x: 0.42, y: 0.31, width: 0.08, height: 0.06 },
        originalCategory: null,
        correctedCategory: null,
        removedAt: null,
      }],
    });

    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.getWorksheet("元件分析清单");
    expect(sheet).toBeDefined();
    expect(sheet?.getRow(1).values).toContain("类别");
    expect(sheet?.getRow(2).getCell(4).value).toBe("接触器");
    expect(sheet?.getRow(2).values).toContain("图纸中未显示");
    expect(sheet?.getRow(2).values).toContain("'=BAD");
    expect(sheet?.getRow(2).values).toContain("需要工程师确认");

    const bytes = await workbook.xlsx.writeBuffer();
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
