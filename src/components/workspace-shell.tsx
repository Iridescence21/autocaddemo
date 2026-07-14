"use client";

import { useState, type ReactNode } from "react";
import { MenuOutlined } from "@ant-design/icons";
import { Button, Drawer, Tooltip } from "antd";
import styles from "./drawing-workspace.module.css";

export default function WorkspaceShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [leftOpen, setLeftOpen] = useState(false);

  return (
    <main className={styles.workspace}>
      <aside className={styles.sidebar}>{sidebar}</aside>
      <section className={styles.main}>{children}</section>

      <div className={styles.mobileControls}>
        <Tooltip title="分析会话">
          <Button aria-label="打开分析会话" icon={<MenuOutlined />} onClick={() => setLeftOpen(true)} />
        </Tooltip>
      </div>

      <Drawer title="分析会话" placement="left" size={300} open={leftOpen} onClose={() => setLeftOpen(false)} styles={{ body: { padding: 0 } }}>
        {sidebar}
      </Drawer>
    </main>
  );
}
