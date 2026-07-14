import { describe, expect, it } from "vitest";
import { buildSessionFileGroups, buildWorkspaceCounts } from "./workspace-model";
import type { Drawing, MessageRecord } from "./workspace-types";

const drawing: Drawing = {
  id: "drawing-current",
  originalFilename: "cabinet.dxf",
  sourceType: "dxf",
  byteSize: 4096,
  status: "completed",
  previewImageUrl: "/preview/current.png",
  previewWidth: 1600,
  previewHeight: 900,
  analysisJob: { id: "job-1", status: "completed", progress: 100, stage: "分析完成" },
  components: [
    {
      id: "component-1",
      temporaryId: "TMP-1",
      category: "relay",
      tag: "K1",
      description: "中间继电器",
      specifications: [],
      manufacturer: null,
      modelNumber: null,
      confidence: 0.93,
      evidence: ["块名: RELAY"],
      method: "block",
      reviewStatus: "confirmed",
      location: null,
      removedAt: null,
    },
    {
      id: "component-2",
      temporaryId: "TMP-2",
      category: "unknown",
      tag: null,
      description: "未知符号",
      specifications: [],
      manufacturer: null,
      modelNumber: null,
      confidence: 0.42,
      evidence: [],
      method: "geometry",
      reviewStatus: "pending",
      location: null,
      removedAt: null,
    },
  ],
  physicalDevices: [{ id: "device-1", temporaryId: "DEV-1", tag: "K1", category: "relay", reviewStatus: "confirmed" }],
  bomItems: [{ id: "bom-1", itemNumber: 1, category: "relay", description: "中间继电器", manufacturer: null, modelNumber: null, specifications: [], quantity: 1, confidence: 0.93, reviewStatus: "confirmed" }],
};

const messages: MessageRecord[] = [
  { id: "file-current", type: "file", role: "user", payload: { filename: "cabinet.dxf", drawingId: "drawing-current" }, createdAt: "2026-07-14T09:00:00Z" },
  { id: "export-current", type: "export", role: "assistant", payload: { filename: "元件分析清单.xlsx", drawingId: "drawing-current" }, createdAt: "2026-07-14T09:05:00Z" },
  { id: "export-other", type: "export", role: "assistant", payload: { filename: "另一会话.xlsx", drawingId: "drawing-other" }, createdAt: "2026-07-14T09:06:00Z" },
];

describe("workspace presentation model", () => {
  it("builds source, artifact and export groups only from the current drawing", () => {
    const groups = buildSessionFileGroups(drawing, messages);

    expect(groups.map((group) => group.key)).toEqual(["source", "artifacts", "exports"]);
    expect(groups[0].files[0]).toMatchObject({ name: "cabinet.dxf", kind: "source", byteSize: 4096 });
    expect(groups[1].files[0]).toMatchObject({ name: "图纸总览.png", kind: "preview", previewUrl: "/preview/current.png" });
    expect(groups[2].files.map((file) => file.name)).toEqual(["元件分析清单.xlsx"]);
  });

  it("does not fabricate preview or export files that do not exist", () => {
    const groups = buildSessionFileGroups({ ...drawing, previewImageUrl: null }, messages.filter((message) => message.type !== "export"));

    expect(groups.find((group) => group.key === "artifacts")?.files).toEqual([]);
    expect(groups.find((group) => group.key === "exports")?.files).toEqual([]);
  });

  it("separates symbol occurrences, physical devices and review work", () => {
    expect(buildWorkspaceCounts(drawing)).toEqual({
      symbolOccurrences: 2,
      physicalDevices: 1,
      reviewRequired: 1,
      bomGroups: 1,
    });
  });
});
