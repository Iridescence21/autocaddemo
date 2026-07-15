import type { NativeBomRow, StructuralSnapshot } from "@/lib/cad/native-bom";

export type DrawingQuestionIntent = "model_count" | "quantity" | "distribution" | "location" | "bom" | "review" | "unknown";

export type StructuralDrawingRecord = {
  id: string;
  conversationId: string;
  originalFilename: string;
  status: string;
  structuralSnapshot: StructuralSnapshot;
};

export type DrawingQuestionAnswer = {
  intent: DrawingQuestionIntent;
  entityName: string | null;
  text: string;
  evidence: string[];
  drawingIds: string[];
};

function normalize(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function quantity(row: NativeBomRow) {
  return row.quantity ?? (row.symbolTags.length || 1);
}

function entityNameFrom(question: string, drawings: StructuralDrawingRecord[]) {
  const normalizedQuestion = normalize(question);
  const names = [...new Set(drawings.flatMap((drawing) => drawing.structuralSnapshot.bomRows.map((row) => row.name)))]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  return names.find((name) => normalizedQuestion.includes(normalize(name))) ?? null;
}

function rowsFor(drawing: StructuralDrawingRecord, entityName: string) {
  const expected = normalize(entityName);
  return drawing.structuralSnapshot.bomRows.filter((row) => normalize(row.name).includes(expected) || expected.includes(normalize(row.name)));
}

function evidenceFor(drawing: StructuralDrawingRecord, rows: NativeBomRow[]) {
  return rows.map((row) => `${drawing.originalFilename} · BOM 第 ${row.itemNumber} 行 · ${row.name} · 型号 ${row.modelSpec ?? "未标注"} · 数量 ${quantity(row)} · 代号 ${row.rawSymbol}`);
}

function currentDrawing(input: DrawingQuestionInput) {
  return input.drawings.find((drawing) => drawing.id === input.currentDrawingId) ?? null;
}

function detectedIntent(question: string): DrawingQuestionIntent {
  const normalized = normalize(question);
  if (/审查|检查|校核|问题/.test(normalized)) return "review";
  if (/生成.*bom|bom.*清单|物料清单/.test(normalized)) return "bom";
  if (/哪张|哪个图纸|那个图纸|最多|分布/.test(normalized)) return /最多|哪张|分布/.test(normalized) ? "distribution" : "location";
  if (/在哪.*图纸|哪些图纸|什么图纸/.test(normalized)) return "location";
  if (/几种|多少种|类型|型号/.test(normalized)) return "model_count";
  if (/多少|几只|几个|数量/.test(normalized)) return "quantity";
  return "unknown";
}

export type DrawingQuestionInput = {
  question: string;
  currentDrawingId: string;
  drawings: StructuralDrawingRecord[];
};

function answerReview(input: DrawingQuestionInput): DrawingQuestionAnswer {
  const drawing = currentDrawing(input);
  if (!drawing) return { intent: "review", entityName: null, text: "当前图纸尚未完成 CAD 结构分析，请先运行图纸分析。", evidence: [], drawingIds: [] };
  const issues = drawing.structuralSnapshot.reviewIssues;
  const finding = issues.length
    ? `发现 ${issues.length} 项基础一致性问题：\n${issues.map((issue, index) => `${index + 1}. ${issue.message}`).join("\n")}`
    : "未发现 BOM 数量、代号、型号字段之间的基础一致性问题。";
  return {
    intent: "review",
    entityName: null,
    text: `${drawing.originalFilename}：${finding}\n\n本次审查基于 CAD 原生文字和 BOM，仅检查字段完整性与一致性，不包含保护整定、回路连通性或结构干涉校核。`,
    evidence: issues.map((issue) => `${drawing.originalFilename} · ${issue.code} · ${issue.message}`),
    drawingIds: [drawing.id],
  };
}

function answerBom(input: DrawingQuestionInput): DrawingQuestionAnswer {
  const drawing = currentDrawing(input);
  if (!drawing) return { intent: "bom", entityName: null, text: "当前图纸尚未完成 CAD 结构分析，请先运行图纸分析。", evidence: [], drawingIds: [] };
  const rows = drawing.structuralSnapshot.bomRows;
  const total = rows.reduce((sum, row) => sum + quantity(row), 0);
  return {
    intent: "bom",
    entityName: null,
    text: `已从 ${drawing.originalFilename} 的 CAD 原生表格生成 BOM：${rows.length} 行，合计 ${total} 件。可在右侧“BOM”面板查看并导出。`,
    evidence: evidenceFor(drawing, rows),
    drawingIds: [drawing.id],
  };
}

export function answerDrawingQuestion(input: DrawingQuestionInput): DrawingQuestionAnswer {
  const intent = detectedIntent(input.question);
  if (intent === "review") return answerReview(input);
  if (intent === "bom") return answerBom(input);
  const entityName = entityNameFrom(input.question, input.drawings);
  if (!entityName) {
    return {
      intent: "unknown",
      entityName: null,
      text: `未在当前已分析 CAD BOM 中找到与“${input.question.trim()}”匹配的设备名称。请使用图纸中的完整名称提问，或先完成图纸分析。`,
      evidence: [],
      drawingIds: [],
    };
  }

  if (intent === "distribution" || intent === "location") {
    const matches = input.drawings.map((drawing) => {
      const rows = rowsFor(drawing, entityName);
      return { drawing, rows, total: rows.reduce((sum, row) => sum + quantity(row), 0) };
    }).filter((match) => match.rows.length > 0).sort((left, right) => right.total - left.total || left.drawing.originalFilename.localeCompare(right.drawing.originalFilename));
    if (!matches.length) return { intent, entityName, text: `未在已分析图纸中找到${entityName}。`, evidence: [], drawingIds: [] };
    const details = matches.map((match) => `${match.drawing.originalFilename}：${match.total} 只，${new Set(match.rows.map((row) => row.modelSpec).filter(Boolean)).size} 种型号`).join("；");
    const text = intent === "distribution"
      ? `${matches[0].drawing.originalFilename} 最多，共 ${matches[0].total} 只${entityName}。对比结果：${details}。`
      : `在 ${matches.length} 张已分析图纸中找到${entityName}：${details}。`;
    return { intent, entityName, text, evidence: matches.flatMap((match) => evidenceFor(match.drawing, match.rows)), drawingIds: matches.map((match) => match.drawing.id) };
  }

  const drawing = currentDrawing(input);
  if (!drawing) return { intent, entityName, text: "当前图纸尚未完成 CAD 结构分析，请先运行图纸分析。", evidence: [], drawingIds: [] };
  const rows = rowsFor(drawing, entityName);
  if (!rows.length) return { intent, entityName, text: `${drawing.originalFilename} 的 CAD BOM 中未找到${entityName}。`, evidence: [], drawingIds: [drawing.id] };
  const total = rows.reduce((sum, row) => sum + quantity(row), 0);
  const models = [...new Set(rows.map((row) => row.modelSpec).filter((model): model is string => Boolean(model)))];
  const text = intent === "model_count"
    ? `${drawing.originalFilename} 中的${entityName}共有 ${models.length} 种型号：${models.length ? models.join("、") : "图纸未标注型号"}；合计 ${total} 只。`
    : `${drawing.originalFilename} 中的${entityName}共 ${total} 只，涉及代号：${rows.map((row) => row.rawSymbol).join("、")}。`;
  return { intent: intent === "unknown" ? "quantity" : intent, entityName, text, evidence: evidenceFor(drawing, rows), drawingIds: [drawing.id] };
}
