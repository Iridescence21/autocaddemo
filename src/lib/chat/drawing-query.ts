import type { NativeBomRow, StructuralSnapshot } from "@/lib/cad/native-bom";

export type DrawingQuestionIntent = "overview" | "model_count" | "quantity" | "distribution" | "location" | "bom" | "review" | "unknown";

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

function drawingLabel(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

function compactTags(tags: string[]) {
  const unique = [...new Set(tags)].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const grouped = new Map<string, number[]>();
  const passthrough: string[] = [];
  for (const tag of unique) {
    const match = tag.match(/^([A-Z]+)(\d+)$/i);
    if (!match) {
      passthrough.push(tag);
      continue;
    }
    const [, prefix, number] = match;
    const key = prefix.toUpperCase();
    grouped.set(key, [...(grouped.get(key) ?? []), Number(number)]);
  }
  const ranges = [...grouped.entries()].flatMap(([prefix, numbers]) => {
    const sorted = [...new Set(numbers)].sort((left, right) => left - right);
    const parts: string[] = [];
    let start = sorted[0];
    let previous = sorted[0];
    for (const number of sorted.slice(1)) {
      if (number === previous + 1) {
        previous = number;
        continue;
      }
      parts.push(start === previous ? `${prefix}${start}` : `${prefix}${start}-${prefix}${previous}`);
      start = number;
      previous = number;
    }
    if (start !== undefined && previous !== undefined) parts.push(start === previous ? `${prefix}${start}` : `${prefix}${start}-${prefix}${previous}`);
    return parts;
  });
  return [...ranges, ...passthrough].join("、") || "未标注";
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

function tagsForRows(rows: NativeBomRow[]) {
  return compactTags(rows.flatMap((row) => row.symbolTags.length ? row.symbolTags : [row.rawSymbol]));
}

function currentDrawing(input: DrawingQuestionInput) {
  return input.drawings.find((drawing) => drawing.id === input.currentDrawingId) ?? null;
}

function detectedIntent(question: string): DrawingQuestionIntent {
  const normalized = normalize(question);
  if (/审查|检查|校核|问题/.test(normalized)) return "review";
  if (/生成.*bom|bom.*清单|物料清单/.test(normalized)) return "bom";
  if (/基本信息|讲一下|介绍|有什么|有哪些|包含哪些|识别到什么|识别出了什么/.test(normalized)) return "overview";
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

function answerOverview(input: DrawingQuestionInput): DrawingQuestionAnswer {
  const drawing = currentDrawing(input);
  if (!drawing) return { intent: "overview", entityName: null, text: "当前图纸尚未完成 CAD 结构分析，请先运行图纸分析。", evidence: [], drawingIds: [] };
  const rows = drawing.structuralSnapshot.bomRows;
  const quantities = new Map<string, number>();
  for (const row of rows) quantities.set(row.name, (quantities.get(row.name) ?? 0) + quantity(row));
  const groups = [...quantities.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const tableRows = groups.map(([name, count]) => {
    const groupRows = rows.filter((row) => row.name === name);
    const tags = groupRows.flatMap((row) => row.symbolTags.length ? row.symbolTags : [row.rawSymbol]);
    return `| ${name} | ${compactTags(tags)} | ${count} |`;
  }).join("\n");
  return {
    intent: "overview",
    entityName: null,
    text: [
      `这张 ${drawingLabel(drawing.originalFilename)} 基本信息：`,
      "",
      `- 文件：${drawing.originalFilename}`,
      `- 已解析：${drawing.structuralSnapshot.counts.entities} 个有效 CAD 实体、${drawing.structuralSnapshot.counts.texts} 条原生文字、${drawing.structuralSnapshot.counts.blocks} 个块、${drawing.structuralSnapshot.counts.layers} 个图层`,
      `- CAD 原生 BOM 共 ${rows.length} 行`,
      `- 已提取：${groups.length} 类设备，合计 ${groups.reduce((sum, [, count]) => sum + count, 0)} 个初步数量`,
      "",
      "图纸主要包含：",
      "",
      ...groups.slice(0, 8).map(([name, count]) => `- ${name} ${count} 只`),
      "",
      "已经提取出的标签集合包括：",
      "",
      "| 类型 | 原生标签 | 初步数量 |",
      "| --- | --- | ---: |",
      tableRows,
      "",
      "以上内容来自 DWG/CAD 原生实体、文字和 BOM 表格，结果仍需工程师复核。",
    ].join("\n"),
    evidence: evidenceFor(drawing, rows),
    drawingIds: [drawing.id],
  };
}

export function answerDrawingQuestion(input: DrawingQuestionInput): DrawingQuestionAnswer {
  const intent = detectedIntent(input.question);
  if (intent === "review") return answerReview(input);
  if (intent === "bom") return answerBom(input);
  if (intent === "overview") return answerOverview(input);
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
    const top = matches[0];
    const second = matches[1];
    const table = [
      `| 图纸 | ${entityName} | 数量 |`,
      "| --- | --- | ---: |",
      ...[...matches].sort((left, right) => left.drawing.originalFilename.localeCompare(right.drawing.originalFilename)).map((match) => `| ${match.drawing.originalFilename} | ${tagsForRows(match.rows)} | ${match.total}只 |`),
    ].join("\n");
    const modelLine = [...new Set(top.rows.map((row) => row.modelSpec).filter(Boolean))]
      .map((model) => `\`${model}\``)
      .join(" 和 ");
    const text = intent === "distribution"
      ? [
        matches.length > 1 ? `${matches.length === 2 ? "两" : matches.length}张图纸里都找到${entityName}，但 ${top.drawing.originalFilename} 更多：` : `已找到${entityName}的图纸分布：`,
        "",
        table,
        "",
        "因此：",
        "",
        `- ${top.drawing.originalFilename} 最多，共 ${top.total} 只${entityName}。`,
        second ? `- 分布最多的是 ${top.drawing.originalFilename}，比 ${second.drawing.originalFilename} 多 ${top.total - second.total} 只。` : `- 分布最多的是 ${top.drawing.originalFilename}。`,
        `- ${entityName}在 ${matches.length} 张图中${matches.length > 1 ? "都有" : "出现"}。`,
        modelLine ? `- ${top.drawing.originalFilename} 中包含 ${modelLine} ${new Set(top.rows.map((row) => row.modelSpec).filter(Boolean)).size} 种型号。` : "",
        matches.length > 1 ? `- 如果这些是关联图纸，重复标签可能是跨图引用，项目总数不能直接相加。` : "",
      ].filter(Boolean).join("\n")
      : [
        `在 ${matches.length} 张已分析图纸中找到${entityName}：`,
        "",
        table,
        "",
        "因此：",
        "",
        `- ${entityName}在 ${matches.length} 张图中${matches.length > 1 ? "都有" : "出现"}。`,
        `- 数量最多的是 ${top.drawing.originalFilename}，共 ${top.total} 只。`,
        matches.length > 1 ? `- 如果这些是关联图纸，重复标签可能是跨图引用，项目总数不能直接相加。` : "",
      ].filter(Boolean).join("\n");
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
