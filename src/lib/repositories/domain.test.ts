import { beforeEach, describe, expect, it } from "vitest";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
} from "@/lib/repositories/conversations";
import { appendMessage, listMessages } from "@/lib/repositories/messages";
import {
  createDrawingUpload,
  getAnalysisSnapshot,
  updateAnalysisStatus,
} from "@/lib/repositories/drawings";
import {
  generateBom,
  removeComponent,
  updateComponent,
} from "@/lib/repositories/components";
import { resetTestDatabase } from "@/lib/db";

describe("drawing analysis persistence", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("creates and reopens a conversation with ordered messages", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Control Panel A" });
    await appendMessage(conversation.id, {
      ownerScope: "demo-user",
      type: "text",
      role: "user",
      payload: { text: "Analyze this drawing" },
    });
    await appendMessage(conversation.id, {
      ownerScope: "demo-user",
      type: "analysis_progress",
      role: "assistant",
      payload: { stage: "Preparing drawing" },
    });

    const reopened = await getConversation(conversation.id, "demo-user");
    expect(reopened?.title).toBe("Control Panel A");
    expect((await listMessages(conversation.id, "demo-user")).map((message) => message.type)).toEqual([
      "text",
      "analysis_progress",
    ]);
  });

  it("scopes conversations and deletes only the requested owner record", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Private drawing" });
    expect(await getConversation(conversation.id, "other-user")).toBeNull();
    expect(await deleteConversation(conversation.id, "other-user")).toBe(false);
    expect(await deleteConversation(conversation.id, "demo-user")).toBe(true);
    expect(await listConversations("demo-user")).toHaveLength(0);
  });

  it("persists analysis status and component edits into the BOM", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Motor Cabinet 02" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "motor-cabinet-02.dwg",
      safeFilename: "motor-cabinet-02.dwg",
      storageKey: "demo-user/drawing-1/motor-cabinet-02.dwg",
      sourceType: "dwg",
      byteSize: 128,
      initialComponents: [
        {
          temporaryId: "detection-001",
          category: "contactor",
          tag: "KM1",
          description: "Probable contactor",
          specifications: ["24VDC"],
          confidence: 0.78,
          evidence: ["Nearby label KM1"],
          method: "demo_fixture",
          reviewStatus: "requires_review",
        },
      ],
    });
    await updateAnalysisStatus(drawing.id, "demo-user", {
      status: "completed",
      progress: 100,
      stage: "Analysis complete",
    });
    const snapshot = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error("snapshot missing");
    const component = snapshot.components[0];
    expect(component).toBeDefined();
    if (!component) throw new Error("component missing");
    expect(component?.category).toBe("contactor");

    await updateComponent(drawing.id, component.id, "demo-user", {
      category: "relay",
      reviewStatus: "confirmed",
    });
    await removeComponent(drawing.id, component.id, "demo-user");
    const bom = await generateBom(drawing.id, "demo-user");
    expect(bom).not.toBeNull();
    if (!bom) throw new Error("bom missing");
    expect(bom.items).toHaveLength(0);
    const afterRemoval = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(afterRemoval).not.toBeNull();
    expect(afterRemoval?.components[0]?.removedAt).not.toBeNull();
  });
});
