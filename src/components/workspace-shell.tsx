"use client";

import { useState, type ReactNode } from "react";
import { AppstoreOutlined, MenuOutlined } from "@ant-design/icons";
import { Button, Drawer, Tooltip } from "antd";
import styles from "./drawing-workspace.module.css";

export default function WorkspaceShell({ sidebar, inspector, children }: { sidebar: ReactNode; inspector?: ReactNode; children: ReactNode }) {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  return (
    <main className={`${styles.workspace} ${inspector ? "" : styles.workspaceNoInspector}`}>
      <aside className={styles.sidebar}>{sidebar}</aside>
      <section className={styles.main}>{children}</section>
      {inspector ? <aside className={styles.inspector}>{inspector}</aside> : null}

      <div className={styles.mobileControls}>
        <Tooltip title="分析会话">
          <Button aria-label="打开分析会话" icon={<MenuOutlined />} onClick={() => setLeftOpen(true)} />
        </Tooltip>
        {inspector ? (
          <Tooltip title="工程详情">
            <Button aria-label="打开工程详情" icon={<AppstoreOutlined />} onClick={() => setRightOpen(true)} />
          </Tooltip>
        ) : null}
      </div>

      <Drawer title="分析会话" placement="left" width={300} open={leftOpen} onClose={() => setLeftOpen(false)} styles={{ body: { padding: 0 } }}>
        {sidebar}
      </Drawer>
      {inspector ? (
        <Drawer title="工程详情" placement="right" width={380} open={rightOpen} onClose={() => setRightOpen(false)} styles={{ body: { padding: 0 } }}>
          {inspector}
        </Drawer>
      ) : null}
    </main>
  );
}
