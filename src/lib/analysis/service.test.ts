import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "@/lib/db";
import { demoAnalyzer } from "@/lib/cad/demo-analyzer";
import { demoRenderer } from "@/lib/cad/demo-renderer";
import { getCadRenderer } from "@/lib/cad/registry";
import { describeAnalysisFailure, persistAnalysisFailure, runDemoAnalysis, runDrawingAnalysis, selectDefaultAdapters } from "@/lib/analysis/service";
import { openAiVisionAnalyzer } from "@/lib/vision/openai-analyzer";
import { createConversation } from "@/lib/repositories/conversations";
import { createDrawingUpload, getAnalysisSnapshot, updateAnalysisStatus } from "@/lib/repositories/drawings";
import { listMessages } from "@/lib/repositories/messages";

describe("demo analysis service", () => {
  beforeEach(async () => resetTestDatabase());

  it("selects vision adapters for DXF drawings", async () => {
    const adapters = await selectDefaultAdapters("dxf", resolve(process.cwd(), "fixtures/cad/synthetic-control-panel.dxf"));

    expect(adapters).toMatchObject({ mode: "vision", renderer: getCadRenderer("dxf"), analyzer: openAiVisionAnalyzer });
  });

  it("selects demo adapters for the prepared control-panel DWG fixture", async () => {
    const adapters = await selectDefaultAdapters("dwg", resolve(process.cwd(), "fixtures/cad/control-panel-a.dwg"));

    expect(adapters).toMatchObject({ mode: "demo", renderer: demoRenderer, analyzer: demoAnalyzer });
  });

  it("selects the registered DWG renderer and vision analyzer for ordinary DWGs", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "dwg-analysis-"));
    const sourcePath = join(temporaryDirectory, "ordinary.dwg");
    await writeFile(sourcePath, "ordinary DWG content");

    try {
      const adapters = await selectDefaultAdapters("dwg", sourcePath);

      expect(adapters).toMatchObject({ mode: "vision", renderer: getCadRenderer("dwg"), analyzer: openAiVisionAnalyzer });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    ["DWG_CONVERTER_NOT_INSTALLED", "DWG 转换不可用", "此 Mac 尚未安装 DWG 转换器。"],
    ["DWG_CONVERSION_TIMEOUT", "DWG 转换超时", "DWG 转换超时，请尝试简化图纸后重试。"],
    ["DWG_CONVERSION_FAILED", "DWG 转换失败", "DWG 转换失败，请确认文件未损坏且版本受支持。"],
    ["DWG_CONVERTER_OUTPUT_MISSING", "DWG 转换失败", "DWG 转换未生成可分析的图纸。"],
    ["DWG_CONVERTER_OUTPUT_TOO_LARGE", "DWG 转换失败", "DWG 转换结果超过当前处理限制。"],
  ])("maps %s to a Chinese DWG conversion failure", (code, stage, userMessage) => {
    expect(describeAnalysisFailure(new Error(code))).toEqual({ code, stage, userMessage });
  });

  it("uses demo mode for the prepared fixture on the default adapter path", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Default fixture adapters" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "control-panel-a.dwg",
      safeFilename: "control-panel-a.dwg",
      storageKey: "fixtures/cad/control-panel-a.dwg",
      sourceType: "dwg",
      byteSize: 128,
    });

    const result = await runDrawingAnalysis(drawing.id, "demo-user", {
      sourcePathResolver: () => "fixtures/cad/control-panel-a.dwg",
      delayMs: 0,
    });

    expect(result.components).toHaveLength(3);
  });

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
