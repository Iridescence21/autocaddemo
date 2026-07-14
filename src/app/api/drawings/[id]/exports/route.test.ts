import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "@/lib/db";
import { createConversation } from "@/lib/repositories/conversations";
import { createDrawingUpload } from "@/lib/repositories/drawings";
import { POST } from "./route";

describe("drawing Excel export route", () => {
  beforeEach(async () => resetTestDatabase());

  it("downloads a one-sheet xlsx containing the analyzed components", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Excel export" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "Control Panel A.dxf",
      safeFilename: "Control-Panel-A.dxf",
      storageKey: "demo/Control-Panel-A.dxf",
      sourceType: "dxf",
      byteSize: 100,
      initialComponents: [{
        temporaryId: "detection-001",
        category: "contactor",
        tag: "KM1",
        description: "Probable contactor",
        specifications: ["24VDC"],
        confidence: 0.78,
        evidence: ["Nearby label KM1"],
        method: "vision_model",
        reviewStatus: "requires_review",
      }],
    });

    const response = await POST(
      new Request(`http://localhost/api/drawings/${drawing.id}/exports`, { method: "POST" }),
      { params: Promise.resolve({ id: drawing.id }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    expect(response.headers.get("content-disposition")).toContain(".xlsx");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.getWorksheet("元件分析清单")?.getRow(2).values).toContain("KM1");
  });
});
