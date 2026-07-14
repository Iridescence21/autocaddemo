import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "@/lib/db";
import { createConversation } from "@/lib/repositories/conversations";
import { createDrawingUpload } from "@/lib/repositories/drawings";
import { generateBom } from "@/lib/repositories/components";

describe("preliminary BOM aggregation", () => {
  beforeEach(async () => resetTestDatabase());

  it("groups active components and carries the lowest confidence", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "BOM test" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "test.dwg",
      safeFilename: "test.dwg",
      storageKey: "demo/test.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: [
        { temporaryId: "detection-001", category: "relay", tag: "KA1", description: "Control relay", specifications: ["24VDC"], confidence: 0.8, evidence: ["tag"], method: "fixture", reviewStatus: "confirmed" },
        { temporaryId: "detection-002", category: "relay", tag: "KA2", description: "Control relay", specifications: ["24VDC"], confidence: 0.6, evidence: ["tag"], method: "fixture", reviewStatus: "requires_review" },
      ],
    });
    const bom = await generateBom(drawing.id, "demo-user");
    expect(bom?.items).toHaveLength(1);
    expect(bom?.items[0]).toMatchObject({ quantity: 2, confidence: 0.6, reviewStatus: "requires_review" });
  });
});
