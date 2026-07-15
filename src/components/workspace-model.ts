import type { Drawing, MessageRecord, SessionFileGroup } from "./workspace-types";
import { projectWorkspaceResultState } from "@/lib/presentation/component-list";

const terminalAnalysisStatuses = new Set(["completed", "requires_review", "failed"]);

export function createLatestRequestGuard() {
  let latestRequest = 0;
  return {
    next() {
      latestRequest += 1;
      return latestRequest;
    },
    isCurrent(request: number) {
      return request === latestRequest;
    },
  };
}

export async function refreshMessagesAfterTerminal(conversationId: string, status: string, currentMessages: MessageRecord[]) {
  if (!terminalAnalysisStatuses.has(status)) return currentMessages;
  try {
    const response = await fetch(`/api/conversations/${conversationId}/messages`, { cache: "no-store" });
    if (!response.ok) return currentMessages;
    return ((await response.json()) as { messages: MessageRecord[] }).messages;
  } catch {
    return currentMessages;
  }
}

export function messagePayload(message: MessageRecord) {
  return (message.payload ?? {}) as Record<string, unknown>;
}

function belongsToDrawing(message: MessageRecord, drawingId: string) {
  const payload = messagePayload(message);
  return typeof payload.drawingId !== "string" || payload.drawingId === drawingId;
}

export function buildSessionFileGroups(drawing: Drawing | null, messages: MessageRecord[]): SessionFileGroup[] {
  const groups: SessionFileGroup[] = [
    { key: "source", title: "原始图纸", files: [] },
    { key: "artifacts", title: "分析产物", files: [] },
    { key: "exports", title: "导出结果", files: [] },
  ];

  if (!drawing) return groups;

  groups[0].files.push({
    key: `source:${drawing.id}`,
    name: drawing.originalFilename,
    kind: "source",
    byteSize: drawing.byteSize,
    description: `${drawing.sourceType.toUpperCase()} · 当前会话原始图纸`,
  });

  if (drawing.previewImageUrl) {
    groups[1].files.push({
      key: `preview:${drawing.id}`,
      name: "图纸总览.png",
      kind: "preview",
      previewUrl: drawing.previewImageUrl,
      description: `${drawing.previewWidth ?? "?"} × ${drawing.previewHeight ?? "?"} · 分析预览`,
    });
  }

  const seen = new Set<string>();
  for (const message of messages) {
    if (message.type !== "export" || !belongsToDrawing(message, drawing.id)) continue;
    const payload = messagePayload(message);
    const filename = typeof payload.filename === "string" ? payload.filename : "元件分析清单.xlsx";
    if (seen.has(filename)) continue;
    seen.add(filename);
    groups[2].files.push({
      key: `export:${message.id}`,
      name: filename,
      kind: "export",
      description: "当前会话导出结果",
      createdAt: message.createdAt,
    });
  }

  return groups;
}

export function buildWorkspaceCounts(drawing: Drawing | null) {
  const components = (drawing?.components ?? []).filter((component) => !component.removedAt);
  return {
    symbolOccurrences: components.length,
    physicalDevices: drawing?.physicalDevices.length ?? 0,
    reviewRequired: components.filter((component) => component.reviewStatus !== "confirmed" || component.category === "unknown").length,
    bomGroups: drawing?.bomItems.length ?? 0,
  };
}

export type MessageView = {
  id: string;
  role: "user" | "ai" | "system";
  kind: string;
  status: "success" | "error";
  text: string;
  warning?: string;
  rationale: string[];
  showThink: boolean;
  showTaskChain: boolean;
  stage?: string;
  progress?: number;
  taskStatus?: "loading" | "success" | "error";
  data: Record<string, unknown>;
};

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function buildMessageView(message: MessageRecord): MessageView {
  const data = messagePayload(message);
  const resultState = projectWorkspaceResultState(data);
  const isError = message.type === "error";
  const isProgress = message.type === "analysis_progress";
  const isSummary = message.type === "drawing_summary";
  const rationale = stringArray(data.evidence);
  if (isSummary && !rationale.length) {
    rationale.push("依据图层、块名、标注文字与几何关系生成初步识别结果。", "未显示的制造商、型号和规格不会被推断。");
  }

  let text = "";
  if (message.type === "text") text = String(data.text ?? "");
  if (isSummary) text = String(data.summary ?? "暂时无法生成图纸概览。");
  if (message.type === "component_results") text = typeof data.markdown === "string" ? data.markdown : `### 元件识别完成\n\n符号实例 **${resultState.symbolOccurrenceCount}** · 物理设备 **${resultState.physicalDeviceCount}** · 待复核 **${resultState.requiresReview}**`;
  if (message.type === "bom_results") text = `### 初步 BOM 已生成\n\n共 **${String(data.itemCount ?? 0)}** 个采购分组，合计数量 **${String(data.totalQuantity ?? 0)}**。`;
  if (message.type === "export") text = `### 导出完成\n\n文件 **${String(data.filename ?? "元件分析清单.xlsx")}** 已生成。`;
  if (message.type === "review_request") text = `### 需要工程师复核\n\n${Array.isArray(data.componentIds) ? data.componentIds.length : 0} 个元件等待确认。`;
  if (isError) text = String(data.message ?? "处理未完成，请重试。");

  const warnings = stringArray(data.warnings);
  const warning = resultState.coverageLimited || data.coverageLimited === true ? "扫描区域受限，结果可能不完整" : warnings[0];
  const progress = isProgress ? Number(data.progress ?? 0) : undefined;

  return {
    id: message.id,
    role: isError ? "system" : message.role === "user" ? "user" : "ai",
    kind: message.type,
    status: isError ? "error" : "success",
    text,
    warning,
    rationale,
    showThink: isSummary,
    showTaskChain: isProgress,
    stage: isProgress ? String(data.stage ?? "正在处理") : undefined,
    progress,
    taskStatus: isProgress ? (data.status === "failed" ? "error" : progress === 100 ? "success" : "loading") : undefined,
    data,
  };
}
