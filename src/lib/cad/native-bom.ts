import type { DxfPoint, DxfTextContext, NormalizedDxfDrawing } from "@/lib/cad/dxf-types";
import type { RenderedCadDrawing } from "@/lib/cad/types";
import { buildStructuralEvidence, parseDeviceTags, type StructuralTextEvidence } from "@/lib/cad/structural-evidence";

export type NativeBomRow = {
  itemNumber: number;
  rawSymbol: string;
  symbolTags: string[];
  name: string;
  modelSpec: string | null;
  quantity: number | null;
  cadPosition: DxfPoint;
  evidenceHandles: string[];
};

export type StructuralReviewIssue = {
  code: "BOM_MODEL_MISSING" | "BOM_QUANTITY_MISSING" | "BOM_TAG_QUANTITY_MISMATCH" | "BOM_TAG_CONFLICT";
  severity: "warning";
  message: string;
  tags: string[];
  itemNumbers: number[];
};

export type StructuralSnapshot = {
  schemaVersion: 1;
  counts: {
    entities: number;
    texts: number;
    blocks: number;
    layers: number;
    structuralTags: number;
    bomRows: number;
  };
  tags: StructuralTextEvidence[];
  bomRows: NativeBomRow[];
  reviewIssues: StructuralReviewIssue[];
};

type ColumnName = "itemNumber" | "symbol" | "name" | "modelSpec" | "quantity" | "remark";
type PositionedColumn = { name: ColumnName; x: number };

const HEADER_NAMES: Record<string, ColumnName> = {
  序号: "itemNumber",
  符号: "symbol",
  代号: "symbol",
  名称: "name",
  型号规格: "modelSpec",
  规格型号: "modelSpec",
  型号: "modelSpec",
  规格: "modelSpec",
  数量: "quantity",
  备注: "remark",
};

function normalizedText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").trim();
}

function yTolerance(drawing: NormalizedDxfDrawing) {
  return Math.max(0.35, Math.abs(drawing.extents.maxY - drawing.extents.minY) * 0.0025);
}

function groupByRow(texts: DxfTextContext[], tolerance: number) {
  const rows: DxfTextContext[][] = [];
  for (const item of [...texts].sort((left, right) => right.position.y - left.position.y || left.position.x - right.position.x)) {
    const row = rows.find((candidate) => Math.abs(candidate[0].position.y - item.position.y) <= tolerance);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => row.sort((left, right) => left.position.x - right.position.x));
}

function headerColumns(row: DxfTextContext[]): PositionedColumn[] {
  return row.flatMap((item) => {
    const name = HEADER_NAMES[normalizedText(item.value)];
    return name ? [{ name, x: item.position.x }] : [];
  });
}

function findHeader(rows: DxfTextContext[][]) {
  return rows
    .map((row) => ({ row, columns: headerColumns(row) }))
    .find(({ columns }) => {
      const names = new Set(columns.map((column) => column.name));
      return names.has("symbol") && names.has("name") && names.has("quantity") && columns.length >= 4;
    });
}

function columnBounds(columns: PositionedColumn[], index: number) {
  const previous = columns[index - 1]?.x;
  const next = columns[index + 1]?.x;
  const previousGap = previous === undefined ? Math.abs((next ?? columns[index].x + 10) - columns[index].x) : columns[index].x - previous;
  const nextGap = next === undefined ? previousGap : next - columns[index].x;
  return {
    min: previous === undefined ? columns[index].x - previousGap / 2 : (previous + columns[index].x) / 2,
    max: next === undefined ? columns[index].x + nextGap / 2 : (columns[index].x + next) / 2,
  };
}

function cellsForRow(row: DxfTextContext[], columns: PositionedColumn[]) {
  const cells = new Map<ColumnName, DxfTextContext[]>();
  columns.forEach((column, index) => {
    const bounds = columnBounds(columns, index);
    cells.set(column.name, row.filter((item) => item.position.x >= bounds.min && item.position.x < bounds.max));
  });
  return cells;
}

function cellText(cells: Map<ColumnName, DxfTextContext[]>, name: ColumnName) {
  return (cells.get(name) ?? []).map((item) => item.value.trim()).filter(Boolean).join("").trim();
}

function positiveInteger(value: string) {
  const match = value.match(/^\s*(\d+)/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function symbolTags(rawSymbol: string) {
  return parseDeviceTags(normalizedText(rawSymbol)).map((candidate) => candidate.tag);
}

export function extractNativeBomRows(drawing: NormalizedDxfDrawing): NativeBomRow[] {
  const rows = groupByRow(drawing.texts, yTolerance(drawing));
  const header = findHeader(rows);
  if (!header) return [];
  const columns = [...header.columns].sort((left, right) => left.x - right.x);
  const headerY = header.row.reduce((sum, item) => sum + item.position.y, 0) / header.row.length;
  const firstBounds = columnBounds(columns, 0);
  const lastBounds = columnBounds(columns, columns.length - 1);
  const dataRows = rows
    .filter((row) => row[0].position.y < headerY - yTolerance(drawing))
    .map((row) => row.filter((item) => item.position.x >= firstBounds.min && item.position.x < lastBounds.max))
    .filter((row) => row.length > 0);

  return dataRows.flatMap((row) => {
    const cells = cellsForRow(row, columns);
    const itemNumber = positiveInteger(cellText(cells, "itemNumber"));
    const rawSymbol = cellText(cells, "symbol");
    const name = cellText(cells, "name");
    if (itemNumber === null || !rawSymbol || !name) return [];
    const modelSpec = cellText(cells, "modelSpec") || null;
    const quantity = positiveInteger(cellText(cells, "quantity"));
    const evidenceColumns: ColumnName[] = ["itemNumber", "symbol", "name", "modelSpec", "quantity"];
    const evidence = [...new Set(evidenceColumns.flatMap((column) => cells.get(column) ?? []).map((item) => item.handle).filter((handle): handle is string => Boolean(handle)))];
    return [{
      itemNumber,
      rawSymbol,
      symbolTags: symbolTags(rawSymbol),
      name,
      modelSpec,
      quantity,
      cadPosition: { x: row[0].position.x, y: row[0].position.y },
      evidenceHandles: evidence,
    }];
  }).sort((left, right) => left.itemNumber - right.itemNumber);
}

export function reviewNativeBomRows(rows: NativeBomRow[]): StructuralReviewIssue[] {
  const issues: StructuralReviewIssue[] = [];
  for (const row of rows) {
    if (!row.modelSpec) {
      issues.push({ code: "BOM_MODEL_MISSING", severity: "warning", message: `BOM 第 ${row.itemNumber} 行“${row.name}”缺少型号规格。`, tags: row.symbolTags, itemNumbers: [row.itemNumber] });
    }
    if (row.quantity === null) {
      issues.push({ code: "BOM_QUANTITY_MISSING", severity: "warning", message: `BOM 第 ${row.itemNumber} 行“${row.name}”缺少有效数量。`, tags: row.symbolTags, itemNumbers: [row.itemNumber] });
    } else if (row.symbolTags.length > 0 && row.symbolTags.length !== row.quantity) {
      issues.push({
        code: "BOM_TAG_QUANTITY_MISMATCH",
        severity: "warning",
        message: `BOM 第 ${row.itemNumber} 行数量为 ${row.quantity}，但设备代号展开后为 ${row.symbolTags.length} 个。`,
        tags: row.symbolTags,
        itemNumbers: [row.itemNumber],
      });
    }
  }

  const rowsByTag = new Map<string, NativeBomRow[]>();
  for (const row of rows) {
    for (const tag of row.symbolTags) rowsByTag.set(tag, [...(rowsByTag.get(tag) ?? []), row]);
  }
  for (const [tag, tagRows] of rowsByTag) {
    const identities = new Set(tagRows.map((row) => `${row.name}\u0000${row.modelSpec ?? ""}`));
    if (identities.size > 1) {
      issues.push({
        code: "BOM_TAG_CONFLICT",
        severity: "warning",
        message: `设备代号 ${tag} 在同一图纸中对应多个名称或型号。`,
        tags: [tag],
        itemNumbers: [...new Set(tagRows.map((row) => row.itemNumber))],
      });
    }
  }
  return issues;
}

export function buildStructuralSnapshot(drawing: NormalizedDxfDrawing, rendered: RenderedCadDrawing): StructuralSnapshot {
  const tags = buildStructuralEvidence(drawing, rendered);
  const bomRows = extractNativeBomRows(drawing);
  return {
    schemaVersion: 1,
    counts: {
      entities: drawing.entities.length,
      texts: drawing.texts.length,
      blocks: drawing.blockNames.length,
      layers: drawing.layers.length,
      structuralTags: tags.length,
      bomRows: bomRows.length,
    },
    tags,
    bomRows,
    reviewIssues: reviewNativeBomRows(bomRows),
  };
}
