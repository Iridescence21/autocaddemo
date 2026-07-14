"use client";

import { Actions, Bubble, FileCard, Sources, Think, ThoughtChain } from "@ant-design/x";
import type { BubbleItemType } from "@ant-design/x";
import { XMarkdown } from "@ant-design/x-markdown";
import { CopyOutlined, ExportOutlined, ReloadOutlined } from "@ant-design/icons";
import { Avatar } from "antd";
import { buildMessageView } from "./workspace-model";
import type { MessageRecord } from "./workspace-types";
import styles from "./drawing-workspace.module.css";

function contentFor(view: ReturnType<typeof buildMessageView>) {
  if (view.kind === "file") {
    return <FileCard name={String(view.data.filename ?? "drawing.cad")} byte={Number(view.data.byteSize ?? 0)} type="file" description={`${String(view.data.sourceType ?? "CAD").toUpperCase()} · 文件已接收`} />;
  }

  if (view.showTaskChain) {
    return <ThoughtChain line="solid" items={[{
      key: view.id,
      title: view.stage,
      description: `完成度 ${view.progress ?? 0}%`,
      status: view.taskStatus,
      blink: view.taskStatus === "loading",
      collapsible: true,
      content: view.taskStatus === "loading" ? "系统正在执行 CAD 转换、图层解析与元件归并。" : "该处理阶段已记录到当前分析会话。",
    }]} />;
  }

  return (
    <div className={styles.messageBody}>
      {view.showThink ? (
        <Think title="识别依据摘要" defaultExpanded={false}>
          <Sources
            title="判断来源"
            items={view.rationale.map((item, index) => ({ key: index, title: item }))}
          />
        </Think>
      ) : null}
      {view.text ? <XMarkdown content={view.text} /> : null}
      {view.warning ? <Bubble.System variant="outlined" content={view.warning} /> : null}
    </div>
  );
}

function footerFor(view: ReturnType<typeof buildMessageView>, onRetry?: () => void, onExport?: () => void) {
  if (view.role !== "ai") return null;
  const items = [{ key: "copy", label: "复制", icon: <CopyOutlined /> }];
  if (view.kind === "bom_results" && onExport) items.push({ key: "export", label: "导出 Excel", icon: <ExportOutlined /> });
  if (view.kind === "drawing_summary" && onRetry) items.push({ key: "retry", label: "重新分析", icon: <ReloadOutlined /> });

  return <Actions items={items} onClick={({ key }) => {
    if (key === "copy") void navigator.clipboard?.writeText(view.text);
    if (key === "retry") onRetry?.();
    if (key === "export") onExport?.();
  }} />;
}

export default function DrawingMessageList({ messages, onRetry, onExport }: {
  messages: MessageRecord[];
  onRetry?: () => void;
  onExport?: () => void;
}) {
  if (!messages.length) return null;

  const systemMessages = messages.map(buildMessageView).filter((view) => view.role === "system");
  const items: BubbleItemType[] = messages.map(buildMessageView).filter((view) => view.role !== "system").map((view) => ({
    key: view.id,
    role: view.role,
    content: contentFor(view),
    status: view.status,
    footer: footerFor(view, onRetry, onExport),
  }));

  return (
    <div className={styles.messageList}>
      <Bubble.Divider content="当前分析会话" />
      {systemMessages.map((view) => <Bubble.System key={view.id} variant="outlined" content={`分析失败：${view.text}`} />)}
      <Bubble.List
        items={items}
        role={{
          user: { placement: "end", variant: "filled", shape: "corner", avatar: <Avatar size={30}>我</Avatar> },
          ai: { placement: "start", variant: "borderless", avatar: <Avatar size={30} className={styles.aiAvatar}>AI</Avatar>, header: "图纸分析助手" },
        }}
      />
    </div>
  );
}
