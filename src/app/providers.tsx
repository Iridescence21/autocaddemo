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
          token: { colorPrimary: "#1677ff", borderRadius: 8, colorBgLayout: "#f5f5f5" },
        }}
      >
        {children}
      </XProvider>
    </AntdRegistry>
  );
}
