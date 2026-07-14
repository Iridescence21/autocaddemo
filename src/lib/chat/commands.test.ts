import { describe, expect, it } from "vitest";
import { parseDrawingCommand } from "@/lib/chat/commands";

describe("drawing chat commands", () => {
  it("parses safe component filters and selection", () => {
    expect(parseDrawingCommand("Show me all circuit breakers")).toEqual({ type: "filter_components", category: "circuit_breaker" });
    expect(parseDrawingCommand("Select KM1")).toEqual({ type: "select_component", tag: "KM1" });
    expect(parseDrawingCommand("显示所有断路器")).toEqual({ type: "filter_components", category: "circuit_breaker" });
    expect(parseDrawingCommand("选择 KM1")).toEqual({ type: "select_component", tag: "KM1" });
  });

  it("parses controlled mutations and outputs", () => {
    expect(parseDrawingCommand("Change component KM1 to a contactor")).toEqual({ type: "update_component", tag: "KM1", category: "contactor" });
    expect(parseDrawingCommand("Remove component 7")).toEqual({ type: "delete_component", temporaryId: "detection-007" });
    expect(parseDrawingCommand("Generate the BOM")).toEqual({ type: "generate_bom" });
    expect(parseDrawingCommand("Export the BOM")).toEqual({ type: "export_bom" });
    expect(parseDrawingCommand("把 KM1 改成接触器")).toEqual({ type: "update_component", tag: "KM1", category: "contactor" });
    expect(parseDrawingCommand("移除元件 7")).toEqual({ type: "delete_component", temporaryId: "detection-007" });
    expect(parseDrawingCommand("生成 BOM")).toEqual({ type: "generate_bom" });
    expect(parseDrawingCommand("导出 BOM")).toEqual({ type: "export_bom" });
    expect(parseDrawingCommand("显示需要复核的元件")).toEqual({ type: "show_review_items" });
  });

  it("returns null for unsupported or ambiguous commands", () => {
    expect(parseDrawingCommand("Do arbitrary database work")).toBeNull();
    expect(parseDrawingCommand("Change it")).toBeNull();
  });
});
