import { describe, expect, it } from "vitest";
import { commandForSuggestion, suggestionItems } from "./analysis-composer";

describe("analysis composer commands", () => {
  it("maps every visible suggestion to a supported workspace command", () => {
    expect(commandForSuggestion("analyze")).toBe("分析这张图纸，并按类别列出所有可识别的电气元件。");
    expect(commandForSuggestion("review")).toBe("显示需要工程师复核的项目");
    expect(commandForSuggestion("bom")).toBe("生成初步 BOM");
    expect(commandForSuggestion("export")).toBe("导出 BOM");
    expect(suggestionItems.map((item) => item.value)).toEqual(["analyze", "filter", "review", "bom", "export"]);
  });

  it("falls back to the selected value instead of inventing a command", () => {
    expect(commandForSuggestion("筛选接触器")).toBe("筛选接触器");
  });
});
