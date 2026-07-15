import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "@/lib/db";
import { demoAnalyzer } from "@/lib/cad/demo-analyzer";
import { demoRenderer } from "@/lib/cad/demo-renderer";
import { getCadRenderer } from "@/lib/cad/registry";
import { describeAnalysisFailure, hasLimitedCoverage, persistAnalysisFailure, runDemoAnalysis, runDrawingAnalysis, selectDefaultAdapters } from "@/lib/analysis/service";
import { openAiVisionAnalyzer } from "@/lib/vision/openai-analyzer";
import { createConversation } from "@/lib/repositories/conversations";
import { createDrawingUpload, getAnalysisSnapshot, updateAnalysisStatus } from "@/lib/repositories/drawings";
import { listMessages } from "@/lib/repositories/messages";
import type { CadRenderAdapter } from "@/lib/cad/types";
import type { DrawingVisionAnalyzer } from "@/lib/vision/types";

const partialCoverageRenderer: CadRenderAdapter = {
  async render() {
    return {
      overviewImageUrl: "data:image/svg+xml,fixture",
      width: 100,
      height: 100,
      tiles: [
        { id: "tile-1", imageUrl: "data:image/svg+xml,tile-1", x: 0, y: 0, width: 50, height: 50, overlap: 0, cadBounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 }, entityCount: 1, textCount: 0, blockCount: 0 },
        { id: "tile-2", imageUrl: "data:image/svg+xml,tile-2", x: 50, y: 0, width: 50, height: 50, overlap: 0, cadBounds: { minX: 50, minY: 0, maxX: 100, maxY: 50 }, entityCount: 1, textCount: 0, blockCount: 0 },
      ],
      metadata: { coverageLimited: true },
    };
  },
};

const partialCoverageAnalyzer: DrawingVisionAnalyzer = {
  async analyze() {
    const detection = (temporaryId: string, label: string, x: number) => ({
      temporaryId,
      category: "contactor" as const,
      label,
      description: "可能为接触器",
      manufacturer: null,
      modelNumber: null,
      specifications: ["24VDC"],
      confidence: 0.8,
      tileId: "tile-1",
      location: { x, y: 0.1, width: 0.1, height: 0.1 },
      evidence: ["fixture"],
      reviewRequired: true,
    });
    return {
      drawingSummary: "控制柜局部区域",
      components: [
        detection("KM1-coil", "KM1", 0.1),
        detection("KM1-contact", "KM1", 0.3),
        detection("KA1-coil", "KA1", 0.5),
        detection("KA1-contact", "KA1", 0.7),
      ],
      warnings: ["模型仅完成部分区域"],
      analysisDiagnostics: { attemptedTiles: 3, completedTiles: 2, failedTiles: 1, verificationTiles: 0, rawDetectionCount: 4, coverageLimited: true },
    };
  },
};

const confirmedDemoAnalyzer = {
  async analyze() {
    return {
      drawingSummary: "确认的局部区域",
      components: [{
        temporaryId: "QF1",
        category: "circuit_breaker" as const,
        tag: "QF1",
        description: "断路器",
        manufacturer: null,
        modelNumber: null,
        specifications: ["16A"],
        confidence: 0.99,
        evidence: ["fixture"],
        method: "fixture",
        reviewStatus: "confirmed" as const,
        location: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
      }],
      warnings: [],
    };
  },
};

describe("demo analysis service", () => {
  beforeEach(async () => resetTestDatabase());

  it.each([
    { attemptedTiles: 2, completedTiles: 2, failedTiles: 0, coverageLimited: true },
    { attemptedTiles: 2, completedTiles: 1, failedTiles: 1, coverageLimited: false },
    { attemptedTiles: 3, completedTiles: 2, failedTiles: 0, coverageLimited: false },
  ])("treats limited, failed, and incomplete diagnostics as coverage-limited", (diagnostics) => {
    expect(hasLimitedCoverage({ ...diagnostics, verificationTiles: 0, rawDetectionCount: 0 })).toBe(true);
  });

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
    const progressMessages = messages.filter((message) => message.type === "analysis_progress");
    expect(progressMessages.at(-1)?.payload).toMatchObject({
      jobId: drawing.analysisJob?.id,
      status: "requires_review",
      stage: "分析完成",
      progress: 100,
    });
    expect(messages.some((message) => message.type === "component_results")).toBe(true);
  });

  it("persists separate occurrence and physical-device counts with partial-coverage warnings", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Partial coverage" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "partial.dxf",
      safeFilename: "partial.dxf",
      storageKey: "fixtures/cad/synthetic-control-panel.dxf",
      sourceType: "dxf",
      byteSize: 128,
    });

    const result = await runDrawingAnalysis(drawing.id, "demo-user", {
      renderer: partialCoverageRenderer,
      analyzer: partialCoverageAnalyzer,
      sourcePathResolver: () => "fixtures/cad/synthetic-control-panel.dxf",
      delayMs: 0,
    });

    expect(result.components).toHaveLength(4);
    expect(result.physicalDevices).toHaveLength(2);
    expect(result.analysisDiagnostics.completedTiles).toBe(2);
    const messages = await listMessages(conversation.id, "demo-user");
    expect(messages.find((message) => message.type === "component_results")?.payload).toMatchObject({
      symbolOccurrenceCount: 4,
      physicalDeviceCount: 2,
    });
    expect(messages.find((message) => message.type === "drawing_summary")?.payload).toMatchObject({
      warnings: expect.arrayContaining([expect.stringContaining("部分区域未完整扫描")]),
    });
  });

  it("requires review when coverage is limited even if every occurrence is confirmed", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Confirmed partial coverage" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "confirmed-partial.dwg",
      safeFilename: "confirmed-partial.dwg",
      storageKey: "fixtures/cad/control-panel-a.dwg",
      sourceType: "dwg",
      byteSize: 128,
    });

    const result = await runDrawingAnalysis(drawing.id, "demo-user", {
      renderer: partialCoverageRenderer,
      analyzer: confirmedDemoAnalyzer,
      analysisMode: "demo",
      sourcePathResolver: () => "fixtures/cad/control-panel-a.dwg",
      delayMs: 0,
    });

    expect(result.components.every((component) => component.reviewStatus === "confirmed")).toBe(true);
    expect(result.analysisDiagnostics.coverageLimited).toBe(true);
    expect(result.status).toBe("requires_review");
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
    const messages = await listMessages(conversation.id, "demo-user");
    expect(messages.filter((message) => message.type === "analysis_progress").at(-1)?.payload).toMatchObject({
      jobId: drawing.analysisJob?.id,
      status: "failed",
      stage: "分析失败",
      progress: 68,
    });
  });

  it("persists native CAD evidence and BOM before visual analysis runs", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Native before vision" });
    const drawing = await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "native-first.dxf",
      safeFilename: "native-first.dxf",
      storageKey: "fixtures/cad/synthetic-control-panel.dxf",
      sourceType: "dxf",
      byteSize: 100,
    });
    const context = {
      entities: [], blockDefinitions: {}, layers: ["0"], blockNames: [], warnings: [],
      extents: { minX: 0, minY: 0, maxX: 100, maxY: 120 },
      texts: [
        { value: "序号", layer: "0", handle: "h1", position: { x: 2, y: 100 } }, { value: "符号", layer: "0", handle: "h2", position: { x: 12, y: 100 } },
        { value: "名称", layer: "0", handle: "h3", position: { x: 32, y: 100 } }, { value: "型号规格", layer: "0", handle: "h4", position: { x: 62, y: 100 } },
        { value: "数量", layer: "0", handle: "h5", position: { x: 88, y: 100 } }, { value: "备注", layer: "0", handle: "h6", position: { x: 96, y: 100 } },
        { value: "1", layer: "0", handle: "r1", position: { x: 2, y: 90 } }, { value: "KC1,2,3", layer: "0", handle: "r2", position: { x: 12, y: 90 } },
        { value: "电流继电器", layer: "0", handle: "r3", position: { x: 32, y: 90 } }, { value: "LL-61E/5", layer: "0", handle: "r4", position: { x: 62, y: 90 } },
        { value: "3", layer: "0", handle: "r5", position: { x: 88, y: 90 } },
      ],
    };
    const renderer: CadRenderAdapter = { async render() { return { overviewImageUrl: "data:image/png;base64,test", width: 100, height: 120, tiles: [], metadata: { context } }; } };
    const analyzer: DrawingVisionAnalyzer = { async analyze() { throw new Error("VISION_SHOULD_FAIL"); } };

    await expect(runDrawingAnalysis(drawing.id, "demo-user", { renderer, analyzer, analysisMode: "vision", sourcePathResolver: () => "unused", delayMs: 0 })).resolves.toMatchObject({
      status: "requires_review",
      structuralOnly: true,
      bomItems: [{ description: "电流继电器", quantity: 3 }],
    });
    const snapshot = await getAnalysisSnapshot(drawing.id, "demo-user");
    expect(snapshot?.drawing.structuralSnapshot).toMatchObject({ schemaVersion: 1, counts: { bomRows: 1 } });
    expect(snapshot?.bomItems).toMatchObject([{ description: "电流继电器", modelNumber: "LL-61E/5", quantity: 3 }]);
    expect(snapshot?.job).toMatchObject({ status: "requires_review", progress: 100, stage: "CAD 结构分析完成（视觉识别受限）" });
    const messages = await listMessages(conversation.id, "demo-user");
    expect(messages.filter((message) => message.type === "analysis_progress").at(-1)?.payload).toMatchObject({
      jobId: drawing.analysisJob?.id,
      status: "requires_review",
      stage: "CAD 结构分析完成（视觉识别受限）",
      progress: 100,
    });
  });

  it("persists every terminal progress message before exposing its terminal job status", async () => {
    const source = await readFile(resolve(process.cwd(), "src/lib/analysis/service.ts"), "utf8");
    const failureBlock = source.slice(source.indexOf("export async function persistAnalysisFailure"), source.indexOf("export async function runDrawingAnalysis"));
    const structuralBlock = source.slice(source.indexOf("const visualWarning"), source.indexOf("return {\n      status: \"requires_review\" as const"));
    const normalBlock = source.slice(source.indexOf("const finalStatus"), source.indexOf("return { status: finalStatus"));

    expect(failureBlock.indexOf("await appendProgressMessage")).toBeLessThan(failureBlock.indexOf('await appendMessage(current.drawing.conversationId, {'));
    const failedUpdateIndex = failureBlock.indexOf("await updateAnalysisStatus(drawingId, ownerScope");
    const structuralUpdateIndex = structuralBlock.indexOf("await updateAnalysisStatus(drawingId, ownerScope, { status: \"requires_review\"");
    expect(failureBlock.indexOf('await appendMessage(current.drawing.conversationId, {')).toBeLessThan(failedUpdateIndex);
    expect(structuralBlock.indexOf("await appendProgressMessage")).toBeLessThan(structuralUpdateIndex);
    expect(normalBlock.indexOf("await appendProgressMessage")).toBeLessThan(normalBlock.indexOf("await updateAnalysisStatus(drawingId, ownerScope"));
  });
});
