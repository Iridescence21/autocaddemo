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

function label(value: string | null | undefined) {
  return value?.trim() ? value : "图纸中未显示";
}

function reviewLabel(value: string) {
  return value === "confirmed" ? "已由工程师确认" : "需要工程师确认";
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
import { COMPONENT_CATEGORY_LABELS } from "@/lib/presentation/component-list";
import type { ComponentCategory } from "@/lib/domain";
