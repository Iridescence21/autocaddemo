import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageRecord } from "./workspace-types";
import { createLatestRequestGuard, refreshMessagesAfterTerminal } from "./workspace-model";

afterEach(() => vi.restoreAllMocks());

describe("Ant Design X Chinese drawing workspace", () => {
  it("uses the official responsive two-column independent layout", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");
    const shell = await readFile(resolve(process.cwd(), "src/components/workspace-shell.tsx"), "utf8");
    const sidebar = await readFile(resolve(process.cwd(), "src/components/conversation-sidebar.tsx"), "utf8");
    const styles = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.module.css"), "utf8");

    expect(source).toContain("WorkspaceShell");
    expect(source).toContain("ConversationSidebar");
    expect(shell).toContain("Drawer");
    expect(sidebar).toContain("Conversations");
    expect(sidebar).toContain("groupable");
    expect(styles).toContain("grid-template-columns: 280px minmax(0, 1fr)");
    expect(styles).toMatch(/@media\s*\(max-width:/);
    expect(styles).not.toContain("min-width: 1000px");
    expect(source).not.toContain("minWidth: 1000");
    expect(source).not.toContain("gridTemplateColumns");
  });

  it("presents the MVP interface and verification warning in Simplified Chinese", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");
    const sidebar = await readFile(resolve(process.cwd(), "src/components/conversation-sidebar.tsx"), "utf8");

    expect(sidebar).toContain("电气图纸 AI");
    expect(source).toContain("上传 DWG 或 DXF 图纸");
    expect(source).toContain("所有 AI 结果需要工程师确认");
    expect(source).toContain("元件清单");
    expect(source).not.toContain("Electrical Drawing AI");
  });

  it("uses the official independent-demo Sender and attachment header", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");
    const styles = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.module.css"), "utf8");

    expect(source).toContain("Attachments, Bubble, Prompts, Sender, Welcome");
    expect(source).toContain("<Sender.Header");
    expect(source).toContain("allowSpeech");
    expect(source).toContain("prefix={");
    expect(source).toContain("<Welcome");
    expect(source).toContain("<Prompts");
    expect(source).not.toContain("AnalysisComposer");
    expect(source).not.toContain("Sender.Switch");
    expect(styles).not.toMatch(/\.composer\s*\{/);
    expect(styles).not.toContain(".composerFooter");
  });

  it("keeps the official Sender compact and moves keyboard focus to its outer frame", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");
    const styles = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.module.css"), "utf8");

    expect(source).toContain("autoSize={{ minRows: 1, maxRows: 4 }}");
    expect(source).toContain("classNames={{ input: styles.senderInput }}");
    expect(styles).toContain(".senderInput:focus-visible");
    expect(styles).toContain(":global(.ant-sender):has(.senderInput:focus-visible)");
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

  it("keeps results in the message stream without an inspector rail", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");
    const shell = await readFile(resolve(process.cwd(), "src/components/workspace-shell.tsx"), "utf8");

    for (const component of ["DrawingMessageList", "Sender"]) expect(source).toContain(component);
    expect(source).not.toContain("WorkspaceInspector");
    expect(source).not.toContain("inspector=");
    expect(shell).not.toContain("rightOpen");
    expect(source).not.toContain("function WorkspaceResult");
  });

  it("routes unmatched natural-language questions to the drawing evidence API", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");

    expect(source).toContain("`/api/conversations/${conversationId}/query`");
    expect(source).toContain("question: finalText");
    expect(source).not.toContain("当前演示版支持筛选元件、选择标签、修改分类、移除元件、生成 BOM 和导出结果");
  });

  it("refreshes messages after terminal job detection so stale progress is not retained", async () => {
    const staleProgress: MessageRecord = { id: "stale", type: "analysis_progress", role: "assistant", payload: { status: "analyzing", progress: 92 }, createdAt: "2026-07-15T00:00:00.000Z" };
    const terminalProgress: MessageRecord = { id: "terminal", type: "analysis_progress", role: "assistant", payload: { status: "completed", progress: 100 }, createdAt: "2026-07-15T00:00:01.000Z" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messages: [terminalProgress] }), { status: 200 }));

    await expect(refreshMessagesAfterTerminal("conversation-1", "completed", [staleProgress])).resolves.toEqual([terminalProgress]);
    expect(fetchMock).toHaveBeenCalledWith("/api/conversations/conversation-1/messages", { cache: "no-store" });
  });

  it("retains current messages when the bounded terminal refresh fails", async () => {
    const currentMessages: MessageRecord[] = [{ id: "stale", type: "analysis_progress", role: "assistant", payload: { status: "analyzing", progress: 92 }, createdAt: "2026-07-15T00:00:00.000Z" }];
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unavailable"));

    await expect(refreshMessagesAfterTerminal("conversation-1", "failed", currentMessages)).resolves.toBe(currentMessages);
  });

  it("prevents an older load token from applying after a newer load starts", () => {
    const guard = createLatestRequestGuard();
    const older = guard.next();
    const newer = guard.next();

    expect(guard.isCurrent(older)).toBe(false);
    expect(guard.isCurrent(newer)).toBe(true);
  });

  it("guards active-load state writes with the latest request token", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");

    expect(source).toContain("loadRequestGuard");
    expect(source).toContain("const requestToken = loadRequestGuard.current.next()");
    expect(source).toContain("if (!loadRequestGuard.current.isCurrent(requestToken)) return;");
  });
});
