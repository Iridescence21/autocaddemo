import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMessageView } from "./workspace-model";
import type { MessageRecord } from "./workspace-types";

function message(type: string, payload: Record<string, unknown>, role = "assistant"): MessageRecord {
  return { id: `${type}-1`, type, role, payload, createdAt: "2026-07-14T10:00:00Z" };
}

describe("drawing message view model", () => {
  it("renders one official Bubble.List with inline reasoning and actions", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-message-list.tsx"), "utf8");

    expect(source).toContain("<Bubble.List");
    expect(source).toContain("items={items}");
    expect(source).toContain("ThoughtChain");
    expect(source).toContain("Think");
    expect(source).toContain("Actions");
    expect(source).not.toContain("onOpenInspector");
  });

  it("maps user text and failures to distinct bubble roles", () => {
    expect(buildMessageView(message("text", { text: "识别这张图纸" }, "user"))).toMatchObject({ role: "user", kind: "text" });
    expect(buildMessageView(message("error", { message: "转换失败" }))).toMatchObject({ role: "system", kind: "error", status: "error" });
  });

  it("uses Think for public identification rationale, not task progress", () => {
    const summary = buildMessageView(message("drawing_summary", {
      summary: "识别到控制柜回路。",
      warnings: ["文字层不完整"],
      evidence: ["块名和图层共同匹配"],
    }));

    expect(summary.showThink).toBe(true);
    expect(summary.showTaskChain).toBe(false);
    expect(summary.rationale).toContain("块名和图层共同匹配");
  });

  it("presents structural-only completion as demo-friendly CAD evidence", () => {
    const summary = buildMessageView(message("drawing_summary", {
      summary: "已读取 CAD 原生数据：989 条文字、196 条设备代号、42 行 BOM。",
      warnings: ["已使用 CAD 原生 BOM 和文字证据生成结果；视觉识别未在演示路径中等待，结果需工程师复核。"],
      structuralOnly: true,
    }));
    const progress = buildMessageView(message("analysis_progress", {
      status: "requires_review",
      progress: 100,
      stage: "CAD 结构分析完成（视觉识别受限）",
    }));

    expect(summary.text).toBe("已读取 CAD 原生数据：989 条文字、196 条设备代号、42 行 BOM。");
    expect(summary.warning).toBe("结果来自 CAD 原生文字和 BOM 表格，需工程师复核。");
    expect(progress.stage).toBe("CAD 结构分析完成");
  });

  it("uses ThoughtChain for real CAD stages and keeps limited coverage visible", () => {
    const progress = buildMessageView(message("analysis_progress", { stage: "切分分析瓦片", progress: 62, status: "analyzing" }));
    const result = buildMessageView(message("component_results", { symbolOccurrenceCount: 12, physicalDeviceCount: 8, coverageLimited: true }));

    expect(progress).toMatchObject({ showThink: false, showTaskChain: true, progress: 62, stage: "切分分析瓦片" });
    expect(result.warning).toBe("扫描区域受限，结果可能不完整");
  });
});
