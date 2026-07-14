import { NextResponse } from "next/server";
import { z } from "zod";
import { OWNER_SCOPE } from "@/lib/domain";
import { appendMessage, listMessages } from "@/lib/repositories/messages";

export const runtime = "nodejs";
const payloadSchema = z.object({ type: z.string().max(40), role: z.enum(["user", "assistant", "system"]), payload: z.record(z.string(), z.unknown()) });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const messages = await listMessages((await context.params).id, OWNER_SCOPE);
  return NextResponse.json({ messages });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_MESSAGE", message: "消息内容无效。" }, { status: 400 });
  const message = await appendMessage((await context.params).id, { ownerScope: OWNER_SCOPE, ...parsed.data });
  return message ? NextResponse.json({ message }, { status: 201 }) : NextResponse.json({ code: "NOT_FOUND", message: "未找到会话。" }, { status: 404 });
}
