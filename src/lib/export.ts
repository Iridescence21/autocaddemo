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
  physicalDeviceId?: string | null;
};

type PhysicalDeviceExportRow = {
  id: string;
  temporaryId: string;
  tag: string | null;
  category: string;
  description: string;
  manufacturer: string | null;
  modelNumber: string | null;
  specifications: unknown;
  quantity: number;
  confidence: number;
  reviewStatus: string;
  evidence: unknown;
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
  physicalDevices: PhysicalDeviceExportRow[];
  bomItems: BomExportRow[];
  analysisWarnings: string[];
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "电气图纸 AI";
  workbook.created = new Date();
  workbook.subject = "初步电气元件分析结果（需要工程师复核）";

  const sheet = workbook.addWorksheet("元件分析清单", {
    views: [{ state: "frozen", ySplit: 5 }],
    properties: { defaultRowHeight: 22 },
  });
  const occurrenceHeaders = ["序号", "符号实例 ID", "标签", "类别", "描述", "规格", "制造商", "型号", "物理设备 ID", "物理设备标签", "置信度", "复核状态", "识别方法", "识别证据", "来源区域", "位置 X", "位置 Y", "宽度", "高度", "原始类别", "修正类别", "是否移除", "图纸 ID", "图纸文件"];
  const deviceHeaders = ["物理设备 ID", "物理设备标签", "类别", "描述", "制造商", "型号", "规格", "关联符号数量", "采购数量", "置信度", "复核状态", "识别证据"];
  const widths = [8, 24, 16, 22, 30, 24, 20, 20, 24, 18, 12, 22, 18, 40, 18, 12, 12, 12, 12, 18, 18, 12, 24, 28];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getCell("A1").value = "符号实例清单";
  sheet.getCell("A2").value = `图纸：${safeExcelText(input.filename)}`;
  sheet.getCell("A3").value = input.analysisWarnings.length ? input.analysisWarnings.map((warning) => safeExcelText(warning)).join("；") : "初步识别结果必须由电气工程师复核。";
  sheet.getRow(5).values = occurrenceHeaders;
  const devicesById = new Map(input.physicalDevices.map((device) => [device.id, device]));

  input.components.forEach((component, index) => {
    const [x, y, width, height] = locationValues(component.location);
    const physicalDevice = component.physicalDeviceId ? devicesById.get(component.physicalDeviceId) : undefined;
    sheet.addRow([
      index + 1, safeExcelText(component.temporaryId), safeExcelText(component.tag), safeExcelText(COMPONENT_CATEGORY_LABELS[component.category as ComponentCategory] ?? component.category), safeExcelText(component.description),
      stringValues(component.specifications).join("；") || "图纸中未显示", safeExcelText(component.manufacturer), safeExcelText(component.modelNumber), safeExcelText(physicalDevice?.temporaryId), safeExcelText(physicalDevice?.tag),
      component.confidence, reviewLabel(component.removedAt ? "removed" : component.reviewStatus), safeExcelText(component.method), stringValues(component.evidence).join("；") || "图纸中未显示", safeExcelText(component.sourceTileId),
      x, y, width, height,
      component.originalCategory ? safeExcelText(COMPONENT_CATEGORY_LABELS[component.originalCategory as ComponentCategory] ?? component.originalCategory) : "图纸中未显示",
      component.correctedCategory ? safeExcelText(COMPONENT_CATEGORY_LABELS[component.correctedCategory as ComponentCategory] ?? component.correctedCategory) : "图纸中未显示",
      component.removedAt ? "是" : "否", safeExcelText(input.drawingId), safeExcelText(input.filename),
    ]);
  });

  styleHeader(sheet.getRow(5));
  sheet.autoFilter = { from: "A5", to: `X${Math.max(5 + input.components.length, 5)}` };

  for (let rowNumber = 6; rowNumber <= 5 + input.components.length; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    styleDataRow(row, 11, rowNumber);
  }

  const deviceTitleRow = 5 + input.components.length + 3;
  sheet.getCell(deviceTitleRow, 1).value = "物理设备与初步 BOM";
  sheet.getRow(deviceTitleRow + 1).values = deviceHeaders;
  styleHeader(sheet.getRow(deviceTitleRow + 1));
  input.physicalDevices.forEach((device, index) => {
    const linkedSymbols = input.components.filter((component) => component.physicalDeviceId === device.id && !component.removedAt).length;
    const bomItem = findBomItem(device, input.bomItems);
    const row = sheet.addRow([
      safeExcelText(device.temporaryId), safeExcelText(device.tag), safeExcelText(COMPONENT_CATEGORY_LABELS[device.category as ComponentCategory] ?? device.category), safeExcelText(device.description), safeExcelText(device.manufacturer), safeExcelText(device.modelNumber),
      stringValues(device.specifications).join("；") || "图纸中未显示", linkedSymbols, bomItem?.quantity ?? device.quantity, device.confidence, reviewLabel(device.reviewStatus), stringValues(device.evidence).join("；") || "图纸中未显示",
    ]);
    styleDataRow(row, 10, index + deviceTitleRow + 2);
  });

  return workbook;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1677FF" } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 28;
}

function styleDataRow(row: ExcelJS.Row, confidenceColumn: number, rowNumber: number) {
  row.alignment = { vertical: "top", wrapText: true };
  row.getCell(confidenceColumn).numFmt = "0%";
  if (rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F9FC" } };
}

function findBomItem(device: PhysicalDeviceExportRow, bomItems: BomExportRow[]) {
  const deviceKey = JSON.stringify([device.category, device.description, device.manufacturer, device.modelNumber, device.specifications]);
  return bomItems.find((item) => JSON.stringify([item.category, item.description, item.manufacturer, item.modelNumber, item.specifications]) === deviceKey);
}
