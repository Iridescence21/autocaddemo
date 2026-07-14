"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Actions, Attachments, Bubble, Conversations, FileCard, Prompts, Sender, ThoughtChain, Welcome } from "@ant-design/x";
import type { AttachmentsProps, BubbleItemType, ConversationItemType } from "@ant-design/x";
import { useXConversations } from "@ant-design/x-sdk";
import { XMarkdown } from "@ant-design/x-markdown";
import { DeleteOutlined, EditOutlined, ExportOutlined, EyeOutlined, PaperClipOutlined, ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { parseDrawingCommand } from "@/lib/chat/commands";
import { COMPONENT_CATEGORIES, type ComponentCategory } from "@/lib/domain";
import { COMPONENT_CATEGORY_LABELS, formatCategorizedComponents } from "@/lib/presentation/component-list";

type Component = {
  id: string;
  temporaryId: string;
  category: string;
  tag: string | null;
  description: string;
  specifications: unknown;
  manufacturer: string | null;
  modelNumber: string | null;
  confidence: number;
  evidence: unknown;
  method: string;
  reviewStatus: string;
  location: unknown;
  removedAt: string | null;
};

type BomItem = {
  id: string;
  itemNumber: number;
  category: string;
  description: string;
  manufacturer: string | null;
  modelNumber: string | null;
  specifications: unknown;
  quantity: number;
  confidence: number;
  reviewStatus: string;
};

type Drawing = {
  id: string;
  originalFilename: string;
  sourceType: string;
  byteSize: number;
  status: string;
  previewImageUrl?: string | null;
  previewWidth?: number | null;
  previewHeight?: number | null;
  analysisJob?: { id: string; status: string; progress: number; stage: string; errorMessage?: string | null } | null;
  components: Component[];
  bomItems: BomItem[];
};

type Conversation = { id: string; title: string; status: string; updatedAt?: string; drawing?: Drawing | null };
type MessageRecord = { id: string; type: string; role: string; payload: unknown; createdAt: string };
type AttachmentItem = NonNullable<AttachmentsProps["items"]>[number];
type ResultView = "drawing" | "components" | "bom" | "review";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function messagePayload(message: MessageRecord) {
  return (message.payload ?? {}) as Record<string, unknown>;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function visibleValue(value: string | null | undefined) {
  return value?.trim() || "图纸中未显示";
}

function specifications(value: unknown) {
  const items = stringArray(value);
  return items.length ? items.join("；") : "图纸中未显示";
}

function messageToBubble(item: MessageRecord, progressComplete = false): BubbleItemType {
  const data = messagePayload(item);
  let content: React.ReactNode = null;
  if (item.type === "text") content = <XMarkdown content={String(data.text ?? "")} />;
  if (item.type === "file") {
    content = <FileCard name={String(data.filename ?? "drawing.cad")} byte={Number(data.byteSize ?? 0)} type="file" description={`${String(data.sourceType ?? "CAD").toUpperCase()} · 文件已接收`} />;
  }
  if (item.type === "analysis_progress") {
    const progress = Number(data.progress ?? 0);
    content = <ThoughtChain items={[{
      key: "progress",
      title: String(data.stage ?? "正在处理"),
      description: progressComplete ? "此阶段已完成" : `完成度 ${progress}%`,
      status: data.status === "failed" ? "error" : progressComplete || progress === 100 ? "success" : "loading",
      blink: !progressComplete && progress < 100,
    }]} />;
  }
  if (item.type === "drawing_summary") {
    const warnings = stringArray(data.warnings);
    content = <XMarkdown content={`### 图纸概览\n\n${String(data.summary ?? "暂时无法生成图纸概览。")}\n\n> ${warnings.length ? warnings.join("；") : "初步识别结果必须由电气工程师复核。"}`} />;
  }
  if (item.type === "component_results") {
    const markdown = typeof data.markdown === "string" ? data.markdown : `### 元件识别结果\n\n共识别 **${String(data.total ?? 0)}** 个元件；**${String(data.requiresReview ?? 0)}** 个需要复核；**${String(data.unknown ?? 0)}** 个未知。`;
    content = <XMarkdown content={markdown} />;
  }
  if (item.type === "bom_results") {
    content = <XMarkdown content={`### 初步 BOM 已生成\n\n共 **${String(data.itemCount ?? 0)}** 个采购分组，合计数量 **${String(data.totalQuantity ?? 0)}**。\n\n图纸中未显示的制造商和型号不会被猜测。`} />;
  }
  if (item.type === "export") content = <XMarkdown content={`### 导出完成\n\n文件 **${String(data.filename ?? "元件分析清单.xlsx")}** 已生成。`} />;
  if (item.type === "error") content = <XMarkdown content={`### 分析失败\n\n${String(data.message ?? "处理未完成，请重试。")}\n\n可修正配置或文件后重新分析。`} />;
  if (item.type === "review_request") content = <XMarkdown content={`### 需要工程师复核\n\n${Array.isArray(data.componentIds) ? data.componentIds.length : 0} 个元件等待确认。`} />;
  return { key: item.id, role: item.role === "user" ? "user" : "ai", content, status: item.type === "error" ? "error" : "success" };
}

function bomMarkdown(items: BomItem[]) {
  if (!items.length) return "### 初步 BOM\n\n尚未生成采购清单。分析完成后可在这里生成 BOM。";
  const rows = items.map((item) => `| ${item.itemNumber} | ${COMPONENT_CATEGORY_LABELS[item.category as ComponentCategory] ?? item.category} | ${item.description} | ${visibleValue(item.manufacturer)} | ${visibleValue(item.modelNumber)} | ${specifications(item.specifications)} | ${item.quantity} | ${Math.round(item.confidence * 100)}% | ${item.reviewStatus === "confirmed" ? "已确认" : "需要复核"} |`);
  return `### 初步采购 BOM\n\n> 所有采购信息必须由电气工程师确认。\n\n| 项次 | 类别 | 描述 | 制造商 | 型号 | 规格 | 数量 | 置信度 | 状态 |\n| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |\n${rows.join("\n")}`;
}

export default function DrawingWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [snapshot, setSnapshot] = useState<Conversation | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [selectedComponent, setSelectedComponent] = useState<Component | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resultView, setResultView] = useState<ResultView>("components");
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

  async function uploadIfNeeded(conversationId: string) {
    if (!selectedFile) return { drawingId: activeDrawing?.id ?? null, uploaded: false };
    const form = new FormData();
    form.set("conversationId", conversationId);
    form.set("file", selectedFile);
    const response = await fetch("/api/drawings/upload", { method: "POST", body: form });
    const data = (await response.json()) as { drawingId?: string; message?: string };
    if (!response.ok || !data.drawingId) throw new Error(data.message ?? "图纸上传失败，请重试。");
    setSelectedFile(null);
    setAttachments([]);
    setAttachmentError("");
    return { drawingId: data.drawingId, uploaded: true };
  }

  async function regenerateBom(drawingId: string) {
    await fetch(`/api/drawings/${drawingId}/bom`, { method: "POST" });
  }

  async function handleCommand(text: string, drawingId: string) {
    const command = parseDrawingCommand(text);
    if (!command) return false;
    if (command.type === "filter_components") {
      setFilterCategory(command.category);
      setResultView("components");
      const count = activeComponents.filter((component) => component.category === command.category).length;
      await appendText(`已筛选“${COMPONENT_CATEGORY_LABELS[command.category]}”，共找到 ${count} 个。`, "assistant");
      return true;
    }
    if (command.type === "select_component") {
      const component = activeComponents.find((item) => item.tag?.toLowerCase() === command.tag.toLowerCase());
      if (component) {
        setSelectedComponent(component);
        setResultView("components");
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
      setResultView("bom");
      return true;
    }
    if (command.type === "export_bom") {
      await downloadBom(drawingId);
      return true;
    }
    setFilterCategory(null);
    setResultView("review");
    await appendText(`已打开复核清单，共 ${reviewComponents.length} 个项目。`, "assistant");
    return true;
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
    { key: "upload", label: "上传并分析图纸", description: "支持 DWG 演示文件和真实 ASCII DXF" },
    { key: "identify", label: "识别全部电气元件", description: "按类别输出初步元件清单" },
    { key: "bom", label: "生成初步 BOM", description: "不猜测图纸中未显示的产品信息" },
    { key: "review", label: "查看复核规则", description: "所有 AI 结果都需要工程师确认" },
  ];
  const followupPrompts = [
    { key: "components", label: "元件清单", description: `${activeComponents.length} 个有效元件` },
    { key: "review", label: "复核项目", description: `${reviewComponents.length} 个待确认项目` },
    { key: "bom", label: "初步 BOM", description: `${activeDrawing?.bomItems.length ?? 0} 个采购分组` },
    { key: "drawing", label: "图纸预览", description: "查看渲染后的图纸" },
  ];
  const thoughtItems = activeDrawing?.analysisJob ? [{
    key: "job",
    title: activeDrawing.analysisJob.stage,
    description: `完成度 ${activeDrawing.analysisJob.progress}%`,
    status: (activeDrawing.analysisJob.status === "failed" ? "error" : activeDrawing.analysisJob.progress === 100 ? "success" : "loading") as "error" | "success" | "loading",
  }] : [];
  const isProcessing = Boolean(activeDrawing?.analysisJob && ["queued", "converting", "analyzing"].includes(activeDrawing.analysisJob.status));
  const bubbles = messages
    .filter((message) => message.type !== "analysis_progress" || message.id === latestProgressId)
    .map((message) => messageToBubble(message, !isProcessing));

  const attachmentTrigger = <Attachments
    accept=".dwg,.dxf"
    maxCount={1}
    beforeUpload={(file) => selectAttachment(file)}
    onRemove={() => { setSelectedFile(null); setAttachments([]); setAttachmentError(""); }}
  ><PaperClipOutlined aria-label="上传 DWG 或 DXF 图纸" /></Attachments>;
  const attachmentList = <Attachments
    accept=".dwg,.dxf"
    maxCount={1}
    items={attachments}
    overflow="scrollX"
    onRemove={() => { setSelectedFile(null); setAttachments([]); setAttachmentError(""); }}
  />;

  return <main style={{ width: "100%", minWidth: 1000, height: "100dvh", display: "flex", overflow: "hidden", background: "#ffffff" }}>
    <aside style={{ width: 280, height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box", padding: "0 12px", background: "rgba(245,245,245,0.72)" }}>
      <Welcome variant="borderless" title="电气图纸 AI" description="AutoCAD 图纸初步分析工作台" style={{ margin: "18px 0 8px" }} />
      <Conversations
        style={{ flex: 1, overflowY: "auto", marginTop: 12, padding: 0 }}
        creation={{ label: "新建分析", onClick: () => void newConversation() }}
        items={conversationItems}
        activeKey={activeId}
        onActiveChange={(key) => { setActiveId(key); setSelectedComponent(null); setFilterCategory(null); xConversationsRef.current.setActiveConversationKey(key); }}
        menu={() => ({
          items: [{ key: "rename", label: "重命名" }, { key: "delete", label: "删除", danger: true }],
          onClick: ({ key }) => { if (key === "rename") void renameActive(); else if (window.confirm("确定删除此分析会话吗？")) void deleteActive(); },
        })}
      />
      <Welcome variant="borderless" title="演示版提示" description="初步识别结果必须由电气工程师复核" style={{ marginBottom: 8 }} />
    </aside>

    <section style={{ height: "100%", width: "100%", minWidth: 0, display: "flex", flexDirection: "column", boxSizing: "border-box", paddingBlock: 24, gap: 16, background: "#ffffff", color: "#1f1f1f" }}>
      <Welcome
        variant="borderless"
        title={snapshot?.title ?? "新的图纸分析"}
        description={activeDrawing ? `${activeDrawing.originalFilename} · ${activeDrawing.analysisJob?.stage ?? activeDrawing.status}` : "上传 DWG 或 DXF 图纸，然后用自然语言发起分析。"}
        style={{ width: "100%", maxWidth: 700, margin: "0 auto" }}
      />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#ffffff" }}>
        <div style={{ width: "100%", maxWidth: 700, margin: "0 auto", padding: "8px 0 24px" }}>
          {!messages.length ? <>
            <Welcome
              title="上传图纸，开始分析"
              description="AI 将生成按类别整理的元件清单、复核项目和初步 BOM。系统不会猜测图纸中未显示的制造商、型号或规格。"
              style={{ paddingTop: 32 }}
            />
            <Prompts title="可以这样开始" wrap items={startPrompts} onItemClick={({ data }) => {
              if (data.key === "upload") return;
              void submit(data.key === "identify" ? "分析这张图纸，并按类别列出所有可识别的电气元件。" : data.key === "bom" ? "生成初步 BOM" : "显示需要工程师复核的项目");
            }} />
          </> : <Bubble.List items={bubbles} autoScroll role={{ user: { placement: "end" }, ai: { placement: "start" } }} />}

          {isProcessing && <ThoughtChain items={thoughtItems} />}
          {activeDrawing && !isProcessing && <WorkspaceResult
            view={resultView}
            drawing={activeDrawing}
            components={visibleComponents}
            reviewComponents={reviewComponents}
            selected={selectedComponent}
            onSelect={setSelectedComponent}
            onConfirm={() => void updateSelected({ reviewStatus: "confirmed" })}
            onEdit={() => void editSelectedCategory()}
            onRemove={() => void removeSelected()}
            onExport={() => void downloadBom(activeDrawing.id)}
          />}
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 700, margin: "0 auto" }}>
        {activeDrawing && <Prompts wrap items={followupPrompts} onItemClick={({ data }) => { setFilterCategory(null); setResultView(data.key as ResultView); }} />}
        <Sender
          header={<Sender.Header
            open={attachments.length > 0}
            onOpenChange={(open) => {
              if (!open) {
                setSelectedFile(null);
                setAttachments([]);
                setAttachmentError("");
              }
            }}
          >
            {attachmentList}
            {attachmentError && <Bubble content={`错误：${attachmentError}`} variant="borderless" />}
          </Sender.Header>}
          loading={loading}
          autoSize={{ minRows: 1, maxRows: 6 }}
          onSubmit={(text) => void submit(text)}
          onCancel={() => { setLoading(false); if (activeId) void appendText("已停止等待当前响应；已提交的后台分析任务仍会继续。", "assistant"); }}
          onPasteFile={(files) => { const file = files.item(0); if (file) selectAttachment(file, "paste"); }}
          placeholder={activeDrawing ? "询问图纸、筛选元件或修改识别结果…" : "上传 DWG 或 DXF 图纸，或输入分析要求…"}
          prefix={attachmentTrigger}
        />
      </div>
    </section>
  </main>;
}

function WorkspaceResult({ view, drawing, components, reviewComponents, selected, onSelect, onConfirm, onEdit, onRemove, onExport }: {
  view: ResultView;
  drawing: Drawing;
  components: Component[];
  reviewComponents: Component[];
  selected: Component | null;
  onSelect: (component: Component) => void;
  onConfirm: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onExport: () => void;
}) {
  const componentPrompts = components.map((component) => ({
    key: component.id,
    label: `${component.tag ?? component.temporaryId} · ${COMPONENT_CATEGORY_LABELS[component.category as ComponentCategory] ?? component.category}`,
    description: `${Math.round(component.confidence * 100)}% · ${component.reviewStatus === "confirmed" ? "已确认" : "需要复核"}`,
  }));
  const reviewPrompts = reviewComponents.map((component) => ({
    key: component.id,
    label: `${component.tag ?? component.temporaryId} · ${COMPONENT_CATEGORY_LABELS[component.category as ComponentCategory] ?? component.category}`,
    description: component.category === "unknown" ? "未知元件，需要工程师分类" : `置信度 ${Math.round(component.confidence * 100)}%`,
  }));
  const selectedMarkdown = selected ? `### ${selected.tag ?? selected.temporaryId}\n\n- 类别：${COMPONENT_CATEGORY_LABELS[selected.category as ComponentCategory] ?? selected.category}\n- 描述：${selected.description}\n- 规格：${specifications(selected.specifications)}\n- 制造商：${visibleValue(selected.manufacturer)}\n- 型号：${visibleValue(selected.modelNumber)}\n- 置信度：${Math.round(selected.confidence * 100)}%\n- 识别方法：${selected.method}\n- 状态：${selected.reviewStatus === "confirmed" ? "已由工程师确认" : "需要工程师复核"}\n- 证据：${stringArray(selected.evidence).join("；") || "无可显示证据"}` : "";

  if (view === "drawing") return <Bubble placement="start" content={<>
    <FileCard name={drawing.originalFilename} type="image" src={drawing.previewImageUrl ?? undefined} description={drawing.previewImageUrl ? `${drawing.previewWidth ?? "?"}×${drawing.previewHeight ?? "?"} 图纸预览` : "尚未生成图纸预览"} />
    <ThoughtChain items={[{ key: "preview", title: drawing.previewImageUrl ? "图纸预览已生成" : "等待图纸预览", description: "标记位置来自 DXF 渲染坐标；演示结果需要工程师复核。", status: drawing.previewImageUrl ? "success" : "loading" }]} />
  </>} />;

  if (view === "bom") return <Bubble placement="start" content={<>
    <XMarkdown content={bomMarkdown(drawing.bomItems)} />
    <Actions items={[{ key: "export", label: "导出 Excel", icon: <ExportOutlined /> }, { key: "refresh", label: "重新生成", icon: <ReloadOutlined /> }]} onClick={({ key }) => { if (key === "export") onExport(); }} />
  </>} />;

  if (view === "review") return <Bubble placement="start" content={<>
    <XMarkdown content={`### 工程师复核清单\n\n共 **${reviewComponents.length}** 个项目需要确认。未知元件、低置信度项目和未确认的 AI 结果都列在这里。`} />
    <Prompts vertical items={reviewPrompts} onItemClick={({ data }) => { const component = reviewComponents.find((item) => item.id === data.key); if (component) onSelect(component); }} />
    {selected && <><XMarkdown content={selectedMarkdown} /><Actions items={[{ key: "confirm", label: "确认", icon: <SafetyCertificateOutlined /> }, { key: "edit", label: "修改类别", icon: <EditOutlined /> }, { key: "remove", label: "移除", icon: <DeleteOutlined />, danger: true }]} onClick={({ key }) => { if (key === "confirm") onConfirm(); if (key === "edit") onEdit(); if (key === "remove") onRemove(); }} /></>}
  </>} />;

  return <Bubble placement="start" content={<>
    <XMarkdown content={formatCategorizedComponents(components)} />
    <Prompts vertical title="选择元件查看证据" items={componentPrompts} onItemClick={({ data }) => { const component = components.find((item) => item.id === data.key); if (component) onSelect(component); }} />
    {selected && <><XMarkdown content={selectedMarkdown} /><Actions items={[{ key: "locate", label: "查看来源", icon: <EyeOutlined /> }, { key: "confirm", label: "确认", icon: <SafetyCertificateOutlined /> }, { key: "edit", label: "修改类别", icon: <EditOutlined /> }, { key: "remove", label: "移除", icon: <DeleteOutlined />, danger: true }]} onClick={({ key }) => { if (key === "confirm") onConfirm(); if (key === "edit") onEdit(); if (key === "remove") onRemove(); }} /></>}
  </>} />;
}
