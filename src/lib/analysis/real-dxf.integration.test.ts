import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "@/lib/db";
import { runDrawingAnalysis } from "@/lib/analysis/service";
import { dxfRenderer } from "@/lib/cad/dxf-renderer";
import { createOpenAiVisionAnalyzer } from "@/lib/vision/openai-analyzer";
import { createConversation } from "@/lib/repositories/conversations";
import { createDrawingUpload, getAnalysisSnapshot } from "@/lib/repositories/drawings";
import { listMessages } from "@/lib/repositories/messages";
import type { DrawingVisionAnalyzer } from "@/lib/vision/types";

const fixture = resolve(process.cwd(), "fixtures/cad/synthetic-control-panel.dxf");

async function createDxfDrawing() {
  const conversation = await createConversation({ ownerScope: "demo-user", title: "合成控制柜" });
  const drawing = await createDrawingUpload({
    conversationId: conversation.id,
    ownerScope: "demo-user",
    originalFilename: "synthetic-control-panel.dxf",
    safeFilename: "synthetic-control-panel.dxf",
    storageKey: "fixtures/cad/synthetic-control-panel.dxf",
    sourceType: "dxf",
    byteSize: 2048,
  });
  return { conversation, drawing };
}

const fakeAnalyzer: DrawingVisionAnalyzer = {
  async analyze({ rendered }) {
    const physical = { x: 0.452, y: 0.11, width: 0.06, height: 0.08 };
    const detections = rendered.tiles.slice(0, 2).map((tile, index) => ({
      temporaryId: `KM1-${index + 1}`,
      category: "contactor" as const,
      label: "KM1",
      description: "可能为接触器",
      manufacturer: null,
      modelNumber: null,
      specifications: ["24VDC"],
      confidence: index ? 0.88 : 0.81,
      tileId: tile.id,
      location: {
        x: (physical.x * rendered.width - tile.x) / tile.width,
        y: (physical.y * rendered.height - tile.y) / tile.height,
        width: physical.width * rendered.width / tile.width,
        height: physical.height * rendered.height / tile.height,
      },
      evidence: [index ? "线圈形状" : "附近文字 KM1"],
      reviewRequired: true,
    }));
    return {
      drawingSummary: "可能为电气控制原理图",
      components: detections,
      warnings: ["初步结果，需要工程师复核"],
      analysisDiagnostics: {
        attemptedTiles: rendered.tiles.length,
        completedTiles: rendered.tiles.length,
        failedTiles: 0,
        verificationTiles: 0,
        rawDetectionCount: detections.length,
        coverageLimited: Boolean(rendered.metadata?.coverageLimited),
      },
    };
  },
};

describe("real DXF analysis pipeline", () => {
  beforeEach(async () => resetTestDatabase());

  it("renders a real DXF, consolidates detections, persists components and BOM, and writes Chinese results", async () => {
    const { conversation, drawing } = await createDxfDrawing();
    const result = await runDrawingAnalysis(drawing.id, "demo-user", {
      renderer: dxfRenderer,
      analyzer: fakeAnalyzer,
      sourcePathResolver: () => fixture,
      delayMs: 0,
    });

    expect(result.status).toBe("requires_review");
    expect(result.components).toHaveLength(1);
    expect(result.components[0].tag).toBe("KM1");
    expect(result.components[0].method).toBe("hybrid_cad_vision");
    expect(result.components[0].evidence).toContain("CAD原生文字 KM1（句柄 22，图层 SYMBOL）");
    expect(result.bomItems).toHaveLength(1);
    const messages = await listMessages(conversation.id, "demo-user");
    expect(messages.some((message) => message.type === "analysis_progress" && JSON.stringify(message.payload).includes("识别可能的电气元件"))).toBe(true);
    const componentMessage = messages.find((message) => message.type === "component_results");
    expect(JSON.stringify(componentMessage?.payload)).toContain("元件识别结果（按类别）");
    expect(JSON.stringify(componentMessage?.payload)).toContain("KM1");
    const snapshot = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(snapshot?.drawing.previewImageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("fails explicitly when the OpenAI key has not been configured", async () => {
    const { drawing } = await createDxfDrawing();
    const analyzer = createOpenAiVisionAnalyzer({ apiKey: "" });

    await expect(runDrawingAnalysis(drawing.id, "demo-user", {
      renderer: dxfRenderer,
      analyzer,
      sourcePathResolver: () => fixture,
      delayMs: 0,
    })).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    const snapshot = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(snapshot?.components).toHaveLength(0);
  });
});
