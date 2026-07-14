import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("workspace inspector composition", () => {
  it("exposes the five engineering views", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/workspace-inspector.tsx"), "utf8");

    for (const label of ["图纸", "文件", "元件", "复核", "BOM"]) expect(source).toContain(label);
    expect(source).toContain("Tabs");
    expect(source).toContain("XNotification");
  });

  it("uses the X file browser and evidence source components", async () => {
    const files = await readFile(resolve(process.cwd(), "src/components/session-files-panel.tsx"), "utf8");
    const results = await readFile(resolve(process.cwd(), "src/components/result-inspectors.tsx"), "utf8");

    expect(files).toContain("Folder");
    expect(files).toContain("FileCard");
    expect(files).toContain("原始图纸");
    expect(files).toContain("分析产物");
    expect(files).toContain("导出结果");
    expect(results).toContain("Sources");
    expect(results).toContain("符号实例");
    expect(results).toContain("物理设备");
  });
});
