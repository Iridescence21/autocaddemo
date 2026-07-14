import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ComponentInput } from "@/lib/domain";
import { appendMessage } from "@/lib/repositories/messages";
import { getAnalysisSnapshot, saveDrawingPreview, updateAnalysisStatus } from "@/lib/repositories/drawings";
import { generateBom, replaceComponents, replacePhysicalDevices } from "@/lib/repositories/components";
import { groupPhysicalDevices, type DeviceOccurrence } from "@/lib/devices/group";
import { demoAnalyzer } from "@/lib/cad/demo-analyzer";
import { demoRenderer } from "@/lib/cad/demo-renderer";
import { getCadRenderer } from "@/lib/cad/registry";
import type { CadRenderAdapter, CadSourceType, DemoAnalysisResult, RenderedCadDrawing } from "@/lib/cad/types";
import { openAiVisionAnalyzer, VisionAnalysisError } from "@/lib/vision/openai-analyzer";
import type { DrawingVisionAnalyzer, ValidatedVisionResult, VisionAnalysisDiagnostics } from "@/lib/vision/types";
import { consolidateVisionComponents } from "@/lib/vision/consolidate";
import { buildStructuralEvidence } from "@/lib/cad/structural-evidence";
import { fuseCadAndVisionComponents } from "@/lib/vision/fuse-cad-vision";
import { formatCategorizedComponents } from "@/lib/presentation/component-list";

type AnalyzerResult = DemoAnalysisResult | ValidatedVisionResult;
export type Analyzer = { analyze(input: { drawingId: string; sourcePath: string; rendered: RenderedCadDrawing }): Promise<AnalyzerResult> };

export type AnalysisMode = "demo" | "vision";

export type AnalysisDeps = {
  renderer: CadRenderAdapter;
  analyzer: Analyzer | DrawingVisionAnalyzer;
  analysisMode?: AnalysisMode;
  sourcePathResolver: (drawing: { storageKey: string }) => string;
  delayMs?: number;
};

export type AnalysisFailure = { code: string; userMessage: string; stage: string };

const stages = [
  { status: "converting", progress: 10, stage: "准备图纸" },
  { status: "converting", progress: 25, stage: "生成图纸预览" },
  { status: "analyzing", progress: 45, stage: "划分分析区域" },
  { status: "analyzing", progress: 68, stage: "识别可能的电气元件" },
  { status: "analyzing", progress: 84, stage: "合并重复检测" },
  { status: "analyzing", progress: 92, stage: "生成初步元件清单" },
] as const;

const sleep = (milliseconds: number) => milliseconds > 0 ? new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)) : Promise.resolve();

async function progress(drawingId: string, ownerScope: string, conversationId: string, jobId: string, item: (typeof stages)[number], delayMs: number) {
  await updateAnalysisStatus(drawingId, ownerScope, { status: item.status, progress: item.progress, stage: item.stage });
  await appendMessage(conversationId, { ownerScope, role: "assistant", type: "analysis_progress", payload: { jobId, status: item.status, stage: item.stage, progress: item.progress } });
  await sleep(delayMs);
}

async function isPreparedDemoDwg(sourcePath: string) {
  const source = await readFile(sourcePath);
  return source.subarray(0, 4096).toString("utf8").includes("DWG-ELECTRICAL-DEMO:control-panel-a");
}

export async function selectDefaultAdapters(
  sourceType: CadSourceType,
  sourcePath: string,
): Promise<{ renderer: CadRenderAdapter; analyzer: Analyzer; mode: AnalysisMode }> {
  if (sourceType === "dxf") return { renderer: getCadRenderer("dxf"), analyzer: openAiVisionAnalyzer as Analyzer, mode: "vision" };
  if (await isPreparedDemoDwg(sourcePath)) return { renderer: demoRenderer, analyzer: demoAnalyzer, mode: "demo" };
  return { renderer: getCadRenderer("dwg"), analyzer: openAiVisionAnalyzer as Analyzer, mode: "vision" };
}

function componentsFromAnalysis(mode: AnalysisMode, analysis: AnalyzerResult, rendered: RenderedCadDrawing): ComponentInput[] {
  if (mode === "vision") {
    const visualComponents = consolidateVisionComponents(analysis as ValidatedVisionResult, rendered);
    const context = rendered.metadata?.context;
    if (!context) return visualComponents;
    return fuseCadAndVisionComponents(visualComponents, buildStructuralEvidence(context, rendered));
  }
  return (analysis as DemoAnalysisResult).components;
}

function analysisDiagnosticsFrom(mode: AnalysisMode, analysis: AnalyzerResult, rendered: RenderedCadDrawing, componentCount: number): VisionAnalysisDiagnostics {
  if (mode === "vision") return (analysis as ValidatedVisionResult).analysisDiagnostics;
  return {
    attemptedTiles: rendered.tiles.length,
    completedTiles: rendered.tiles.length,
    failedTiles: 0,
    verificationTiles: 0,
    rawDetectionCount: componentCount,
    coverageLimited: Boolean(rendered.metadata?.coverageLimited),
  };
}

export function hasLimitedCoverage(diagnostics: VisionAnalysisDiagnostics) {
  return diagnostics.coverageLimited || diagnostics.failedTiles > 0 || diagnostics.completedTiles < diagnostics.attemptedTiles;
}

function warningList(warnings: string[], diagnostics: VisionAnalysisDiagnostics) {
  return [...new Set([
    ...warnings,
    ...(hasLimitedCoverage(diagnostics) ? ["部分区域未完整扫描，结果可能不完整。"] : []),
  ])];
}

function deviceOccurrences(components: Awaited<ReturnType<typeof replaceComponents>>): DeviceOccurrence[] {
  return components
    .filter((component) => !component.removedAt)
    .map((component) => ({
      temporaryId: component.temporaryId,
      occurrenceId: component.id,
      category: component.category as DeviceOccurrence["category"],
      tag: component.tag,
      description: component.description,
      specifications: stringValues(component.specifications),
      manufacturer: component.manufacturer,
      modelNumber: component.modelNumber,
      confidence: component.confidence,
      evidence: stringValues(component.evidence),
      reviewStatus: component.reviewStatus as DeviceOccurrence["reviewStatus"],
    }));
}

function stringValues(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const dwgConversionFailures: Record<string, Omit<AnalysisFailure, "code">> = {
  DWG_CONVERTER_NOT_INSTALLED: { stage: "DWG 转换不可用", userMessage: "此 Mac 尚未安装 DWG 转换器。" },
  DWG_CONVERSION_TIMEOUT: { stage: "DWG 转换超时", userMessage: "DWG 转换超时，请尝试简化图纸后重试。" },
  DWG_CONVERSION_FAILED: { stage: "DWG 转换失败", userMessage: "DWG 转换失败，请确认文件未损坏且版本受支持。" },
  DWG_CONVERTER_OUTPUT_MISSING: { stage: "DWG 转换失败", userMessage: "DWG 转换未生成可分析的图纸。" },
  DWG_CONVERTER_OUTPUT_TOO_LARGE: { stage: "DWG 转换失败", userMessage: "DWG 转换结果超过当前处理限制。" },
};

export function describeAnalysisFailure(error: unknown): AnalysisFailure {
  if (error instanceof VisionAnalysisError) return { code: error.code, userMessage: error.userMessage, stage: "AI 分析失败" };
  const code = error instanceof Error ? error.message : "ANALYSIS_FAILED";
  const dwgConversionFailure = dwgConversionFailures[code];
  if (dwgConversionFailure) return { code, ...dwgConversionFailure };
  if (code === "DWG_RENDERER_NOT_CONFIGURED") {
    return { code, stage: "DWG 转换不可用", userMessage: "当前尚未配置真实 DWG 转换器。请先上传 DXF，或使用内置 DWG 演示文件。" };
  }
  if (code === "DXF_PARSE_FAILED") return { code, stage: "DXF 解析失败", userMessage: "无法解析此 DXF 文件。请确认文件为有效的 ASCII DXF 后重试。" };
  return { code: "ANALYSIS_FAILED", stage: "分析失败", userMessage: "图纸分析未完成，请检查文件后重试。" };
}

export async function persistAnalysisFailure(drawingId: string, ownerScope: string, error: unknown) {
  const failure = describeAnalysisFailure(error);
  const current = await getAnalysisSnapshot(drawingId, ownerScope);
  if (!current?.job) return failure;
  await updateAnalysisStatus(drawingId, ownerScope, {
    status: "failed",
    progress: current.job.progress,
    stage: failure.stage,
    errorCode: failure.code,
    errorMessage: failure.userMessage,
  });
  await appendMessage(current.drawing.conversationId, {
    ownerScope,
    role: "assistant",
    type: "error",
    payload: { code: failure.code, message: failure.userMessage },
  });
  return failure;
}

export async function runDrawingAnalysis(drawingId: string, ownerScope: string, overrides: Partial<AnalysisDeps> = {}) {
  const snapshot = await getAnalysisSnapshot(drawingId, ownerScope);
  if (!snapshot?.job || !snapshot.drawing) throw new Error("DRAWING_NOT_FOUND");
  const sourceType = snapshot.drawing.sourceType as CadSourceType;
  const sourcePathResolver = overrides.sourcePathResolver ?? ((drawing: { storageKey: string }) => resolve(process.cwd(), "data", "uploads", drawing.storageKey));
  const sourcePath = sourcePathResolver(snapshot.drawing);
  const defaults = overrides.renderer && overrides.analyzer ? null : await selectDefaultAdapters(sourceType, sourcePath);
  const renderer = overrides.renderer ?? defaults?.renderer;
  const analyzer = overrides.analyzer ?? defaults?.analyzer;
  if (!renderer || !analyzer) throw new Error("ANALYSIS_ADAPTER_NOT_CONFIGURED");
  const analysisMode = overrides.analysisMode ?? defaults?.mode ?? (sourceType === "dxf" || analyzer !== demoAnalyzer ? "vision" : "demo");
  const delayMs = overrides.delayMs ?? Number(process.env.DEMO_STAGE_DELAY_MS ?? 350);

  for (const item of stages.slice(0, 2)) await progress(drawingId, ownerScope, snapshot.drawing.conversationId, snapshot.job.id, item, delayMs);
  const rendered = await renderer.render({ drawingId, sourcePath, sourceType });
  await saveDrawingPreview(drawingId, ownerScope, { overviewImageUrl: rendered.overviewImageUrl, width: rendered.width, height: rendered.height, tiles: rendered.tiles });
  for (const item of stages.slice(2, 4)) await progress(drawingId, ownerScope, snapshot.drawing.conversationId, snapshot.job.id, item, delayMs);
  const analysis = await analyzer.analyze({ drawingId, sourcePath, rendered });
  for (const item of stages.slice(4)) await progress(drawingId, ownerScope, snapshot.drawing.conversationId, snapshot.job.id, item, delayMs);
  const componentInputs = componentsFromAnalysis(analysisMode, analysis, rendered);
  const components = await replaceComponents(drawingId, ownerScope, componentInputs);
  const physicalDevices = await replacePhysicalDevices(drawingId, ownerScope, groupPhysicalDevices(deviceOccurrences(components)));
  const bom = await generateBom(drawingId, ownerScope);
  const analysisDiagnostics = analysisDiagnosticsFrom(analysisMode, analysis, rendered, components.length);
  const analysisWarnings = warningList(analysis.warnings, analysisDiagnostics);
  const reviewCount = components.filter((component) => component.reviewStatus === "requires_review").length;
  const unknownCount = components.filter((component) => component.category === "unknown").length;
  const confirmedCount = components.filter((component) => component.reviewStatus === "confirmed").length;
  const categoryCounts = components.reduce<Record<string, number>>((counts, component) => {
    counts[component.category] = (counts[component.category] ?? 0) + 1;
    return counts;
  }, {});
  await appendMessage(snapshot.drawing.conversationId, {
    ownerScope,
    role: "assistant",
    type: "drawing_summary",
    payload: { drawingId, summary: analysis.drawingSummary, warnings: analysisWarnings, analysisDiagnostics },
  });
  await appendMessage(snapshot.drawing.conversationId, {
    ownerScope,
    role: "assistant",
    type: "component_results",
    payload: {
      drawingId,
      total: components.length,
      symbolOccurrenceCount: components.length,
      physicalDeviceCount: physicalDevices.length,
      confirmed: confirmedCount,
      requiresReview: reviewCount,
      unknown: unknownCount,
      categoryCounts,
      analysisDiagnostics,
      warnings: analysisWarnings,
      markdown: formatCategorizedComponents(components, { physicalDeviceCount: physicalDevices.length }),
    },
  });
  await appendMessage(snapshot.drawing.conversationId, {
    ownerScope,
    role: "assistant",
    type: "bom_results",
    payload: { drawingId, physicalDeviceCount: physicalDevices.length, itemCount: bom?.items.length ?? 0, totalQuantity: bom?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0 },
  });
  const finalStatus = reviewCount || unknownCount || components.length === 0 || hasLimitedCoverage(analysisDiagnostics) ? "requires_review" : "completed";
  await updateAnalysisStatus(drawingId, ownerScope, { status: finalStatus, progress: 100, stage: "分析完成" });
  return { status: finalStatus, components, physicalDevices, bomItems: bom?.items ?? [], analysisDiagnostics };
}

export const runDemoAnalysis = runDrawingAnalysis;
