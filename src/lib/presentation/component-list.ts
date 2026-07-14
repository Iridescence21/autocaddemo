import { COMPONENT_CATEGORIES, type ComponentCategory } from "@/lib/domain";

export const COMPONENT_CATEGORY_LABELS: Record<ComponentCategory, string> = {
  circuit_breaker: "断路器",
  fuse: "熔断器",
  contactor: "接触器",
  relay: "继电器",
  terminal_block: "端子排",
  transformer: "变压器",
  power_supply: "电源",
  plc: "PLC",
  motor: "电动机",
  variable_frequency_drive: "变频器",
  sensor: "传感器",
  switch: "开关",
  push_button: "按钮",
  emergency_stop: "急停按钮",
  indicator_light: "指示灯",
  connector: "连接器",
  ground: "接地",
  unknown: "未知元件（需工程师复核）",
};

export type DisplayComponent = {
  id?: string;
  temporaryId: string;
  category: string;
  tag?: string | null;
  description: string;
  specifications: unknown;
  manufacturer?: string | null;
  modelNumber?: string | null;
  confidence: number;
  reviewStatus: string;
  removedAt?: unknown;
};

export type ComponentDisplayGroup = {
  category: ComponentCategory;
  label: string;
  components: DisplayComponent[];
};

export type ComponentListCounts = { physicalDeviceCount: number };

export function groupComponentsForDisplay(components: DisplayComponent[]): ComponentDisplayGroup[] {
  const active = components.filter((component) => !component.removedAt && component.reviewStatus !== "removed");
  return COMPONENT_CATEGORIES.flatMap((category) => {
    const matches = active.filter((component) => component.category === category);
    return matches.length ? [{ category, label: COMPONENT_CATEGORY_LABELS[category], components: matches }] : [];
  });
}

function visibleSpecifications(value: unknown) {
  if (!Array.isArray(value)) return "图纸中未显示";
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length ? items.join("；") : "图纸中未显示";
}

function reviewLabel(status: string) {
  if (status === "confirmed") return "已由工程师确认";
  if (status === "unknown") return "未知元件，需要工程师复核";
  return "需要工程师复核";
}

export function formatCategorizedComponents(components: DisplayComponent[], counts?: ComponentListCounts) {
  const groups = groupComponentsForDisplay(components);
  const activeCount = groups.reduce((count, group) => count + group.components.length, 0);
  const countSummary = `符号实例：${activeCount}\n\n物理设备：${counts?.physicalDeviceCount ?? "待生成"}`;
  if (!groups.length) return `### 符号清单\n\n${countSummary}\n\n未检测到可列出的电气元件。请由工程师检查图纸和识别范围。`;
  const sections = groups.map((group) => {
    const items = group.components.map((component, index) => {
      const identifier = component.tag?.trim() || component.temporaryId;
      return [
        `${index + 1}. **${identifier}** — ${component.description}`,
        `   - 规格：${visibleSpecifications(component.specifications)}`,
        `   - 制造商：${component.manufacturer?.trim() || "图纸中未显示"}`,
        `   - 型号：${component.modelNumber?.trim() || "图纸中未显示"}`,
        `   - 置信度：${Math.round(component.confidence * 100)}%`,
        `   - 状态：${reviewLabel(component.reviewStatus)}`,
      ].join("\n");
    }).join("\n");
    return `#### ${group.label}（${group.components.length}）\n\n${items}`;
  });
  return `### 符号清单（按类别）\n\n${countSummary}\n\n> 元件识别结果（按类别）现按符号实例与物理设备分别统计；以下为初步识别结果，必须由电气工程师复核。\n\n${sections.join("\n\n")}`;
}
