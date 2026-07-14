import { describe, expect, it } from "vitest";
import { bomToCsv, buildComponentWorkbook } from "@/lib/export";

function findCell(sheet: import("exceljs").Worksheet, expected: unknown) {
  let found = false;
  sheet.eachRow((row) => row.eachCell((cell) => { if (cell.value === expected) found = true; }));
  return found;
}

describe("BOM export", () => {
  it("exports stable identifiers and explicit missing-data labels", () => {
    const csv = bomToCsv([{ id: "bom-1", itemNumber: 1, category: "contactor", description: "Probable contactor", manufacturer: null, modelNumber: null, specifications: ["24VDC"], quantity: 1, confidence: 0.78, reviewStatus: "requires_review" }]);
    expect(csv).toContain("bom-1");
    expect(csv).toContain("需要工程师确认");
    expect(csv).toContain("图纸中未显示");
    expect(csv).toContain("类别");
  });

  it("builds one worksheet with symbol occurrences followed by physical-device BOM totals", async () => {
    const workbook = buildComponentWorkbook({
      drawingId: "drawing-1",
      filename: "Control_Panel_A.dxf",
      components: [{
        id: "component-1",
        temporaryId: "KM1-coil",
        physicalDeviceId: "physical-KM1",
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
      physicalDevices: [{
        id: "physical-KM1",
        temporaryId: "device-KM1",
        tag: "KM1",
        category: "contactor",
        description: "Probable contactor",
        manufacturer: null,
        modelNumber: "=BAD",
        specifications: ["24VDC"],
        quantity: 1,
        confidence: 0.78,
        reviewStatus: "requires_review",
        evidence: ["Nearby label KM1"],
      }],
      bomItems: [{
        id: "bom-1",
        itemNumber: 1,
        category: "contactor",
        description: "Probable contactor",
        manufacturer: null,
        modelNumber: "=BAD",
        specifications: ["24VDC"],
        quantity: 1,
        confidence: 0.78,
        reviewStatus: "requires_review",
      }],
      analysisWarnings: ["部分区域未完整扫描，结果可能不完整。"],
    });

    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.getWorksheet("元件分析清单")!;
    expect(sheet.getCell("A1").value).toBe("符号实例清单");
    expect(findCell(sheet, "物理设备与初步 BOM")).toBeTruthy();
    expect(findCell(sheet, "KM1-coil")).toBeTruthy();
    expect(findCell(sheet, "device-KM1")).toBeTruthy();
    expect(findCell(sheet, 1)).toBeTruthy();
    expect(findCell(sheet, "'=BAD")).toBeTruthy();
    expect(findCell(sheet, "部分区域未完整扫描，结果可能不完整。")).toBeTruthy();

    const bytes = await workbook.xlsx.writeBuffer();
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
