"use client";

import { Conversations, Welcome } from "@ant-design/x";
import type { ConversationItemType } from "@ant-design/x";
import { DeploymentUnitOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import styles from "./drawing-workspace.module.css";

export default function ConversationSidebar({ items, activeKey, onCreate, onActiveChange, onRename, onDelete }: {
  items: ConversationItemType[];
  activeKey: string;
  onCreate: () => void;
  onActiveChange: (key: string) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={styles.sidebarInner}>
      <header className={styles.brand}>
        <h1 className={styles.brandTitle}>
          <span className={styles.brandMark}><DeploymentUnitOutlined /></span>
          电气图纸 AI
        </h1>
        <p className={styles.brandDescription}>AutoCAD 智能分析工作台</p>
      </header>

      <Conversations
        className={styles.conversationList}
        creation={{ label: "新建分析", onClick: onCreate }}
        items={items}
        activeKey={activeKey}
        onActiveChange={onActiveChange}
        menu={() => ({
          items: [
            { key: "rename", label: "重命名" },
            { key: "delete", label: "删除", danger: true },
          ],
          onClick: ({ key }) => {
            if (key === "rename") onRename();
            if (key === "delete") onDelete();
          },
        })}
      />

      <Welcome
        className={styles.reviewNote}
        icon={<SafetyCertificateOutlined />}
        variant="borderless"
        title="工程复核"
        description="初步识别结果必须由电气工程师复核"
      />
    </div>
  );
}
