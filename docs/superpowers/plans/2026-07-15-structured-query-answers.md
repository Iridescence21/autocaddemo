# Structured Query Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make demo chat answers for drawing overview and cross-drawing device distribution stable, organized, and table-first.

**Architecture:** Keep the existing deterministic query pipeline in `src/lib/chat/drawing-query.ts`. Add small formatter helpers that render Markdown from stored CAD structural snapshots and native BOM rows; no model call and no new persistence fields.

**Tech Stack:** TypeScript, Vitest, existing Next.js API route and Prisma-backed structural snapshot data.

## Global Constraints

- Database remains the source of truth; answers must use stored `StructuralSnapshot` data.
- Do not fabricate title-block fields or counts; show only available extracted values.
- Keep behavior deterministic for demo reliability.
- Do not touch live provider configuration.

---

### Task 1: Structured Basic-Info Answers

**Files:**
- Modify: `src/lib/chat/drawing-query.ts`
- Test: `src/lib/chat/drawing-query.test.ts`

**Interfaces:**
- Consumes: `answerDrawingQuestion(input: DrawingQuestionInput): DrawingQuestionAnswer`
- Produces: structured Markdown when the question contains `基本信息`, `讲一下`, or asks what the drawing contains.

- [x] **Step 1: Write the failing test**

Add a test that asks `跟我讲一下这个图纸的基本信息` and expects the answer to include `基本信息`, bullets for parsed counts, and a Markdown table with `类型`, `原生标签`, and `初步数量`.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/chat/drawing-query.test.ts`
Expected: FAIL because the current overview answer is one paragraph and has no table.

- [x] **Step 3: Write minimal implementation**

Add helper functions for tag-range formatting and overview tables. Route basic-info questions to `overview`.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/chat/drawing-query.test.ts`
Expected: PASS.

### Task 2: Structured Cross-Drawing Distribution Answers

**Files:**
- Modify: `src/lib/chat/drawing-query.ts`
- Test: `src/lib/chat/drawing-query.test.ts`

**Interfaces:**
- Consumes: existing distribution and location intent path.
- Produces: table-first Markdown comparison plus conclusion bullets.

- [x] **Step 1: Write the failing test**

Update distribution/location tests to expect a Markdown table with `图纸`, the requested entity name, and `数量`, followed by conclusion bullets.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/chat/drawing-query.test.ts`
Expected: FAIL because current answer is a single sentence.

- [x] **Step 3: Write minimal implementation**

Replace the distribution text assembly with a deterministic table formatter and conclusion bullets. Preserve evidence and drawing IDs.

- [x] **Step 4: Run related tests**

Run: `npx vitest run src/lib/chat/drawing-query.test.ts src/app/api/conversations/[id]/query/route.test.ts`
Expected: PASS.

### Task 3: Verify Branch

**Files:**
- No additional code files.

**Interfaces:**
- Produces verified branch state.

- [x] **Step 1: Run full verification**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`.

- [x] **Step 2: Commit**

Commit message: `fix: structure drawing query answers`
