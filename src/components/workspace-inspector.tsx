"use client";

import { AppstoreOutlined, FileOutlined, FileSearchOutlined, SafetyCertificateOutlined, TableOutlined } from "@ant-design/icons";
import { Badge, Tabs } from "antd";
import { buildWorkspaceCounts } from "./workspace-model";
import { BomInspector, ComponentInspector, DrawingInspector, ReviewInspector } from "./result-inspectors";
import SessionFilesPanel from "./session-files-panel";
import type { Drawing, DrawingComponent, InspectorView, MessageRecord } from "./workspace-types";
import styles from "./drawing-workspace.module.css";

export default function WorkspaceInspector({ activeView, drawing, messages, components, reviewComponents, selected, onViewChange, onSelect, onConfirm, onEdit, onRemove, onRegenerate, onExport }: {
  activeView: InspectorView;
  drawing: Drawing | null;
  messages: MessageRecord[];
  components: DrawingComponent[];
  reviewComponents: DrawingComponent[];
  selected: DrawingComponent | null;
  onViewChange: (view: InspectorView) => void;
  onSelect: (component: DrawingComponent) => void;
  onConfirm: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onRegenerate: () => void;
  onExport: () => void;
}) {
  const counts = buildWorkspaceCounts(drawing);
  const exportWithNotice = async () => {
    const { notification: XNotification } = await import("@ant-design/x");
    if (XNotification.permission === "granted") XNotification.open({ title: "正在准备元件分析清单", body: "Excel 生成完成后将自动下载。", tag: "drawing-export", duration: 3 });
    onExport();
  };

  const items = [
    { key: "drawing", label: <span><AppstoreOutlined /> 图纸</span>, children: <DrawingInspector drawing={drawing} /> },
    { key: "files", label: <span><FileOutlined /> 文件</span>, children: <SessionFilesPanel drawing={drawing} messages={messages} onExport={() => void exportWithNotice()} /> },
    { key: "components", label: <span><FileSearchOutlined /> 元件 <Badge count={counts.symbolOccurrences} size="small" /></span>, children: <ComponentInspector components={components} selected={selected} onSelect={onSelect} onConfirm={onConfirm} onEdit={onEdit} onRemove={onRemove} /> },
    { key: "review", label: <span><SafetyCertificateOutlined /> 复核 <Badge count={counts.reviewRequired} size="small" /></span>, children: <ReviewInspector components={reviewComponents} selected={selected} onSelect={onSelect} onConfirm={onConfirm} onEdit={onEdit} onRemove={onRemove} /> },
    { key: "bom", label: <span><TableOutlined /> BOM</span>, children: <BomInspector drawing={drawing} onRegenerate={onRegenerate} onExport={() => void exportWithNotice()} /> },
  ];

  return (
    <div className={styles.inspectorPanel}>
      <header className={styles.inspectorHeader}>
        <strong>工程详情</strong>
        <span>{drawing?.originalFilename ?? "当前会话"}</span>
      </header>
      <Tabs className={styles.inspectorTabs} activeKey={activeView} onChange={(key) => onViewChange(key as InspectorView)} items={items} size="small" tabBarGutter={8} />
    </div>
  );
}
