import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Ant Design X Chinese drawing workspace", () => {
  it("uses the independent chat shell without a competing UI component library", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");

    for (const component of ["Conversations", "Welcome", "Prompts", "Bubble", "Sender", "Attachments", "FileCard", "ThoughtChain", "Actions"]) {
      expect(source).toContain(component);
    }
    expect(source).not.toMatch(/from ["']antd["']/);
    expect(source).not.toMatch(/import .*\.css/);
    expect(source).not.toContain("AnalysisPanel");
    expect(source).not.toContain("gridTemplateColumns");
  });

  it("presents the MVP interface and verification warning in Simplified Chinese", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/drawing-workspace.tsx"), "utf8");

    expect(source).toContain("电气图纸 AI");
    expect(source).toContain("上传 DWG 或 DXF 图纸");
    expect(source).toContain("初步识别结果必须由电气工程师复核");
    expect(source).toContain("元件清单");
    expect(source).not.toContain("Electrical Drawing AI");
  });
});
