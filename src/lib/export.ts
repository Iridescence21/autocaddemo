import ExcelJS from "exceljs";
import { COMPONENT_CATEGORY_LABELS } from "@/lib/presentation/component-list";
import type { ComponentCategory } from "@/lib/domain";

type BomExportRow = {
  id: string;
  itemNumber: number;
  category: string;
  description: string;
  manufacturer: string | null;
  modelNumber: string | null;
  specifications: unknown;
  quantity: number;
  confidence: number;
  reviewStatus: string;
};

type ComponentExportRow = {
  id: string;
  temporaryId: string;
  category: string;
  tag: string | null;
  description: string;
  manufacturer: string | null;
  modelNumber: string | null;
  specifications: unknown;
  confidence: number;
  reviewStatus: string;
  evidence: unknown;
  method: string;
  sourceTileId: string | null;
  location: unknown;
  originalCategory: string | null;
  correctedCategory: string | null;
  removedAt: Date | string | null;
};

function label(value: string | null | undefined) {
  return value?.trim() ? value : "图纸中未显示";
}

function reviewLabel(value: string) {
  if (value === "confirmed") return "已由工程师确认";
  if (value === "removed") return "已移除";
  if (value === "unknown") return "未知元件，需要工程师确认";
  return "需要工程师确认";
}

function safeExcelText(value: unknown, missing = "图纸中未显示") {
  const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value);
  if (!text) return missing;
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function stringValues(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => safeExcelText(item))
    : [];
}

function locationValues(value: unknown) {
  const fallback = [0, 0, 0, 0] as const;
  if (!value || typeof value !== "object") return fallback;
  const location = value as Record<string, unknown>;
  const values = [location.x, location.y, location.width, location.height];
  return values.every((item) => typeof item === "number" && Number.isFinite(item))
    ? values as [number, number, number, number]
    : fallback;
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function bomToCsv(rows: BomExportRow[]) {
  const header = ["项目 ID", "项次", "类别", "描述", "制造商", "型号", "规格", "数量", "置信度", "复核状态"];
  const body = rows.map((row) => [
    row.id, row.itemNumber, COMPONENT_CATEGORY_LABELS[row.category as ComponentCategory] ?? row.category, row.description, label(row.manufacturer), label(row.modelNumber),
    Array.isArray(row.specifications) ? row.specifications.join("; ") || "图纸中未显示" : "图纸中未显示",
    row.quantity, row.confidence.toFixed(2), reviewLabel(row.reviewStatus),
  ]);
  return "\uFEFF" + [header, ...body].map((line) => line.map(csvCell).join(",")).join("\n") + "\n";
}

export function buildComponentWorkbook(input: {
  drawingId: string;
  filename: string;
  components: ComponentExportRow[];
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "电气图纸 AI";
  workbook.created = new Date();
  workbook.subject = "初步电气元件分析结果（需要工程师复核）";

  const sheet = workbook.addWorksheet("元件分析清单", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 22 },
  });
  sheet.columns = [
    { header: "序号", key: "number", width: 8 },
    { header: "元件 ID", key: "id", width: 24 },
    { header: "标签", key: "tag", width: 16 },
    { header: "类别", key: "category", width: 22 },
    { header: "描述", key: "description", width: 30 },
    { header: "规格", key: "specifications", width: 24 },
    { header: "制造商", key: "manufacturer", width: 20 },
    { header: "型号", key: "modelNumber", width: 20 },
    { header: "数量", key: "quantity", width: 10 },
    { header: "置信度", key: "confidence", width: 12 },
    { header: "复核状态", key: "reviewStatus", width: 22 },
    { header: "识别方法", key: "method", width: 18 },
    { header: "识别证据", key: "evidence", width: 40 },
    { header: "来源区域", key: "sourceTileId", width: 18 },
    { header: "位置 X", key: "x", width: 12 },
    { header: "位置 Y", key: "y", width: 12 },
    { header: "宽度", key: "width", width: 12 },
    { header: "高度", key: "height", width: 12 },
    { header: "原始类别", key: "originalCategory", width: 18 },
    { header: "修正类别", key: "correctedCategory", width: 18 },
    { header: "是否移除", key: "removed", width: 12 },
    { header: "图纸 ID", key: "drawingId", width: 24 },
    { header: "图纸文件", key: "filename", width: 28 },
  ];

  input.components.forEach((component, index) => {
    const [x, y, width, height] = locationValues(component.location);
    sheet.addRow({
      number: index + 1,
      id: safeExcelText(component.id),
      tag: safeExcelText(component.tag),
      category: safeExcelText(COMPONENT_CATEGORY_LABELS[component.category as ComponentCategory] ?? component.category),
      description: safeExcelText(component.description),
      specifications: stringValues(component.specifications).join("；") || "图纸中未显示",
      manufacturer: safeExcelText(component.manufacturer),
      modelNumber: safeExcelText(component.modelNumber),
      quantity: 1,
      confidence: component.confidence,
      reviewStatus: reviewLabel(component.removedAt ? "removed" : component.reviewStatus),
      method: safeExcelText(component.method),
      evidence: stringValues(component.evidence).join("；") || "图纸中未显示",
      sourceTileId: safeExcelText(component.sourceTileId),
      x,
      y,
      width,
      height,
      originalCategory: component.originalCategory
        ? safeExcelText(COMPONENT_CATEGORY_LABELS[component.originalCategory as ComponentCategory] ?? component.originalCategory)
        : "图纸中未显示",
      correctedCategory: component.correctedCategory
        ? safeExcelText(COMPONENT_CATEGORY_LABELS[component.correctedCategory as ComponentCategory] ?? component.correctedCategory)
        : "图纸中未显示",
      removed: component.removedAt ? "是" : "否",
      drawingId: safeExcelText(input.drawingId),
      filename: safeExcelText(input.filename),
    });
  });

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1677FF" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.height = 28;
  sheet.autoFilter = { from: "A1", to: `W${Math.max(sheet.rowCount, 1)}` };

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: "top", wrapText: true };
      row.getCell(10).numFmt = "0%";
      if (rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F9FC" } };
    }
  });

  return workbook;
}
