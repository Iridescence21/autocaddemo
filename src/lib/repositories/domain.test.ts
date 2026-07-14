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
  replacePhysicalDevices,
  updateComponent,
} from "@/lib/repositories/components";
import { prisma, resetTestDatabase } from "@/lib/db";
import { groupPhysicalDevices } from "@/lib/devices/group";

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

  it("persists tagged symbol occurrences as physical devices and counts devices in the BOM", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Starter circuit" });
    const components = [
      { temporaryId: "KM1-coil", category: "contactor" as const, tag: "KM1", description: "Contactor", specifications: ["24VDC"], confidence: 0.74, evidence: ["coil"], method: "fixture", reviewStatus: "confirmed" as const },
      { temporaryId: "KM1-contact-1", category: "switch" as const, tag: "KM1", description: "Contactor auxiliary contact", specifications: ["NO"], confidence: 0.95, evidence: ["contact 1"], method: "fixture", reviewStatus: "confirmed" as const },
      { temporaryId: "KM1-contact-2", category: "switch" as const, tag: "KM1", description: "Contactor auxiliary contact", specifications: ["NC"], confidence: 0.92, evidence: ["contact 2"], method: "fixture", reviewStatus: "confirmed" as const },
      { temporaryId: "QF1", category: "circuit_breaker" as const, tag: "QF1", description: "Circuit breaker", specifications: ["16A"], confidence: 0.88, evidence: ["breaker"], method: "fixture", reviewStatus: "confirmed" as const },
    ];
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "starter.dwg",
      safeFilename: "starter.dwg",
      storageKey: "demo/starter.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: components,
    });

    await replacePhysicalDevices(drawing.id, "demo-user", groupPhysicalDevices(components.map((component) => ({
      ...component,
      manufacturer: null,
      modelNumber: null,
    }))));

    const snapshot = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(snapshot?.components).toHaveLength(4);
    expect(snapshot?.physicalDevices).toHaveLength(2);
    expect(snapshot?.physicalDevices.map((device) => device.evidence)).toEqual(expect.arrayContaining([
      expect.arrayContaining(["occurrence:KM1-coil", "occurrence:KM1-contact-1", "occurrence:KM1-contact-2"]),
    ]));

    const bom = await generateBom(drawing.id, "demo-user");
    expect(bom?.items.reduce((total, item) => total + item.quantity, 0)).toBe(2);
  });

  it("backfills physical devices from preserved legacy symbol rows before generating a BOM", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Legacy drawing" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "legacy.dwg",
      safeFilename: "legacy.dwg",
      storageKey: "demo/legacy.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: [
        { temporaryId: "KA1", category: "relay", tag: "KA1", description: "Control relay", specifications: ["24VDC"], confidence: 0.8, evidence: ["tag"], method: "fixture", reviewStatus: "confirmed" },
      ],
    });
    await prisma.physicalDevice.deleteMany({ where: { drawingId: drawing.id } });

    const bom = await generateBom(drawing.id, "demo-user");
    expect(bom?.items).toMatchObject([{ quantity: 1, category: "relay" }]);
    expect((await getAnalysisSnapshot(drawing.id, "demo-user"))?.physicalDevices).toHaveLength(1);
  });
});
