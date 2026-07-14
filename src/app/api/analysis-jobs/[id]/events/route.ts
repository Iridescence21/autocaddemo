import { getJobSnapshot } from "@/lib/repositories/drawings";
import { OWNER_SCOPE } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const jobId = (await context.params).id;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let index = 0; index < 40; index += 1) {
          const job = await getJobSnapshot(jobId, OWNER_SCOPE);
          if (!job) break;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "stage_progress", jobId, status: job.status, stage: job.stage, progress: job.progress })}\n\n`));
          if (["completed", "requires_review", "failed"].includes(job.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
