"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Attachments, Bubble, Prompts, Sender, Welcome } from "@ant-design/x";
import type { ConversationItemType } from "@ant-design/x";
import { useXConversations } from "@ant-design/x-sdk";
import {
  CloudUploadOutlined,
  FileSearchOutlined,
  MoreOutlined,
  PaperClipOutlined,
  SafetyCertificateOutlined,
  ShareAltOutlined,
  TableOutlined,
} from "@ant-design/icons";
import { Button, Flex } from "antd";
import { parseDrawingCommand } from "@/lib/chat/commands";
import type { ComponentCategory } from "@/lib/domain";
import { COMPONENT_CATEGORY_LABELS } from "@/lib/presentation/component-list";
import ConversationSidebar from "./conversation-sidebar";
import DrawingMessageList from "./drawing-message-list";
import WorkspaceShell from "./workspace-shell";
import type { AttachmentItem, Conversation, MessageRecord } from "./workspace-types";
import styles from "./drawing-workspace.module.css";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const senderCommands: Record<string, string> = {
  analyze: "分析这张图纸，并按类别列出所有可识别的电气元件。",
  filter: "筛选接触器",
  review: "显示需要工程师复核的项目",
  bom: "生成初步 BOM",
  export: "导出 BOM",
};

export default function DrawingWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [snapshot, setSnapshot] = useState<Conversation | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [loading, setLoading] = useState(false);
  const [senderValue, setSenderValue] = useState("");
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [senderMounted, setSenderMounted] = useState(false);
  const xConversations = useXConversations({ defaultConversations: [] });
  const xConversationsRef = useRef(xConversations);

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/drawing-conversations", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { conversations: Conversation[] };
    const list = data.conversations ?? [];
    setConversations(list);
    xConversationsRef.current.setConversations(list.map((item) => ({ key: item.id, title: item.title })));
  }, []);

  const loadActive = useCallback(async (id: string) => {
    if (!id) return;
    const [conversationResponse, messagesResponse] = await Promise.all([
      fetch(`/api/drawing-conversations/${id}`, { cache: "no-store" }),
      fetch(`/api/conversations/${id}/messages`, { cache: "no-store" }),
    ]);
    if (conversationResponse.ok) setSnapshot(((await conversationResponse.json()) as { conversation: Conversation }).conversation);
    if (messagesResponse.ok) setMessages(((await messagesResponse.json()) as { messages: MessageRecord[] }).messages);
  }, []);

  useEffect(() => { queueMicrotask(() => void loadConversations()); }, [loadConversations]);
  useEffect(() => { queueMicrotask(() => setSenderMounted(true)); }, []);
  useEffect(() => { if (activeId) queueMicrotask(() => void loadActive(activeId)); }, [activeId, loadActive]);
  useEffect(() => {
    const job = snapshot?.drawing?.analysisJob;
    if (!snapshot?.drawing?.id || !job || !["queued", "converting", "analyzing"].includes(job.status)) return;
    const interval = window.setInterval(() => { void loadActive(activeId); }, 700);
    return () => window.clearInterval(interval);
  }, [activeId, loadActive, snapshot?.drawing?.analysisJob, snapshot?.drawing?.id]);

  const activeDrawing = snapshot?.drawing ?? null;
  const activeComponents = useMemo(() => (activeDrawing?.components ?? []).filter((component) => !component.removedAt), [activeDrawing?.components]);
  const reviewComponents = useMemo(() => activeComponents.filter((component) => component.reviewStatus !== "confirmed" || component.category === "unknown"), [activeComponents]);
  const latestProgressId = [...messages].reverse().find((message) => message.type === "analysis_progress")?.id;
  const visibleMessages = messages.filter((message) => message.type !== "analysis_progress" || message.id === latestProgressId);

  const conversationItems: ConversationItemType[] = conversations.map((conversation) => ({
    key: conversation.id,
    label: conversation.drawing?.originalFilename ? `${conversation.title} · ${conversation.drawing.originalFilename}` : conversation.title,
    group: "今天",
  }));

  async function newConversation() {
    const response = await fetch("/api/drawing-conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!response.ok) throw new Error("无法创建新分析会话。");
    const data = (await response.json()) as { conversation: Conversation };
    await loadConversations();
    setActiveId(data.conversation.id);
    setSnapshot(data.conversation);
    setMessages([]);
    return data.conversation.id;
  }

  async function refresh(conversationId = activeId) {
    await loadConversations();
    if (conversationId) await loadActive(conversationId);
  }

  async function appendText(text: string, role: "user" | "assistant" = "user", conversationId = activeId) {
    if (!conversationId || !text.trim()) return;
    await fetch(`/api/conversations/${conversationId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "text", role, payload: { text } }) });
  }

  function selectAttachment(file: File) {
    setAttachmentError("");
    if (!/\.(dwg|dxf)$/i.test(file.name)) {
      setSelectedFile(null);
      setAttachmentError("不支持此文件类型。请选择 DWG 或 DXF 图纸。");
      return false;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setSelectedFile(null);
      setAttachmentError("文件超过当前 25 MB 上传限制。");
      return false;
    }
    setSelectedFile(file);
    return false;
  }

  function clearAttachment() {
    setSelectedFile(null);
    setAttachmentError("");
  }

  async function uploadIfNeeded(conversationId: string) {
    if (!selectedFile) return { drawingId: activeDrawing?.id ?? null, uploaded: false };
    const form = new FormData();
    form.set("conversationId", conversationId);
    form.set("file", selectedFile);
    const response = await fetch("/api/drawings/upload", { method: "POST", body: form });
    const data = (await response.json()) as { drawingId?: string; message?: string };
    if (!response.ok || !data.drawingId) throw new Error(data.message ?? "图纸上传失败，请重试。");
    clearAttachment();
    setAttachmentsOpen(false);
    return { drawingId: data.drawingId, uploaded: true };
  }

  async function regenerateBom(drawingId: string) {
    await fetch(`/api/drawings/${drawingId}/bom`, { method: "POST" });
  }

  async function downloadBom(drawingId: string) {
    const response = await fetch(`/api/drawings/${drawingId}/exports`, { method: "POST" });
    if (!response.ok) {
      await appendText("Excel 元件清单导出失败，请稍后重试。", "assistant");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "元件分析清单.xlsx";
    anchor.click();
    URL.revokeObjectURL(url);
    await refresh();
  }

  async function handleCommand(text: string, drawingId: string) {
    const command = parseDrawingCommand(text);
    if (!command) return false;
    if (command.type === "filter_components") {
      const count = activeComponents.filter((component) => component.category === command.category).length;
      await appendText(`已筛选“${COMPONENT_CATEGORY_LABELS[command.category]}”，共找到 ${count} 个。`, "assistant");
      return true;
    }
    if (command.type === "select_component") {
      const component = activeComponents.find((item) => item.tag?.toLowerCase() === command.tag.toLowerCase());
      if (component) {
        await appendText(`已选择 ${command.tag}。当前分类：${COMPONENT_CATEGORY_LABELS[component.category as ComponentCategory] ?? component.category}；置信度：${Math.round(component.confidence * 100)}%。`, "assistant");
      } else await appendText(`未在当前图纸中找到 ${command.tag}。`, "assistant");
      return true;
    }
    if (command.type === "update_component") {
      const component = activeComponents.find((item) => item.tag?.toLowerCase() === command.tag.toLowerCase());
      if (component) {
        await fetch(`/api/drawings/${drawingId}/components`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ componentId: component.id, category: command.category, reviewStatus: "confirmed" }) });
        await regenerateBom(drawingId);
        await appendText(`已将 ${command.tag} 修改为“${COMPONENT_CATEGORY_LABELS[command.category]}”，并标记为工程师确认。`, "assistant");
      } else await appendText(`未找到需要修改的 ${command.tag}。`, "assistant");
      return true;
    }
    if (command.type === "delete_component") {
      const component = activeComponents.find((item) => item.temporaryId === command.temporaryId);
      if (component) {
        await fetch(`/api/drawings/${drawingId}/components`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ componentId: component.id }) });
        await regenerateBom(drawingId);
        await appendText(`已移除 ${component.tag ?? command.temporaryId}，初步 BOM 已同步更新。`, "assistant");
      } else await appendText(`未找到 ${command.temporaryId}。`, "assistant");
      return true;
    }
    if (command.type === "generate_bom") {
      await regenerateBom(drawingId);
      await appendText("已根据当前有效元件重新生成初步 BOM。所有采购信息仍需工程师确认。", "assistant");
      return true;
    }
    if (command.type === "export_bom") {
      await downloadBom(drawingId);
      return true;
    }
    await appendText(`当前共 ${reviewComponents.length} 个待复核项目。请在会话结果中逐项确认。`, "assistant");
    return true;
  }

  async function submit(text: string) {
    if (!text.trim() && !selectedFile) return;
    setLoading(true);
    try {
      const conversationId = activeId || await newConversation();
      const upload = await uploadIfNeeded(conversationId);
      const finalText = text.trim() || "分析这张图纸，并按类别列出所有可识别的电气元件。";
      await appendText(finalText, "user", conversationId);
      const drawingId = upload.drawingId ?? activeDrawing?.id;
      if (!drawingId) {
        await appendText("请先上传一份 DWG 或 DXF 图纸，然后再开始分析。", "assistant", conversationId);
      } else {
        const handled = upload.uploaded ? false : await handleCommand(finalText, drawingId);
        if (!handled && (upload.uploaded || /分析|识别|元件|analy[sz]e|identify/i.test(finalText))) {
          await fetch(`/api/drawings/${drawingId}/analyze`, { method: "POST" });
        } else if (!handled) {
          await appendText("当前演示版支持筛选元件、选择标签、修改分类、移除元件、生成 BOM 和导出结果。", "assistant", conversationId);
        }
      }
      await refresh(conversationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "请求未完成，请重试。";
      if (activeId) await appendText(message, "assistant", activeId);
      setAttachmentError(message);
    } finally {
      setLoading(false);
    }
  }

  async function retryAnalysis() {
    if (!activeDrawing) return;
    await fetch(`/api/drawings/${activeDrawing.id}/analyze`, { method: "POST" });
    await refresh();
  }

  async function renameActive() {
    if (!activeId) return;
    const title = window.prompt("重命名分析会话", snapshot?.title ?? "");
    if (!title?.trim()) return;
    await fetch(`/api/drawing-conversations/${activeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim() }) });
    await refresh();
  }

  async function deleteActive() {
    if (!activeId) return;
    await fetch(`/api/drawing-conversations/${activeId}`, { method: "DELETE" });
    setActiveId("");
    setSnapshot(null);
    setMessages([]);
    await loadConversations();
  }

  const startPrompts = [
    { key: "identify", label: "识别全部电气元件", description: senderCommands.analyze },
    { key: "filter", label: "筛选接触器与继电器", description: senderCommands.filter },
    { key: "review", label: "查看待工程师复核项", description: senderCommands.review },
    { key: "bom", label: "根据物理设备生成 BOM", description: senderCommands.bom },
  ];
  const guidePrompts = [{
    key: "guide",
    label: "专业分析指南",
    children: [
      { key: "layers", icon: <FileSearchOutlined />, label: "图层与符号", description: "分析图层并识别符号实例" },
      { key: "devices", icon: <TableOutlined />, label: "物理设备归并", description: "将符号实例归并为物理设备" },
      { key: "review-guide", icon: <SafetyCertificateOutlined />, label: "工程复核", description: senderCommands.review },
    ],
  }];
  const quickPrompts = [{
    key: "quick",
    label: "快速开始",
    children: [
      { key: "upload", icon: <CloudUploadOutlined />, label: "上传 DWG / DXF", description: "上传图纸后开始完整识别" },
      { key: "export", icon: <TableOutlined />, label: "导出元件清单", description: senderCommands.export },
    ],
  }];
  const followupPrompts = [
    { key: "analyze", label: "完整识别", description: senderCommands.analyze },
    { key: "filter", label: "筛选元件", description: senderCommands.filter },
    { key: "review", label: "工程复核", description: senderCommands.review },
    { key: "bom", label: "生成 BOM", description: senderCommands.bom },
  ];
  const attachmentItems: AttachmentItem[] = selectedFile ? [{
    uid: selectedFile.name,
    name: selectedFile.name,
    status: "done",
  }] : [];

  const sidebar = <ConversationSidebar
    items={conversationItems}
    activeKey={activeId}
    onCreate={() => void newConversation()}
    onActiveChange={(key) => {
      setActiveId(key);
      xConversationsRef.current.setActiveConversationKey(key);
    }}
    onRename={() => void renameActive()}
    onDelete={() => { if (window.confirm("确定删除此分析会话吗？")) void deleteActive(); }}
  />;

  const submitPrompt = (description?: unknown, key?: string | number) => {
    if (key === "upload") {
      setAttachmentsOpen(true);
      return;
    }
    if (typeof description === "string") void submit(description);
  };

  const senderHeader = (
    <Sender.Header
      title="上传电气图纸"
      open={attachmentsOpen}
      onOpenChange={setAttachmentsOpen}
      styles={{ content: { padding: 0 } }}
    >
      <Attachments
        accept=".dwg,.dxf"
        maxCount={1}
        items={attachmentItems}
        beforeUpload={(file) => selectAttachment(file)}
        onRemove={() => { clearAttachment(); return true; }}
        placeholder={(type) => type === "drop"
          ? { title: "将 DWG 或 DXF 图纸拖到这里" }
          : { icon: <CloudUploadOutlined />, title: "选择或拖入图纸", description: "支持 DWG 和 ASCII DXF，最大 25 MB" }}
      />
    </Sender.Header>
  );

  return (
    <WorkspaceShell sidebar={sidebar}>
      <div className={styles.centerWorkspace}>
        <div className={styles.chatScroll}>
          <div className={styles.chatContent}>
            {!visibleMessages.length ? (
              <div className={styles.emptyWorkspace}>
                <Welcome
                  variant="borderless"
                  icon={<Button type="primary" shape="circle" size="large" icon={<FileSearchOutlined />} />}
                  title="欢迎使用 电气图纸 AI"
                  description="基于 Ant Design X 的 AutoCAD 智能分析工作台，所有 AI 结果需要工程师确认。"
                  extra={<Flex gap={8}><Button size="small" icon={<ShareAltOutlined />} /><Button size="small" icon={<MoreOutlined />} /></Flex>}
                />
                <div className={styles.welcomeGrid}>
                  <Prompts title="热门任务" items={startPrompts} vertical onItemClick={({ data }) => submitPrompt(data.description, data.key)} styles={{ item: { border: 0, background: "#f5f7ff" } }} />
                  <Prompts items={guidePrompts} vertical onItemClick={({ data }) => submitPrompt(data.description, data.key)} styles={{ item: { border: 0, background: "#f8f5ff" }, subItem: { background: "#fff" } }} />
                  <Prompts items={quickPrompts} vertical onItemClick={({ data }) => submitPrompt(data.description, data.key)} styles={{ item: { border: 0, background: "#f3f7ff" }, subItem: { background: "#fff" } }} />
                </div>
              </div>
            ) : (
              <DrawingMessageList messages={visibleMessages} onRetry={() => void retryAnalysis()} onExport={() => { if (activeDrawing) void downloadBom(activeDrawing.id); }} />
            )}
          </div>
        </div>

        <footer className={styles.composerDock}>
          {!attachmentsOpen ? <Prompts className={styles.followupPrompts} items={followupPrompts} onItemClick={({ data }) => submitPrompt(data.description, data.key)} styles={{ item: { padding: "5px 12px" } }} /> : null}
          {attachmentError ? <Bubble.System variant="outlined" content={`附件错误：${attachmentError}`} /> : null}
          {senderMounted ? <Sender
            loading={loading}
            value={senderValue}
            header={senderHeader}
            prefix={<Button type="text" icon={<PaperClipOutlined />} aria-label="上传 DWG 或 DXF 图纸" onClick={() => setAttachmentsOpen((open) => !open)} />}
            allowSpeech
            autoSize={{ minRows: 1, maxRows: 4 }}
            classNames={{ input: styles.senderInput }}
            placeholder={activeDrawing ? "询问图纸、筛选元件或修改识别结果" : "上传 DWG 或 DXF 图纸，或输入分析要求"}
            onChange={setSenderValue}
            onPasteFile={(files) => { const file = files.item(0); if (file) selectAttachment(file); }}
            onSubmit={(text) => { if (!text.trim() && !selectedFile) return; setSenderValue(""); void submit(text); }}
            onCancel={() => { setLoading(false); if (activeId) void appendText("已停止等待当前响应；已提交的后台分析任务仍会继续。", "assistant"); }}
          /> : <div className={styles.senderPlaceholder} aria-hidden="true" />}
        </footer>
      </div>
    </WorkspaceShell>
  );
}
