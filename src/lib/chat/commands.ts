import { COMPONENT_CATEGORIES, type ComponentCategory } from "@/lib/domain";

export type DrawingCommand =
  | { type: "filter_components"; category: ComponentCategory }
  | { type: "select_component"; tag: string }
  | { type: "update_component"; tag: string; category: ComponentCategory }
  | { type: "delete_component"; temporaryId: string }
  | { type: "generate_bom" }
  | { type: "export_bom" }
  | { type: "show_review_items" };

const categoryAliases: Record<string, ComponentCategory> = {
  "circuit breaker": "circuit_breaker",
  "circuit breakers": "circuit_breaker",
  fuse: "fuse",
  fuses: "fuse",
  contactor: "contactor",
  contactors: "contactor",
  relay: "relay",
  relays: "relay",
  motor: "motor",
  motors: "motor",
  "terminal block": "terminal_block",
  "terminal blocks": "terminal_block",
  "push button": "push_button",
  "push buttons": "push_button",
  sensor: "sensor",
  sensors: "sensor",
  "断路器": "circuit_breaker",
  "熔断器": "fuse",
  "保险丝": "fuse",
  "接触器": "contactor",
  "继电器": "relay",
  "端子排": "terminal_block",
  "变压器": "transformer",
  "电源": "power_supply",
  "可编程控制器": "plc",
  "电动机": "motor",
  "电机": "motor",
  "变频器": "variable_frequency_drive",
  "传感器": "sensor",
  "开关": "switch",
  "按钮": "push_button",
  "急停按钮": "emergency_stop",
  "指示灯": "indicator_light",
  "连接器": "connector",
  "接地": "ground",
  "未知元件": "unknown",
};

export function parseDrawingCommand(input: string): DrawingCommand | null {
  const text = input.trim().toLowerCase();
  if (/^show( me)? all /.test(text)) {
    const phrase = text.replace(/^show( me)? all /, "");
    const category = categoryAliases[phrase];
    return category ? { type: "filter_components", category } : null;
  }
  const chineseFilter = text.match(/^(?:显示|查看)(?:所有|全部)\s*(.+)$/);
  if (chineseFilter) {
    const category = categoryAliases[chineseFilter[1].replace(/^的/, "").trim()];
    return category ? { type: "filter_components", category } : null;
  }
  const select = text.match(/^(?:select|show details for)\s+([a-z]{1,4}\d{1,3})$/);
  if (select) return { type: "select_component", tag: select[1].toUpperCase() };
  const chineseSelect = text.match(/^(?:选择|查看)\s*([a-z]{1,4}\d{1,3})$/i);
  if (chineseSelect) return { type: "select_component", tag: chineseSelect[1].toUpperCase() };
  const update = text.match(/^(?:change|update) (?:component )?([a-z]{1,4}\d{1,3}) to (?:a |an )?([a-z ]+)$/);
  if (update) {
    const category = categoryAliases[update[2].trim()] ?? (update[2].trim() as ComponentCategory);
    if (!COMPONENT_CATEGORIES.includes(category)) return null;
    return { type: "update_component", tag: update[1].toUpperCase(), category };
  }
  const chineseUpdate = text.match(/^(?:把|将)\s*([a-z]{1,4}\d{1,3})\s*(?:改成|修改为|设为)\s*(.+)$/i);
  if (chineseUpdate) {
    const category = categoryAliases[chineseUpdate[2].trim()];
    return category ? { type: "update_component", tag: chineseUpdate[1].toUpperCase(), category } : null;
  }
  const remove = text.match(/^remove component (\d+)$/);
  if (remove) return { type: "delete_component", temporaryId: `detection-${remove[1].padStart(3, "0")}` };
  const chineseRemove = text.match(/^(?:移除|删除)\s*(?:元件)?\s*(\d+)$/);
  if (chineseRemove) return { type: "delete_component", temporaryId: `detection-${chineseRemove[1].padStart(3, "0")}` };
  if (/^(generate|create) (the )?bom$/.test(text)) return { type: "generate_bom" };
  if (/^(?:生成|创建)(?:初步|采购)?\s*bom$/i.test(text)) return { type: "generate_bom" };
  if (/^(export|download) (the )?bom$/.test(text)) return { type: "export_bom" };
  if (/^(?:导出|下载)(?:初步|采购)?\s*bom$/i.test(text)) return { type: "export_bom" };
  if (/show (me )?(the )?(low confidence|review|uncertain)/.test(text)) return { type: "show_review_items" };
  if (/(?:显示|查看).*(?:复核|低置信度|不确定|未知)/.test(text)) return { type: "show_review_items" };
  return null;
}
