import { NextResponse } from "next/server";
import { OWNER_SCOPE } from "@/lib/domain";
import { getJobSnapshot } from "@/lib/repositories/drawings";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const job = await getJobSnapshot((await context.params).id, OWNER_SCOPE);
  return job ? NextResponse.json({ job }) : NextResponse.json({ code: "NOT_FOUND", message: "未找到分析任务。" }, { status: 404 });
}
