import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ComponentInput } from "@/lib/domain";
import { appendMessage } from "@/lib/repositories/messages";
import { getAnalysisSnapshot, saveDrawingPreview, updateAnalysisStatus } from "@/lib/repositories/drawings";
import { generateBom, replaceComponents } from "@/lib/repositories/components";
import { demoAnalyzer } from "@/lib/cad/demo-analyzer";
import { getCadRenderer } from "@/lib/cad/registry";
import type { CadRenderAdapter, CadSourceType, DemoAnalysisResult, RenderedCadDrawing } from "@/lib/cad/types";
import { openAiVisionAnalyzer, VisionAnalysisError } from "@/lib/vision/openai-analyzer";
import type { DrawingVisionAnalyzer, ValidatedVisionResult } from "@/lib/vision/types";
import { consolidateVisionComponents } from "@/lib/vision/consolidate";
import { formatCategorizedComponents } from "@/lib/presentation/component-list";

type AnalyzerResult = DemoAnalysisResult | ValidatedVisionResult;
type Analyzer = { analyze(input: { drawingId: string; sourcePath: string; rendered: RenderedCadDrawing }): Promise<AnalyzerResult> };

export type AnalysisDeps = {
  renderer: CadRenderAdapter;
  analyzer: Analyzer | DrawingVisionAnalyzer;
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

async function defaultAdapters(sourceType: CadSourceType, sourcePath: string) {
  if (sourceType === "dxf") return { renderer: getCadRenderer("dxf"), analyzer: openAiVisionAnalyzer as Analyzer };
  if (!await isPreparedDemoDwg(sourcePath)) throw new Error("DWG_RENDERER_NOT_CONFIGURED");
  return { renderer: getCadRenderer("dwg"), analyzer: demoAnalyzer as Analyzer };
}

function componentsFromAnalysis(sourceType: CadSourceType, analysis: AnalyzerResult, rendered: RenderedCadDrawing): ComponentInput[] {
  if (sourceType === "dxf") return consolidateVisionComponents(analysis as ValidatedVisionResult, rendered);
  return (analysis as DemoAnalysisResult).components;
}

export function describeAnalysisFailure(error: unknown): AnalysisFailure {
  if (error instanceof VisionAnalysisError) return { code: error.code, userMessage: error.userMessage, stage: "AI 分析失败" };
  const code = error instanceof Error ? error.message : "ANALYSIS_FAILED";
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
  const defaults = overrides.renderer && overrides.analyzer ? null : await defaultAdapters(sourceType, sourcePath);
  const renderer = overrides.renderer ?? defaults?.renderer;
  const analyzer = overrides.analyzer ?? defaults?.analyzer;
  if (!renderer || !analyzer) throw new Error("ANALYSIS_ADAPTER_NOT_CONFIGURED");
  const delayMs = overrides.delayMs ?? Number(process.env.DEMO_STAGE_DELAY_MS ?? 350);

  for (const item of stages.slice(0, 2)) await progress(drawingId, ownerScope, snapshot.drawing.conversationId, snapshot.job.id, item, delayMs);
  const rendered = await renderer.render({ drawingId, sourcePath, sourceType });
  await saveDrawingPreview(drawingId, ownerScope, { overviewImageUrl: rendered.overviewImageUrl, width: rendered.width, height: rendered.height, tiles: rendered.tiles });
  for (const item of stages.slice(2, 4)) await progress(drawingId, ownerScope, snapshot.drawing.conversationId, snapshot.job.id, item, delayMs);
  const analysis = await analyzer.analyze({ drawingId, sourcePath, rendered });
  for (const item of stages.slice(4)) await progress(drawingId, ownerScope, snapshot.drawing.conversationId, snapshot.job.id, item, delayMs);
  const componentInputs = componentsFromAnalysis(sourceType, analysis, rendered);
  const components = await replaceComponents(drawingId, ownerScope, componentInputs);
  const reviewCount = components.filter((component) => component.reviewStatus === "requires_review").length;
  const unknownCount = components.filter((component) => component.category === "unknown").length;
  const confirmedCount = components.filter((component) => component.reviewStatus === "confirmed").length;
  await appendMessage(snapshot.drawing.conversationId, {
    ownerScope,
    role: "assistant",
    type: "drawing_summary",
    payload: { drawingId, summary: analysis.drawingSummary, warnings: analysis.warnings },
  });
  await appendMessage(snapshot.drawing.conversationId, {
    ownerScope,
    role: "assistant",
    type: "component_results",
    payload: {
      drawingId,
      total: components.length,
      confirmed: confirmedCount,
      requiresReview: reviewCount,
      unknown: unknownCount,
      markdown: formatCategorizedComponents(components),
    },
  });
  const bom = await generateBom(drawingId, ownerScope);
  await appendMessage(snapshot.drawing.conversationId, {
    ownerScope,
    role: "assistant",
    type: "bom_results",
    payload: { drawingId, itemCount: bom?.items.length ?? 0, totalQuantity: bom?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0 },
  });
  const finalStatus = reviewCount || unknownCount || components.length === 0 ? "requires_review" : "completed";
  await updateAnalysisStatus(drawingId, ownerScope, { status: finalStatus, progress: 100, stage: "分析完成" });
  return { status: finalStatus, components, bomItems: bom?.items ?? [] };
}

export const runDemoAnalysis = runDrawingAnalysis;
