"use client";

import { useState } from "react";
import { Attachments, Bubble, Sender, Suggestion } from "@ant-design/x";
import { BulbOutlined, ExportOutlined, FileSearchOutlined, FilterOutlined, PaperClipOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import type { AttachmentItem } from "./workspace-types";
import styles from "./drawing-workspace.module.css";

const commands: Record<string, string> = {
  analyze: "分析这张图纸，并按类别列出所有可识别的电气元件。",
  filter: "筛选接触器",
  review: "显示需要工程师复核的项目",
  bom: "生成初步 BOM",
  export: "导出 BOM",
};

export const suggestionItems = [
  { value: "analyze", label: "完整识别", icon: <FileSearchOutlined />, extra: "识别图层、符号和设备" },
  { value: "filter", label: "筛选元件", icon: <FilterOutlined />, extra: "按受控类别查询" },
  { value: "review", label: "工程复核", icon: <SafetyCertificateOutlined />, extra: "查看未知与待确认项" },
  { value: "bom", label: "生成 BOM", icon: <BulbOutlined />, extra: "按物理设备汇总" },
  { value: "export", label: "导出 Excel", icon: <ExportOutlined />, extra: "下载完整元件分析" },
];

export function commandForSuggestion(value: string) {
  return commands[value] ?? value;
}

export default function AnalysisComposer({ attachments, attachmentError, loading, hasDrawing, onSelectFile, onRemoveFile, onSubmit, onCancel }: {
  attachments: AttachmentItem[];
  attachmentError: string;
  loading: boolean;
  hasDrawing: boolean;
  onSelectFile: (file: File, uid?: string) => boolean;
  onRemoveFile: () => void;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [fullAnalysis, setFullAnalysis] = useState(true);

  const attachmentTrigger = (
    <Attachments accept=".dwg,.dxf" maxCount={1} beforeUpload={(file) => onSelectFile(file)} onRemove={onRemoveFile}>
      <Tooltip title="上传 DWG 或 DXF 图纸">
        <PaperClipOutlined aria-label="上传 DWG 或 DXF 图纸" />
      </Tooltip>
    </Attachments>
  );

  return (
    <div className={styles.composer}>
      {attachmentError ? <Bubble.System variant="outlined" content={`附件错误：${attachmentError}`} /> : null}
      <Suggestion
        block
        items={suggestionItems}
        onSelect={(selected) => setValue(commandForSuggestion(selected))}
      >
        {({ onTrigger, onKeyDown }) => (
          <Sender
            value={value}
            onChange={(next) => {
              setValue(next);
              if (next.endsWith("@") || next.endsWith("/")) onTrigger({ query: next });
            }}
            onKeyDown={onKeyDown}
            header={(
              <Sender.Header open={attachments.length > 0} onOpenChange={(open) => { if (!open) onRemoveFile(); }}>
                <Attachments accept=".dwg,.dxf" maxCount={1} items={attachments} overflow="scrollX" onRemove={onRemoveFile} />
              </Sender.Header>
            )}
            loading={loading}
            autoSize={{ minRows: 1, maxRows: 6 }}
            onSubmit={(text) => {
              const submitted = text.trim() || (fullAnalysis && hasDrawing ? commands.analyze : "");
              if (!submitted && !attachments.length) return;
              onSubmit(submitted);
              setValue("");
            }}
            onCancel={onCancel}
            onPasteFile={(files) => {
              const file = files.item(0);
              if (file) onSelectFile(file, "paste");
            }}
            placeholder={hasDrawing ? "询问图纸、筛选元件或修改识别结果；输入 @ 查看快捷指令" : "上传 DWG 或 DXF 图纸，或输入分析要求"}
            prefix={attachmentTrigger}
            footer={(
              <div className={styles.composerFooter}>
                <Sender.Switch
                  value={fullAnalysis}
                  onChange={setFullAnalysis}
                  checkedChildren="完整识别"
                  unCheckedChildren="指令模式"
                  icon={<BulbOutlined />}
                />
                <span>输入 @ 或 / 唤起快捷指令</span>
              </div>
            )}
          />
        )}
      </Suggestion>
    </div>
  );
}
