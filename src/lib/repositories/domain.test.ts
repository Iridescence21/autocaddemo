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
  replaceComponents,
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
    await prisma.$transaction([
      prisma.componentCandidate.updateMany({ where: { drawingId: drawing.id }, data: { physicalDeviceId: null } }),
      prisma.physicalDevice.deleteMany({ where: { drawingId: drawing.id } }),
    ]);

    const bom = await generateBom(drawing.id, "demo-user");
    expect(bom?.items).toMatchObject([{ quantity: 1, category: "relay" }]);
    expect((await getAnalysisSnapshot(drawing.id, "demo-user"))?.physicalDevices).toHaveLength(1);
  });

  it("regroups devices and regenerates the BOM after an occurrence tag edit or removal", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Editable starter" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "editable.dwg",
      safeFilename: "editable.dwg",
      storageKey: "demo/editable.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: [
        { temporaryId: "KA1-coil", category: "relay", tag: "KA1", description: "Relay", specifications: ["24VDC"], confidence: 0.8, evidence: ["coil"], method: "fixture", reviewStatus: "confirmed" },
        { temporaryId: "KA1-contact", category: "switch", tag: "KA1", description: "Relay contact", specifications: ["NO"], confidence: 0.9, evidence: ["contact"], method: "fixture", reviewStatus: "confirmed" },
      ],
    });
    await generateBom(drawing.id, "demo-user");
    const initial = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(initial?.physicalDevices).toHaveLength(1);

    const contact = initial?.components.find((component) => component.temporaryId === "KA1-contact");
    if (!contact) throw new Error("contact missing");
    const oldPhysicalDeviceId = contact.physicalDeviceId;
    const returned = await updateComponent(drawing.id, contact.id, "demo-user", { tag: "KA2" });
    const afterEdit = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(afterEdit?.physicalDevices).toHaveLength(2);
    expect(afterEdit?.bomItems.reduce((total, item) => total + item.quantity, 0)).toBe(2);
    const persistedContact = afterEdit?.components.find((component) => component.id === contact.id);
    expect(returned?.physicalDeviceId).toBe(persistedContact?.physicalDeviceId);
    expect(returned?.physicalDeviceId).not.toBe(oldPhysicalDeviceId);

    await removeComponent(drawing.id, contact.id, "demo-user");
    const afterRemoval = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(afterRemoval?.physicalDevices).toHaveLength(1);
    expect(afterRemoval?.bomItems.reduce((total, item) => total + item.quantity, 0)).toBe(1);
  });

  it("rejects a cross-drawing physical-device link at the database boundary", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Cross drawing links" });
    const drawingA = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "a.dwg",
      safeFilename: "a.dwg",
      storageKey: "demo/a.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: [{ temporaryId: "KA1", category: "relay", tag: "KA1", description: "Relay", specifications: [], confidence: 0.8, evidence: [], method: "fixture", reviewStatus: "confirmed" }],
    });
    const conversationB = await createConversation({ ownerScope: "demo-user", title: "Second drawing" });
    const drawingB = await createDrawingUpload({
      conversationId: conversationB.id,
      ownerScope: "demo-user",
      originalFilename: "b.dwg",
      safeFilename: "b.dwg",
      storageKey: "demo/b.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: [{ temporaryId: "KA2", category: "relay", tag: "KA2", description: "Relay", specifications: [], confidence: 0.8, evidence: [], method: "fixture", reviewStatus: "confirmed" }],
    });
    const first = await getAnalysisSnapshot(drawingA.id, "demo-user");
    const second = await getAnalysisSnapshot(drawingB.id, "demo-user");
    if (!first?.components[0] || !second?.physicalDevices[0]) throw new Error("fixture missing");

    await expect(prisma.componentCandidate.update({
      where: { id: first.components[0].id },
      data: { physicalDeviceId: second.physicalDevices[0].id },
    })).rejects.toThrow();
  });

  it("restricts direct device deletion until repository replacement unlinks occurrences", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Direct device deletion" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "direct-delete.dwg",
      safeFilename: "direct-delete.dwg",
      storageKey: "demo/direct-delete.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: [{ temporaryId: "KA1", category: "relay", tag: "KA1", description: "Relay", specifications: [], confidence: 0.8, evidence: [], method: "fixture", reviewStatus: "confirmed" }],
    });
    const before = await getAnalysisSnapshot(drawing.id, "demo-user");
    if (!before?.physicalDevices[0]) throw new Error("physical device missing");

    await expect(prisma.physicalDevice.delete({ where: { id: before.physicalDevices[0].id } })).rejects.toThrow();
    await replacePhysicalDevices(drawing.id, "demo-user", []);
    const after = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(after?.components).toHaveLength(1);
    expect(after?.components[0]?.physicalDeviceId).toBeNull();
    expect(after?.physicalDevices).toHaveLength(0);
  });

  it("cascades drawing deletion through linked devices and occurrences", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Cascade deletion" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "cascade.dwg",
      safeFilename: "cascade.dwg",
      storageKey: "demo/cascade.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: [{ temporaryId: "KA1", category: "relay", tag: "KA1", description: "Relay", specifications: [], confidence: 0.8, evidence: [], method: "fixture", reviewStatus: "confirmed" }],
    });

    await deleteConversation(conversation.id, "demo-user");
    expect(await prisma.drawing.findUnique({ where: { id: drawing.id } })).toBeNull();
    expect(await prisma.componentCandidate.count({ where: { drawingId: drawing.id } })).toBe(0);
    expect(await prisma.physicalDevice.count({ where: { drawingId: drawing.id } })).toBe(0);
  });

  it("rejects duplicate new occurrence IDs before replacing existing rows", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Duplicate input" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "duplicate-input.dwg",
      safeFilename: "duplicate-input.dwg",
      storageKey: "demo/duplicate-input.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: [{ temporaryId: "KA1", category: "relay", tag: "KA1", description: "Relay", specifications: [], confidence: 0.8, evidence: [], method: "fixture", reviewStatus: "confirmed" }],
    });

    await expect(replaceComponents(drawing.id, "demo-user", [
      { temporaryId: "duplicate", category: "relay", tag: "KA1", description: "Relay", specifications: [], confidence: 0.8, evidence: [], method: "fixture", reviewStatus: "confirmed" },
      { temporaryId: "duplicate", category: "relay", tag: "KA2", description: "Relay", specifications: [], confidence: 0.8, evidence: [], method: "fixture", reviewStatus: "confirmed" },
    ])).rejects.toThrow("DUPLICATE_COMPONENT_TEMPORARY_ID");
    const snapshot = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(snapshot?.components.map((component) => component.temporaryId)).toEqual(["KA1"]);
    expect(snapshot?.physicalDevices).toHaveLength(1);
  });

  it("backfills legacy duplicate occurrence IDs without deleting either row", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Legacy duplicates" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "legacy-duplicates.dwg",
      safeFilename: "legacy-duplicates.dwg",
      storageKey: "demo/legacy-duplicates.dwg",
      sourceType: "dwg",
      byteSize: 1,
    });
    await prisma.componentCandidate.createMany({ data: [
      { drawingId: drawing.id, temporaryId: "legacy-duplicate", category: "relay", tag: null, description: "Relay A", specifications: [], manufacturer: null, modelNumber: null, confidence: 0.8, evidence: [], method: "legacy", sourceTileId: null, location: { x: 0, y: 0, width: 0, height: 0 }, reviewStatus: "confirmed" },
      { drawingId: drawing.id, temporaryId: "legacy-duplicate", category: "relay", tag: null, description: "Relay B", specifications: [], manufacturer: null, modelNumber: null, confidence: 0.8, evidence: [], method: "legacy", sourceTileId: null, location: { x: 1, y: 1, width: 0, height: 0 }, reviewStatus: "confirmed" },
    ] });

    const bom = await generateBom(drawing.id, "demo-user");
    const snapshot = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(snapshot?.components).toHaveLength(2);
    expect(snapshot?.physicalDevices).toHaveLength(2);
    expect(bom?.items.reduce((total, item) => total + item.quantity, 0)).toBe(2);
  });

  it("leaves device links unchanged when a replacement has the wrong owner", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Wrong owner" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "wrong-owner.dwg",
      safeFilename: "wrong-owner.dwg",
      storageKey: "demo/wrong-owner.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: [{ temporaryId: "KA1", category: "relay", tag: "KA1", description: "Relay", specifications: [], confidence: 0.8, evidence: [], method: "fixture", reviewStatus: "confirmed" }],
    });

    await expect(replacePhysicalDevices(drawing.id, "other-user", [])).resolves.toEqual([]);
    const snapshot = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(snapshot?.physicalDevices).toHaveLength(1);
    expect(snapshot?.components[0]?.physicalDeviceId).toBe(snapshot?.physicalDevices[0]?.id);
  });

  it("rolls back a replacement when an occurrence is missing", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Missing occurrence" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "missing-occurrence.dwg",
      safeFilename: "missing-occurrence.dwg",
      storageKey: "demo/missing-occurrence.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: [{ temporaryId: "KA1", category: "relay", tag: "KA1", description: "Relay", specifications: [], confidence: 0.8, evidence: [], method: "fixture", reviewStatus: "confirmed" }],
    });
    const missing = groupPhysicalDevices([{ temporaryId: "missing", category: "relay", tag: "KA2", description: "Relay", specifications: [], manufacturer: null, modelNumber: null, confidence: 0.8, evidence: [], reviewStatus: "confirmed" }]);

    await expect(replacePhysicalDevices(drawing.id, "demo-user", missing)).rejects.toThrow("DEVICE_OCCURRENCE_NOT_FOUND");
    const snapshot = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(snapshot?.physicalDevices).toHaveLength(1);
    expect(snapshot?.components[0]?.physicalDeviceId).toBe(snapshot?.physicalDevices[0]?.id);
  });

  it("rolls back a replacement when an occurrence is assigned twice", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Duplicate assignment" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "duplicate-assignment.dwg",
      safeFilename: "duplicate-assignment.dwg",
      storageKey: "demo/duplicate-assignment.dwg",
      sourceType: "dwg",
      byteSize: 1,
      initialComponents: [{ temporaryId: "KA1", category: "relay", tag: "KA1", description: "Relay", specifications: [], confidence: 0.8, evidence: [], method: "fixture", reviewStatus: "confirmed" }],
    });
    const [device] = groupPhysicalDevices([{ temporaryId: "KA1", category: "relay", tag: "KA1", description: "Relay", specifications: [], manufacturer: null, modelNumber: null, confidence: 0.8, evidence: [], reviewStatus: "confirmed" }]);
    if (!device) throw new Error("device missing");

    await expect(replacePhysicalDevices(drawing.id, "demo-user", [device, { ...device, temporaryId: "device-duplicate" }])).rejects.toThrow("DUPLICATE_DEVICE_OCCURRENCE");
    const snapshot = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(snapshot?.physicalDevices).toHaveLength(1);
    expect(snapshot?.components[0]?.physicalDeviceId).toBe(snapshot?.physicalDevices[0]?.id);
  });
});
