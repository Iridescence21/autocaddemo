"use client";

import { useMemo, useState } from "react";
import { FileCard, Folder } from "@ant-design/x";
import { Empty } from "antd";
import { buildSessionFileGroups } from "./workspace-model";
import type { Drawing, MessageRecord, SessionFile } from "./workspace-types";
import styles from "./drawing-workspace.module.css";

const groupLabels = { source: "原始图纸", artifacts: "分析产物", exports: "导出结果" } as const;

export default function SessionFilesPanel({ drawing, messages, onExport }: { drawing: Drawing | null; messages: MessageRecord[]; onExport: () => void }) {
  const groups = useMemo(() => buildSessionFileGroups(drawing, messages), [drawing, messages]);
  const files = groups.flatMap((group) => group.files);
  const [selectedKey, setSelectedKey] = useState(files[0]?.key ?? "");
  const selected = files.find((file) => file.key === selectedKey) ?? files[0];
  const selectedGroup = groups.find((group) => group.files.some((file) => file.key === selected?.key));

  const treeData = groups.map((group) => ({
    title: `${groupLabels[group.key]} (${group.files.length})`,
    path: group.key,
    children: group.files.map((file) => ({ title: file.name, path: file.key, content: file.key })),
  }));

  function card(file: SessionFile) {
    return (
      <FileCard
        className={styles.inspectorFileCard}
        name={file.name}
        byte={file.byteSize}
        type={file.kind === "preview" ? "image" : "file"}
        src={file.previewUrl}
        icon={file.name.endsWith(".xlsx") ? "excel" : file.kind === "preview" ? "image" : "default"}
        description={file.description}
        onClick={() => { if (file.kind === "export") onExport(); }}
      />
    );
  }

  if (!drawing) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前会话还没有文件" />;

  return (
    <div className={styles.fileBrowser}>
      <Folder
        treeData={treeData}
        defaultExpandAll
        directoryTreeWith={132}
        selectedFile={selected && selectedGroup ? [selectedGroup.key, selected.key] : []}
        onSelectedFileChange={({ content }) => { if (content) setSelectedKey(content); }}
        directoryTitle="当前会话"
        previewTitle={false}
        emptyRender={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个文件" />}
        previewRender={({ content }) => {
          const file = files.find((item) => item.key === content);
          return file ? card(file) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个文件" />;
        }}
      />
    </div>
  );
}
