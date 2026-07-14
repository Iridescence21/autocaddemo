import { NextResponse } from "next/server";
import { z } from "zod";
import { OWNER_SCOPE } from "@/lib/domain";
import { deleteConversation, getConversation, updateConversation } from "@/lib/repositories/conversations";

export const runtime = "nodejs";
const idSchema = z.string().min(1).max(80);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ code: "INVALID_ID", message: "会话 ID 无效。" }, { status: 400 });
  const conversation = await getConversation(id.data, OWNER_SCOPE);
  return conversation ? NextResponse.json({ conversation }) : NextResponse.json({ code: "NOT_FOUND", message: "未找到会话。" }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await context.params).id);
  const body = z.object({ title: z.string().trim().min(1).max(120).optional(), status: z.string().max(40).optional() }).safeParse(await request.json().catch(() => ({})));
  if (!id.success || !body.success) return NextResponse.json({ code: "INVALID_REQUEST", message: "会话更新内容无效。" }, { status: 400 });
  const updated = await updateConversation(id.data, OWNER_SCOPE, body.data);
  return updated ? NextResponse.json({ ok: true }) : NextResponse.json({ code: "NOT_FOUND", message: "未找到会话。" }, { status: 404 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ code: "INVALID_ID", message: "会话 ID 无效。" }, { status: 400 });
  const deleted = await deleteConversation(id.data, OWNER_SCOPE);
  return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ code: "NOT_FOUND", message: "未找到会话。" }, { status: 404 });
}
