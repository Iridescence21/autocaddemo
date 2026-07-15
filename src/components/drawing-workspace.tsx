"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Prompts, Welcome } from "@ant-design/x";
import type { ConversationItemType } from "@ant-design/x";
import { useXConversations } from "@ant-design/x-sdk";
import { CloudUploadOutlined, FileSearchOutlined, SafetyCertificateOutlined, TableOutlined } from "@ant-design/icons";
import { Tag } from "antd";
import { parseDrawingCommand } from "@/lib/chat/commands";
import { COMPONENT_CATEGORIES, type ComponentCategory } from "@/lib/domain";
import { COMPONENT_CATEGORY_LABELS } from "@/lib/presentation/component-list";
import AnalysisComposer from "./analysis-composer";
import ConversationSidebar from "./conversation-sidebar";
import DrawingMessageList from "./drawing-message-list";
import WorkspaceInspector from "./workspace-inspector";
import WorkspaceShell from "./workspace-shell";
import type { AttachmentItem, Conversation, DrawingComponent, InspectorView, MessageRecord } from "./workspace-types";
import styles from "./drawing-workspace.module.css";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export default function DrawingWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [snapshot, setSnapshot] = useState<Conversation | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [selectedComponent, setSelectedComponent] = useState<DrawingComponent | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inspectorView, setInspectorView] = useState<InspectorView>("drawing");
  const xConversations = useXConversations({ defaultConversations: [] });
  const xConversationsRef = useRef(xConversations);
  const initializedRef = useRef(false);

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/drawing-conversations", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { conversations: Conversation[] };
    const list = data.conversations ?? [];
    setConversations(list);
    xConversationsRef.current.setConversations(list.map((item) => ({ key: item.id, title: item.title })));
    if (!initializedRef.current && list[0]) {
      initializedRef.current = true;
      setActiveId(list[0].id);
    }
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
  useEffect(() => { if (activeId) queueMicrotask(() => void loadActive(activeId)); }, [activeId, loadActive]);
  useEffect(() => {
    const job = snapshot?.drawing?.analysisJob;
    if (!snapshot?.drawing?.id || !job || !["queued", "converting", "analyzing"].includes(job.status)) return;
    const interval = window.setInterval(() => { void loadActive(activeId); }, 700);
    return () => window.clearInterval(interval);
  }, [activeId, loadActive, snapshot?.drawing?.analysisJob, snapshot?.drawing?.id]);

  const activeDrawing = snapshot?.drawing ?? null;
  const activeComponents = useMemo(() => (activeDrawing?.components ?? []).filter((component) => !component.removedAt), [activeDrawing?.components]);
  const visibleComponents = useMemo(() => activeComponents.filter((component) => !filterCategory || component.category === filterCategory), [activeComponents, filterCategory]);
  const reviewComponents = useMemo(() => activeComponents.filter((component) => component.reviewStatus !== "confirmed" || component.category === "unknown"), [activeComponents]);
  const latestProgressId = [...messages].reverse().find((message) => message.type === "analysis_progress")?.id;
  const visibleMessages = messages.filter((message) => message.type !== "analysis_progress" || message.id === latestProgressId);
  const isProcessing = Boolean(activeDrawing?.analysisJob && ["queued", "converting", "analyzing"].includes(activeDrawing.analysisJob.status));

  const conversationItems: ConversationItemType[] = conversations.map((conversation) => ({
    key: conversation.id,
    label: conversation.drawing?.originalFilename ? `${conversation.title} · ${conversation.drawing.originalFilename}` : conversation.title,
  }));

  async function newConversation() {
    const response = await fetch("/api/drawing-conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!response.ok) throw new Error("无法创建新分析会话。");
    const data = (await response.json()) as { conversation: Conversation };
    await loadConversations();
    setActiveId(data.conversation.id);
    setSnapshot(data.conversation);
    setMessages([]);
    setInspectorView("drawing");
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

  function selectAttachment(file: File, uid = "local") {
    setAttachmentError("");
    if (!/\.(dwg|dxf)$/i.test(file.name)) {
      setSelectedFile(null);
      setAttachments([{ uid, name: file.name, status: "error", response: "仅支持 DWG 或 DXF 文件" }]);
      setAttachmentError("不支持此文件类型。请选择 DWG 或 DXF 图纸。");
      return false;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setSelectedFile(null);
      setAttachments([{ uid, name: file.name, status: "error", response: "文件超过 25 MB" }]);
      setAttachmentError("文件超过当前 25 MB 上传限制。");
      return false;
    }
    setSelectedFile(file);
    setAttachments([{ uid, name: file.name, status: "done" }]);
    return false;
  }

  function clearAttachment() {
    setSelectedFile(null);
    setAttachments([]);
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
    setInspectorView("files");
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
      setFilterCategory(command.category);
      setInspectorView("components");
      const count = activeComponents.filter((component) => component.category === command.category).length;
      await appendText(`已筛选“${COMPONENT_CATEGORY_LABELS[command.category]}”，共找到 ${count} 个。`, "assistant");
      return true;
    }
    if (command.type === "select_component") {
      const component = activeComponents.find((item) => item.tag?.toLowerCase() === command.tag.toLowerCase());
      if (component) {
        setSelectedComponent(component);
        setInspectorView("components");
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
      setInspectorView("bom");
      return true;
    }
    if (command.type === "export_bom") {
      await downloadBom(drawingId);
      return true;
    }
    setFilterCategory(null);
    setInspectorView("review");
    await appendText(`已打开复核清单，共 ${reviewComponents.length} 个项目。`, "assistant");
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
          const response = await fetch(`/api/conversations/${conversationId}/query`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: finalText }),
          });
          const data = (await response.json()) as { message?: string };
          if (!response.ok) throw new Error(data.message ?? "图纸问询未完成，请重试。");
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

  async function updateSelected(data: { category?: string; reviewStatus?: string }) {
    if (!activeDrawing || !selectedComponent) return;
    await fetch(`/api/drawings/${activeDrawing.id}/components`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ componentId: selectedComponent.id, ...data }) });
    await regenerateBom(activeDrawing.id);
    await appendText(`已更新 ${selectedComponent.tag ?? selectedComponent.temporaryId}，并重新生成初步 BOM。`, "assistant");
    await refresh();
  }

  async function editSelectedCategory() {
    if (!selectedComponent) return;
    const category = window.prompt(`输入新的类别：\n${COMPONENT_CATEGORIES.join("\n")}`, selectedComponent.category)?.trim() as ComponentCategory | undefined;
    if (!category || !COMPONENT_CATEGORIES.includes(category)) {
      if (category) setAttachmentError("类别无效，请从受控类别列表中选择。");
      return;
    }
    await updateSelected({ category, reviewStatus: "confirmed" });
  }

  async function removeSelected() {
    if (!activeDrawing || !selectedComponent || !window.confirm(`确定移除 ${selectedComponent.tag ?? selectedComponent.temporaryId} 吗？`)) return;
    await fetch(`/api/drawings/${activeDrawing.id}/components`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ componentId: selectedComponent.id }) });
    await regenerateBom(activeDrawing.id);
    await appendText(`已移除 ${selectedComponent.tag ?? selectedComponent.temporaryId}，初步 BOM 已更新。`, "assistant");
    setSelectedComponent(null);
    await refresh();
  }

  const startPrompts = [
    { key: "upload", icon: <CloudUploadOutlined />, label: "上传并分析图纸", description: "支持 DWG 和 ASCII DXF" },
    { key: "identify", icon: <FileSearchOutlined />, label: "识别全部电气元件", description: "输出符号与物理设备" },
    { key: "bom", icon: <TableOutlined />, label: "生成初步 BOM", description: "不猜测未显示的产品信息" },
    { key: "review", icon: <SafetyCertificateOutlined />, label: "查看复核规则", description: "所有 AI 结果需要确认" },
  ];
  const followupPrompts = [
    { key: "components", label: "符号清单", description: `${activeComponents.length} 个符号实例` },
    { key: "review", label: "复核项目", description: `${reviewComponents.length} 个待确认项目` },
    { key: "bom", label: "初步 BOM", description: `${activeDrawing?.bomItems.length ?? 0} 个采购分组` },
    { key: "files", label: "会话文件", description: "原图、分析产物和导出" },
  ];

  const sidebar = <ConversationSidebar
    items={conversationItems}
    activeKey={activeId}
    onCreate={() => void newConversation()}
    onActiveChange={(key) => {
      setActiveId(key);
      setSelectedComponent(null);
      setFilterCategory(null);
      setInspectorView("drawing");
      xConversationsRef.current.setActiveConversationKey(key);
    }}
    onRename={() => void renameActive()}
    onDelete={() => { if (window.confirm("确定删除此分析会话吗？")) void deleteActive(); }}
  />;

  const inspector = <WorkspaceInspector
    activeView={inspectorView}
    drawing={activeDrawing}
    messages={messages}
    components={visibleComponents}
    reviewComponents={reviewComponents}
    selected={selectedComponent}
    onViewChange={(view) => { setInspectorView(view); if (view !== "components") setFilterCategory(null); }}
    onSelect={setSelectedComponent}
    onConfirm={() => void updateSelected({ reviewStatus: "confirmed" })}
    onEdit={() => void editSelectedCategory()}
    onRemove={() => void removeSelected()}
    onRegenerate={() => { if (activeDrawing) void regenerateBom(activeDrawing.id).then(() => refresh()); }}
    onExport={() => { if (activeDrawing) void downloadBom(activeDrawing.id); }}
  />;

  return (
    <WorkspaceShell sidebar={sidebar} inspector={inspector}>
      <div className={styles.centerWorkspace}>
        <header className={styles.centerHeader}>
          <div>
            <h2>{snapshot?.title ?? "新的图纸分析"}</h2>
            <p>{activeDrawing ? activeDrawing.originalFilename : "上传图纸并用自然语言开始工程分析"}</p>
          </div>
          <Tag color={isProcessing ? "processing" : activeDrawing ? "success" : "default"}>
            {isProcessing ? activeDrawing?.analysisJob?.stage : activeDrawing ? "会话就绪" : "等待图纸"}
          </Tag>
        </header>

        <div className={styles.chatScroll}>
          <div className={styles.chatContent}>
            {!visibleMessages.length ? (
              <div className={styles.emptyWorkspace}>
                <Welcome
                  variant="borderless"
                  title="上传图纸，开始专业分析"
                  description="AI 将整理符号实例、物理设备、工程复核项和初步 BOM；图纸中未显示的信息不会被猜测。"
                />
                <Prompts title="可以这样开始" wrap items={startPrompts} onItemClick={({ data }) => {
                  if (data.key === "upload") return;
                  void submit(data.key === "identify" ? "分析这张图纸，并按类别列出所有可识别的电气元件。" : data.key === "bom" ? "生成初步 BOM" : "显示需要工程师复核的项目");
                }} />
              </div>
            ) : (
              <DrawingMessageList messages={visibleMessages} onOpenInspector={setInspectorView} onRetry={() => void retryAnalysis()} />
            )}
          </div>
        </div>

        <footer className={styles.composerDock}>
          {activeDrawing ? <Prompts className={styles.followupPrompts} wrap items={followupPrompts} onItemClick={({ data }) => { setFilterCategory(null); setInspectorView(data.key as InspectorView); }} /> : null}
          <AnalysisComposer
            attachments={attachments}
            attachmentError={attachmentError}
            loading={loading}
            hasDrawing={Boolean(activeDrawing)}
            onSelectFile={selectAttachment}
            onRemoveFile={clearAttachment}
            onSubmit={(text) => void submit(text)}
            onCancel={() => { setLoading(false); if (activeId) void appendText("已停止等待当前响应；已提交的后台分析任务仍会继续。", "assistant"); }}
          />
        </footer>
      </div>
    </WorkspaceShell>
  );
}
