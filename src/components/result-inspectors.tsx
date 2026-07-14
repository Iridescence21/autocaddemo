"use client";

import { Actions, FileCard, Prompts, Sources } from "@ant-design/x";
import { XMarkdown } from "@ant-design/x-markdown";
import { DeleteOutlined, EditOutlined, ExportOutlined, ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Descriptions, Empty, Progress, Tag } from "antd";
import { COMPONENT_CATEGORY_LABELS } from "@/lib/presentation/component-list";
import type { ComponentCategory } from "@/lib/domain";
import type { Drawing, DrawingComponent } from "./workspace-types";
import styles from "./drawing-workspace.module.css";

function values(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function display(value: string | null | undefined) {
  return value?.trim() || "图纸中未显示";
}

export function DrawingInspector({ drawing }: { drawing: Drawing | null }) {
  if (!drawing) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传图纸后查看工程信息" />;
  const job = drawing.analysisJob;
  return (
    <div className={styles.inspectorStack}>
      <FileCard name={drawing.originalFilename} type="image" src={drawing.previewImageUrl ?? undefined} byte={drawing.byteSize} description={`${drawing.sourceType.toUpperCase()} · ${drawing.previewWidth ?? "?"} × ${drawing.previewHeight ?? "?"}`} />
      <Progress percent={job?.progress ?? (drawing.status === "completed" ? 100 : 0)} status={job?.status === "failed" ? "exception" : "active"} size="small" />
      <Descriptions size="small" column={1} items={[
        { key: "status", label: "分析状态", children: <Tag color={job?.status === "failed" ? "error" : "processing"}>{job?.stage ?? drawing.status}</Tag> },
        { key: "symbols", label: "符号实例", children: drawing.components.filter((item) => !item.removedAt).length },
        { key: "devices", label: "物理设备", children: drawing.physicalDevices.length },
        { key: "bom", label: "BOM 分组", children: drawing.bomItems.length },
      ]} />
    </div>
  );
}

function componentLabel(component: DrawingComponent) {
  return `${component.tag ?? component.temporaryId} · ${COMPONENT_CATEGORY_LABELS[component.category as ComponentCategory] ?? component.category}`;
}

export function ComponentInspector({ components, selected, onSelect, onConfirm, onEdit, onRemove }: {
  components: DrawingComponent[];
  selected: DrawingComponent | null;
  onSelect: (component: DrawingComponent) => void;
  onConfirm: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  if (!components.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未识别到元件" />;
  const evidence = selected ? values(selected.evidence) : [];
  return (
    <div className={styles.inspectorStack}>
      <Prompts vertical items={components.map((component) => ({ key: component.id, label: componentLabel(component), description: `${Math.round(component.confidence * 100)}% · ${component.reviewStatus === "confirmed" ? "已确认" : "需要复核"}` }))} onItemClick={({ data }) => { const component = components.find((item) => item.id === data.key); if (component) onSelect(component); }} />
      {selected ? (
        <div className={styles.detailCard}>
          <Descriptions size="small" column={1} title={selected.tag ?? selected.temporaryId} items={[
            { key: "description", label: "描述", children: selected.description },
            { key: "manufacturer", label: "制造商", children: display(selected.manufacturer) },
            { key: "model", label: "型号", children: display(selected.modelNumber) },
            { key: "confidence", label: "置信度", children: `${Math.round(selected.confidence * 100)}%` },
          ]} />
          <Sources title="识别证据" defaultExpanded items={(evidence.length ? evidence : ["暂无可显示证据"]).map((item, index) => ({ key: index, title: item, description: selected.method }))} />
          <Actions items={[
            { key: "confirm", label: "确认", icon: <SafetyCertificateOutlined /> },
            { key: "edit", label: "修改类别", icon: <EditOutlined /> },
            { key: "remove", label: "移除", icon: <DeleteOutlined />, danger: true },
          ]} onClick={({ key }) => { if (key === "confirm") onConfirm(); if (key === "edit") onEdit(); if (key === "remove") onRemove(); }} />
        </div>
      ) : null}
    </div>
  );
}

export function ReviewInspector(props: Omit<Parameters<typeof ComponentInspector>[0], "components"> & { components: DrawingComponent[] }) {
  if (!props.components.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有待复核项目" />;
  return <div className={styles.inspectorStack}><Tag color="warning">需要工程师确认</Tag><ComponentInspector {...props} /></div>;
}

export function BomInspector({ drawing, onRegenerate, onExport }: { drawing: Drawing | null; onRegenerate: () => void; onExport: () => void }) {
  if (!drawing?.bomItems.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="分析完成后可生成初步 BOM" />;
  const rows = drawing.bomItems.map((item) => `| ${item.itemNumber} | ${COMPONENT_CATEGORY_LABELS[item.category as ComponentCategory] ?? item.category} | ${item.description} | ${item.quantity} | ${Math.round(item.confidence * 100)}% |`).join("\n");
  return (
    <div className={styles.inspectorStack}>
      <XMarkdown content={`### 初步 BOM\n\n物理设备 **${drawing.physicalDevices.length}** · 采购分组 **${drawing.bomItems.length}**\n\n| 项次 | 类别 | 描述 | 数量 | 置信度 |\n| --- | --- | --- | ---: | ---: |\n${rows}\n\n> 所有采购信息必须由电气工程师确认。`} />
      <Actions variant="outlined" items={[{ key: "export", label: "导出 Excel", icon: <ExportOutlined /> }, { key: "refresh", label: "重新生成", icon: <ReloadOutlined /> }]} onClick={({ key }) => { if (key === "export") onExport(); if (key === "refresh") onRegenerate(); }} />
    </div>
  );
}
