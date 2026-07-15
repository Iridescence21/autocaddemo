import { describe, expect, it } from "vitest";
import { buildStructuralSnapshot, extractNativeBomRows, reviewNativeBomRows } from "@/lib/cad/native-bom";
import type { DxfTextContext, NormalizedDxfDrawing } from "@/lib/cad/dxf-types";

function text(value: string, x: number, y: number, handle: string): DxfTextContext {
  return { value, layer: "0", handle, position: { x, y } };
}

function drawing(texts: DxfTextContext[]): NormalizedDxfDrawing {
  return {
    entities: [],
    blockDefinitions: {},
    layers: ["0"],
    blockNames: [],
    texts,
    extents: { minX: 0, minY: 0, maxX: 100, maxY: 120 },
    warnings: [],
  };
}

describe("native CAD BOM extraction", () => {
  it("maps table columns, expands grouped symbols, and preserves quantity", () => {
    const rows = extractNativeBomRows(drawing([
      text("序号", 2, 100, "h1"),
      text("符号", 12, 100, "h2"),
      text("名称", 32, 100, "h3"),
      text("型号规格", 62, 100, "h4"),
      text("数量", 88, 100, "h5"),
      text("备注", 96, 100, "h6"),
      text("1", 2, 90, "r1c1"),
      text("146", -20, 90, "outside"),
      text("KC1,2,3", 12, 90, "r1c2"),
      text("电流继电器", 32, 90, "r1c3"),
      text("LL-61E/5", 62, 90, "r1c4"),
      text("3", 88, 90, "r1c5"),
      text("柜内", 96, 90, "remark"),
      text("2", 2, 80, "r2c1"),
      text("KC4", 12, 80, "r2c2"),
      text("电流继电器", 32, 80, "r2c3"),
      text("LL-63E/5", 62, 80, "r2c4"),
      text("1", 88, 80, "r2c5"),
    ]));

    expect(rows).toEqual([
      expect.objectContaining({ itemNumber: 1, rawSymbol: "KC1,2,3", symbolTags: ["KC1", "KC2", "KC3"], name: "电流继电器", modelSpec: "LL-61E/5", quantity: 3 }),
      expect.objectContaining({ itemNumber: 2, rawSymbol: "KC4", symbolTags: ["KC4"], name: "电流继电器", modelSpec: "LL-63E/5", quantity: 1 }),
    ]);
    expect(rows[0].evidenceHandles).toEqual(["r1c1", "r1c2", "r1c3", "r1c4", "r1c5"]);
  });

  it("ignores unrelated schematic text when no BOM header is present", () => {
    expect(extractNativeBomRows(drawing([
      text("KC1", 10, 50, "a"),
      text("21", 10, 40, "b"),
    ]))).toEqual([]);
  });

  it("builds a versioned snapshot with native counts, tags, BOM rows, and review issues", () => {
    const source = drawing([
      text("序号", 2, 100, "h1"), text("符号", 12, 100, "h2"), text("名称", 32, 100, "h3"),
      text("型号规格", 62, 100, "h4"), text("数量", 88, 100, "h5"), text("备注", 96, 100, "h6"),
      text("1", 2, 90, "r1"), text("KC1,2", 12, 90, "r2"), text("电流继电器", 32, 90, "r3"),
      text("LL-61E/5", 62, 90, "r4"), text("3", 88, 90, "r5"),
    ]);
    const snapshot = buildStructuralSnapshot(source, {
      overviewImageUrl: "data:image/png;base64,test",
      width: 100,
      height: 120,
      tiles: [],
      metadata: { context: source },
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      counts: { entities: 0, texts: 11, blocks: 0, layers: 1, structuralTags: 2, bomRows: 1 },
      bomRows: [expect.objectContaining({ name: "电流继电器", quantity: 3 })],
      reviewIssues: [expect.objectContaining({ code: "BOM_TAG_QUANTITY_MISMATCH", severity: "warning", tags: ["KC1", "KC2"] })],
    });
  });

  it("reports missing models and conflicting information for the same tag", () => {
    const issues = reviewNativeBomRows([
      { itemNumber: 1, rawSymbol: "KC1", symbolTags: ["KC1"], name: "电流继电器", modelSpec: null, quantity: 1, cadPosition: { x: 0, y: 0 }, evidenceHandles: [] },
      { itemNumber: 2, rawSymbol: "KC1", symbolTags: ["KC1"], name: "电流继电器", modelSpec: "LL-63E/5", quantity: 1, cadPosition: { x: 0, y: 0 }, evidenceHandles: [] },
    ]);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "BOM_MODEL_MISSING" }),
      expect.objectContaining({ code: "BOM_TAG_CONFLICT", tags: ["KC1"] }),
    ]));
  });
});
