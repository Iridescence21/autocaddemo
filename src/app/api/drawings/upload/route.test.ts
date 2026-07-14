import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "@/lib/db";
import { createConversation } from "@/lib/repositories/conversations";
import { createDrawingUpload } from "@/lib/repositories/drawings";
import { POST } from "./route";

describe("drawing upload route", () => {
  beforeEach(async () => resetTestDatabase());

  it("returns a specific conflict before accepting a second drawing in one conversation", async () => {
    const conversation = await createConversation({ ownerScope: "demo-user", title: "Existing drawing" });
    await createDrawingUpload({
      conversationId: conversation.id,
      ownerScope: "demo-user",
      originalFilename: "first.dxf",
      safeFilename: "first.dxf",
      storageKey: "test/first.dxf",
      sourceType: "dxf",
      byteSize: 10,
    });
    const form = new FormData();
    form.set("conversationId", conversation.id);
    form.set("file", new File(["AC1027\nreal dwg bytes"], "second.dwg", { type: "application/acad" }));

    const response = await POST(new Request("http://localhost/api/drawings/upload", { method: "POST", body: form }));
    const payload = await response.json() as { code: string; message: string };

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      code: "CONVERSATION_ALREADY_HAS_DRAWING",
      message: "当前分析会话已有图纸。请新建分析后再上传。",
    });
  });
});
