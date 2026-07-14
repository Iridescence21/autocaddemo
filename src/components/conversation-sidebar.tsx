"use client";

import { Conversations } from "@ant-design/x";
import type { ConversationItemType } from "@ant-design/x";
import { DeploymentUnitOutlined, QuestionCircleOutlined, UserOutlined } from "@ant-design/icons";
import { Avatar, Button, Flex, Tooltip } from "antd";
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
          <Avatar className={styles.brandMark} icon={<DeploymentUnitOutlined />} />
          电气图纸 AI
        </h1>
        <p className={styles.brandDescription}>AutoCAD 智能分析工作台</p>
      </header>

      <Conversations
        className={styles.conversationList}
        creation={{ label: "开启新分析", onClick: onCreate }}
        items={items}
        activeKey={activeKey}
        onActiveChange={onActiveChange}
        groupable
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

      <Flex className={styles.sidebarFooter} align="center" justify="space-between">
        <Flex align="center" gap={8}><Avatar size={28} icon={<UserOutlined />} /><span>工程师</span></Flex>
        <Tooltip title="使用帮助"><Button type="text" size="small" icon={<QuestionCircleOutlined />} aria-label="使用帮助" /></Tooltip>
      </Flex>
    </div>
  );
}
