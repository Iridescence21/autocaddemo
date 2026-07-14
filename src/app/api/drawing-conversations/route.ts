import { NextResponse } from "next/server";
import { z } from "zod";
import { OWNER_SCOPE } from "@/lib/domain";
import { createConversation, listConversations } from "@/lib/repositories/conversations";

export const runtime = "nodejs";

const createSchema = z.object({ title: z.string().trim().min(1).max(120).optional() });

export async function GET() {
  return NextResponse.json({ conversations: await listConversations(OWNER_SCOPE) });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_CONVERSATION", message: "会话标题无效。" }, { status: 400 });
  const conversation = await createConversation({ ownerScope: OWNER_SCOPE, title: parsed.data.title ?? "电气图纸分析" });
  return NextResponse.json({ conversation }, { status: 201 });
}
