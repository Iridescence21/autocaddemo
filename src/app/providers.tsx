"use client";

import type { ReactNode } from "react";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { XProvider } from "@ant-design/x";
import zhCN from "antd/locale/zh_CN";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <XProvider
        locale={zhCN}
        theme={{
          token: {
            colorPrimary: "#1677ff",
            colorInfo: "#1677ff",
            colorBgLayout: "#f5f7fa",
            colorBgContainer: "#ffffff",
            borderRadius: 10,
            borderRadiusLG: 14,
            boxShadowSecondary: "0 12px 36px rgba(15, 23, 42, 0.10)",
          },
          components: {
            Drawer: { paddingLG: 0 },
          },
        }}
      >
        {children}
      </XProvider>
    </AntdRegistry>
  );
}
