import type { Metadata } from "next";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "电气图纸 AI",
  description: "AutoCAD 电气图纸初步分析、元件分类与 BOM 生成。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0 }}><Providers>{children}</Providers></body>
    </html>
  );
}
