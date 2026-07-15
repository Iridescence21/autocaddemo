# Terminal Analysis Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every terminal analysis outcome emits a matching progress message so completed jobs show 100% and failed jobs stop displaying a loading spinner.

**Architecture:** Keep the database job record authoritative and mirror each status transition into the existing conversation message stream. Reuse one message helper for intermediate and terminal events; do not introduce frontend state, schema changes, or new APIs.

**Tech Stack:** TypeScript, Next.js 16, Prisma/SQLite, Vitest

## Global Constraints

- Successful jobs emit `progress: 100` with final status `completed` or `requires_review`.
- Failed jobs retain their actual stopping percentage and emit status `failed`.
- Existing error and result messages remain unchanged.
- No changes to DWG conversion, OpenAI analysis, retries, or database schema.

---

### Task 1: Emit terminal analysis progress messages

**Files:**
- Modify: `src/lib/analysis/service.ts`
- Test: `src/lib/analysis/service.test.ts`

**Interfaces:**
- Consumes: `appendMessage(conversationId, { ownerScope, role, type, payload })` and existing analysis job identifiers.
- Produces: terminal `analysis_progress` messages with payload `{ jobId, status, stage, progress }`.

- [ ] **Step 1: Write failing success and failure regression assertions**

Extend the existing successful analysis test to require the latest progress message to match the final job state:

```ts
const progressMessages = messages.filter((message) => message.type === "analysis_progress");
expect(progressMessages.at(-1)?.payload).toMatchObject({
  jobId: drawing.analysisJob?.id,
  status: "requires_review",
  stage: "分析完成",
  progress: 100,
});
```

Extend the existing failure persistence test to require a failed terminal message while retaining the real percentage:

```ts
const messages = await listMessages(conversation.id, "demo-user");
expect(messages.filter((message) => message.type === "analysis_progress").at(-1)?.payload).toMatchObject({
  jobId: drawing.analysisJob?.id,
  status: "failed",
  stage: "分析失败",
  progress: 68,
});
```

Extend the structural-only success test to require its terminal review event:

```ts
const messages = await listMessages(conversation.id, "demo-user");
expect(messages.filter((message) => message.type === "analysis_progress").at(-1)?.payload).toMatchObject({
  jobId: drawing.analysisJob?.id,
  status: "requires_review",
  stage: "CAD 结构分析完成（视觉识别受限）",
  progress: 100,
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/lib/analysis/service.test.ts
```

Expected: FAIL because the latest progress message remains at 92% on normal completion, 68% with status `analyzing` on failure, and 68% on structural-only completion.

- [ ] **Step 3: Add one helper for progress-message persistence**

Add this helper beside the existing progress function:

```ts
async function appendProgressMessage(
  conversationId: string,
  ownerScope: string,
  jobId: string,
  input: { status: string; stage: string; progress: number },
) {
  await appendMessage(conversationId, {
    ownerScope,
    role: "assistant",
    type: "analysis_progress",
    payload: { jobId, ...input },
  });
}
```

Change the intermediate `progress` helper to call `appendProgressMessage` after updating the job.

- [ ] **Step 4: Emit terminal messages on every terminal path**

After persisting a failed job, append:

```ts
await appendProgressMessage(current.drawing.conversationId, ownerScope, current.job.id, {
  status: "failed",
  progress: current.job.progress,
  stage: failure.stage,
});
```

After the structural-only job reaches its terminal review state, append:

```ts
await appendProgressMessage(snapshot.drawing.conversationId, ownerScope, snapshot.job.id, {
  status: "requires_review",
  progress: 100,
  stage: "CAD 结构分析完成（视觉识别受限）",
});
```

After the normal final job update, append:

```ts
await appendProgressMessage(snapshot.drawing.conversationId, ownerScope, snapshot.job.id, {
  status: finalStatus,
  progress: 100,
  stage: "分析完成",
});
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run src/lib/analysis/service.test.ts
```

Expected: all analysis-service tests pass.

- [ ] **Step 6: Run repository verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: 31 test files and at least 142 tests pass; type checking, linting, and production build exit with status 0.

- [ ] **Step 7: Review and commit the coherent change**

Inspect:

```bash
git diff --check
git diff -- src/lib/analysis/service.ts src/lib/analysis/service.test.ts
```

Commit:

```bash
git add src/lib/analysis/service.ts src/lib/analysis/service.test.ts docs/superpowers/plans/2026-07-15-terminal-analysis-progress.md
git commit -m "fix: emit terminal analysis progress"
```
