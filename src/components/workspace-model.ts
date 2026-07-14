import type { Drawing, MessageRecord, SessionFileGroup } from "./workspace-types";

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
