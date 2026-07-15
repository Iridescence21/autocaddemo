import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Ant Design X Chinese drawing workspace", () => {
  it("uses a responsive three-pane shell without a forced desktop minimum width", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");
    const shell = await readFile(resolve(process.cwd(), "src/components/workspace-shell.tsx"), "utf8");
    const sidebar = await readFile(resolve(process.cwd(), "src/components/conversation-sidebar.tsx"), "utf8");
    const styles = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.module.css"), "utf8");

    expect(source).toContain("WorkspaceShell");
    expect(source).toContain("ConversationSidebar");
    expect(shell).toContain("Drawer");
    expect(sidebar).toContain("Conversations");
    expect(styles).toContain("grid-template-columns");
    expect(styles).toMatch(/@media\s*\(max-width:/);
    expect(styles).not.toContain("min-width: 1000px");
    expect(source).not.toContain("minWidth: 1000");
    expect(source).not.toContain("gridTemplateColumns");
  });

  it("presents the MVP interface and verification warning in Simplified Chinese", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");
    const sidebar = await readFile(resolve(process.cwd(), "src/components/conversation-sidebar.tsx"), "utf8");
    const composer = await readFile(resolve(process.cwd(), "src/components/analysis-composer.tsx"), "utf8");

    expect(sidebar).toContain("电气图纸 AI");
    expect(composer).toContain("上传 DWG 或 DXF 图纸");
    expect(sidebar).toContain("初步识别结果必须由电气工程师复核");
    expect(source).toContain("元件清单");
    expect(source).not.toContain("Electrical Drawing AI");
  });

  it("keeps the attachment panel inside the Sender header slot", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/analysis-composer.tsx"), "utf8");

    expect(source).toContain("<Sender.Header open={attachments.length > 0}");
    expect(source).toContain("Suggestion");
    expect(source).toContain("Sender.Switch");
  });

  it("offers the complete component analysis as an Excel download", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");
    const inspector = await readFile(resolve(process.cwd(), "src/components/result-inspectors.tsx"), "utf8");

    expect(inspector).toContain("导出 Excel");
    expect(source).toContain("元件分析清单.xlsx");
    expect(source).not.toContain("初步-BOM.csv");
  });

  it("distinguishes symbol occurrences from physical devices and keeps limited coverage visible", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");
    const messages = await readFile(resolve(process.cwd(), "src/components/workspace-model.ts"), "utf8");
    const inspector = await readFile(resolve(process.cwd(), "src/components/result-inspectors.tsx"), "utf8");

    expect(inspector).toContain("符号实例");
    expect(inspector).toContain("物理设备");
    expect(messages).toContain("扫描区域受限，结果可能不完整");
    expect(inspector).toContain("physicalDevices");
  });

  it("integrates the split message, composer and inspector components", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");

    for (const component of ["DrawingMessageList", "AnalysisComposer", "WorkspaceInspector"]) expect(source).toContain(component);
    expect(source).not.toContain("function WorkspaceResult");
    expect(source).not.toMatch(/style=\{\{/);
  });

  it("routes unmatched natural-language questions to the drawing evidence API", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");

    expect(source).toContain("`/api/conversations/${conversationId}/query`");
    expect(source).toContain("question: finalText");
    expect(source).toContain("data.answer?.intent === \"bom\"");
    expect(source).toContain("data.answer?.intent === \"review\"");
    expect(source).not.toContain("当前演示版支持筛选元件、选择标签、修改分类、移除元件、生成 BOM 和导出结果");
  });
});
