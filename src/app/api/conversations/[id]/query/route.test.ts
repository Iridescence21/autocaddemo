import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { resetTestDatabase } from "@/lib/db";
import { createConversation } from "@/lib/repositories/conversations";
import { createDrawingUpload, saveStructuralSnapshot } from "@/lib/repositories/drawings";
import { listMessages } from "@/lib/repositories/messages";
import type { NativeBomRow, StructuralSnapshot } from "@/lib/cad/native-bom";

function row(itemNumber: number, rawSymbol: string, modelSpec: string, quantity: number): NativeBomRow {
  const prefix = rawSymbol.match(/^[A-Z]+/)?.[0] ?? "";
  return { itemNumber, rawSymbol, symbolTags: (rawSymbol.match(/\d+/g) ?? []).map((number) => `${prefix}${number}`), name: "电流继电器", modelSpec, quantity, cadPosition: { x: 0, y: 0 }, evidenceHandles: [`h${itemNumber}`] };
}

function snapshot(rows: NativeBomRow[]): StructuralSnapshot {
  return { schemaVersion: 1, counts: { entities: 1, texts: 1, blocks: 0, layers: 1, structuralTags: 0, bomRows: rows.length }, tags: [], bomRows: rows, reviewIssues: [] };
}

async function addDrawing(title: string, filename: string, rows: NativeBomRow[]) {
  const conversation = await createConversation({ ownerScope: "demo-user", title });
  const drawing = await createDrawingUpload({ conversationId: conversation.id, ownerScope: "demo-user", originalFilename: filename, safeFilename: filename, storageKey: `test/${filename}`, sourceType: "dwg", byteSize: 1 });
  await saveStructuralSnapshot(drawing.id, "demo-user", snapshot(rows));
  return { conversation, drawing };
}

describe("conversation drawing query route", () => {
  beforeEach(async () => resetTestDatabase());

  it("validates the question payload", async () => {
    const response = await POST(new Request("http://localhost/api/conversations/missing/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "" }) }), { params: Promise.resolve({ id: "missing" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_QUESTION" });
  });

  it("answers across owner-scoped drawings and saves an assistant evidence message", async () => {
    await addDrawing("第一页", "M-T1-01.dwg", [row(6, "KC1,2,3", "LL-63E/□", 3), row(7, "KC4", "LL-61E/□", 1)]);
    const current = await addDrawing("第二页", "M-T1-02.dwg", [row(5, "KC1,2,3", "LL-61E/□", 3), row(6, "KC4,5,6", "LL-63E/□", 3), row(7, "KC7", "LL-61E/□", 1)]);

    const response = await POST(new Request(`http://localhost/api/conversations/${current.conversation.id}/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "哪张图纸分布的电流继电器多？" }) }), { params: Promise.resolve({ id: current.conversation.id }) });
    const payload = await response.json() as { answer: { text: string; evidence: string[] } };

    expect(response.status).toBe(200);
    expect(payload.answer.text).toContain("M-T1-02.dwg 最多，共 7 只");
    expect(payload.answer.evidence).toEqual(expect.arrayContaining([expect.stringContaining("M-T1-01.dwg"), expect.stringContaining("M-T1-02.dwg")]));
    expect((await listMessages(current.conversation.id, "demo-user")).at(-1)).toMatchObject({
      role: "assistant",
      type: "text",
      payload: { text: expect.stringContaining("M-T1-02.dwg 最多"), evidence: expect.arrayContaining([expect.stringContaining("BOM 第 5 行")]) },
    });
  });

  it("does not answer a conversation owned by another scope or without a drawing", async () => {
    const empty = await createConversation({ ownerScope: "demo-user", title: "空会话" });
    const response = await POST(new Request(`http://localhost/api/conversations/${empty.id}/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "电流继电器有几种类型？" }) }), { params: Promise.resolve({ id: empty.id }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ANALYSIS_REQUIRED" });
  });
});
