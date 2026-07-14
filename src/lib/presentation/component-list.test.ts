import { describe, expect, it } from "vitest";
import { formatCategorizedComponents, groupComponentsForDisplay } from "@/lib/presentation/component-list";

const components = [
  { id: "2", temporaryId: "relay-1", category: "relay", tag: "KA1", description: "可能为控制继电器", specifications: [], manufacturer: null, modelNumber: null, confidence: 0.72, reviewStatus: "requires_review", removedAt: null },
  { id: "1", temporaryId: "breaker-1", category: "circuit_breaker", tag: "QF1", description: "小型断路器", specifications: ["16A"], manufacturer: null, modelNumber: null, confidence: 0.94, reviewStatus: "confirmed", removedAt: null },
  { id: "3", temporaryId: "unknown-7", category: "unknown", tag: null, description: "无法识别的电气符号", specifications: [], manufacturer: null, modelNumber: null, confidence: 0.31, reviewStatus: "unknown", removedAt: null },
  { id: "4", temporaryId: "removed-1", category: "fuse", tag: "FU9", description: "已删除", specifications: [], manufacturer: null, modelNumber: null, confidence: 0.8, reviewStatus: "removed", removedAt: "2026-07-14T00:00:00.000Z" },
];

describe("Chinese categorized component list", () => {
  it("groups active components in stable electrical category order", () => {
    const groups = groupComponentsForDisplay(components);

    expect(groups.map((group) => group.label)).toEqual(["断路器", "继电器", "未知元件（需工程师复核）"]);
    expect(groups.flatMap((group) => group.components)).toHaveLength(3);
  });

  it("renders every active component exactly once with evidence state and missing values", () => {
    const markdown = formatCategorizedComponents(components);

    expect(markdown.match(/QF1/g)).toHaveLength(1);
    expect(markdown.match(/KA1/g)).toHaveLength(1);
    expect(markdown.match(/unknown-7/g)).toHaveLength(1);
    expect(markdown).not.toContain("FU9");
    expect(markdown).toContain("图纸中未显示");
    expect(markdown).toContain("94%");
    expect(markdown).toContain("已由工程师确认");
    expect(markdown).toContain("需要工程师复核");
  });

  it("labels the list as symbol occurrences and shows the distinct physical-device count", () => {
    const markdown = formatCategorizedComponents(components, { physicalDeviceCount: 2 });

    expect(markdown).toContain("符号实例：3");
    expect(markdown).toContain("物理设备：2");
    expect(markdown).toContain("符号清单");
  });
});
