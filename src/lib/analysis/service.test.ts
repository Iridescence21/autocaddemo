import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "@/lib/db";
import { demoAnalyzer } from "@/lib/cad/demo-analyzer";
import { demoRenderer } from "@/lib/cad/demo-renderer";
import { persistAnalysisFailure, runDemoAnalysis } from "@/lib/analysis/service";
import { createConversation } from "@/lib/repositories/conversations";
import { createDrawingUpload, getAnalysisSnapshot, updateAnalysisStatus } from "@/lib/repositories/drawings";
import { listMessages } from "@/lib/repositories/messages";

describe("demo analysis service", () => {
  beforeEach(async () => resetTestDatabase());

  it("persists progress, components, review state, and a preliminary BOM", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Control Panel A" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "Control Panel A.dwg",
      safeFilename: "Control-Panel-A.dwg",
      storageKey: "fixtures/cad/control-panel-a.dwg",
      sourceType: "dwg",
      byteSize: 128,
    });
    const result = await runDemoAnalysis(drawing.id, "demo-user", {
      renderer: demoRenderer,
      analyzer: demoAnalyzer,
      sourcePathResolver: () => "fixtures/cad/control-panel-a.dwg",
    });
    expect(result.status).toBe("requires_review");
    expect(result.components).toHaveLength(3);
    expect(result.bomItems.length).toBeGreaterThan(0);
    const messages = await listMessages(conversation.id, "demo-user");
    expect(messages.some((message) => message.type === "analysis_progress")).toBe(true);
    expect(messages.some((message) => message.type === "component_results")).toBe(true);
  });

  it("preserves the latest job progress when a background analysis fails", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Failure progress" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "drawing.dxf",
      safeFilename: "drawing.dxf",
      storageKey: "fixtures/cad/synthetic-control-panel.dxf",
      sourceType: "dxf",
      byteSize: 100,
    });
    await updateAnalysisStatus(drawing.id, "demo-user", { status: "analyzing", progress: 68, stage: "识别可能的电气元件" });

    await persistAnalysisFailure(drawing.id, "demo-user", new Error("AI_NOT_CONFIGURED"));

    const snapshot = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(snapshot?.job?.status).toBe("failed");
    expect(snapshot?.job?.progress).toBe(68);
  });
});
