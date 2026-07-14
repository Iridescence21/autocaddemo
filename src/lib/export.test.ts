import { describe, expect, it } from "vitest";
import { bomToCsv } from "@/lib/export";

describe("BOM export", () => {
  it("exports stable identifiers and explicit missing-data labels", () => {
    const csv = bomToCsv([{ id: "bom-1", itemNumber: 1, category: "contactor", description: "Probable contactor", manufacturer: null, modelNumber: null, specifications: ["24VDC"], quantity: 1, confidence: 0.78, reviewStatus: "requires_review" }]);
    expect(csv).toContain("bom-1");
    expect(csv).toContain("需要工程师确认");
    expect(csv).toContain("图纸中未显示");
    expect(csv).toContain("类别");
  });
});
