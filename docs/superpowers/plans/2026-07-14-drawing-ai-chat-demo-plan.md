# Electrical Drawing AI Chat Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a standalone Ant Design X chat demo for DWG/DXF drawing analysis, component review, preliminary BOM generation, export, and conversation persistence.

**Architecture:** Next.js App Router with Ant Design X 2.x and Ant Design 6.x provides the three-pane chat/workspace UI. Prisma 7 + SQLite stores conversations, messages, drawings, jobs, components, and BOM rows; local private storage stores one CAD attachment. A server-owned deterministic demo analysis service emits progress and structured components, while renderer/model adapters remain replaceable.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, `@ant-design/x` 2.8.0, `@ant-design/x-sdk` 2.8.0, `@ant-design/x-markdown` 2.8.0, `antd` 6.5.1, `@ant-design/icons` 6.3.2, `@ant-design/nextjs-registry` 1.3.0, Prisma 7, SQLite, Zod, Vitest, and Playwright/browser verification.

## Global Constraints

- Ant Design X is the primary chat UI; do not introduce another chat component library.
- Accept one `.dwg` or `.dxf` file per conversation; validate server-side beyond the extension.
- AutoCAD desktop is not required; demo CAD rendering and AI analysis are fixture-backed and clearly labeled.
- Do not call AI providers from the browser or trust unvalidated model/tool output.
- Every component result displays confidence, evidence/method, and review status.
- Missing manufacturer/model/SKU information is never invented.
- Uploaded files remain outside `public` and all records are scoped to the local demo owner.
- Use current Ant Design X v2 APIs: `Sender.suffix`, `Sender.onPasteFile`, standalone `FileCard`, and `ThoughtChain` without private reasoning.
- Do not modify the existing repositories.

---

### Task 1: Complete standalone app dependencies and SSR provider

**Files:**
- Modify: `package.json`
- Create: `src/app/providers.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Record installed versions and inspect type declarations**

Run `node -e "..."` to print versions for the six Ant Design packages and inspect `node_modules/@ant-design/x/es/{sender,attachments,conversations,thought-chain}` declarations. Use only APIs present in the installed packages.

- [ ] **Step 2: Add SSR provider wiring**

Wrap the app with `AntdRegistry` and `XProvider` in a client-safe provider boundary. Apply the product theme tokens, locale, and warning styles without a second design system.

- [ ] **Step 3: Run baseline checks**

Run `npm run typecheck` and `npm run lint`. Expected: the scaffold passes after any necessary config-only fixes.

- [ ] **Step 4: Commit the UI foundation**

```bash
git add package.json package-lock.json src/app
git commit -m "feat: add Ant Design X application foundation"
```

### Task 2: Define persisted demo domain and repositories

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma.config.ts`
- Create: `src/lib/db.ts`
- Create: `src/lib/domain.ts`
- Create: `src/lib/repositories/conversations.ts`
- Create: `src/lib/repositories/drawings.ts`
- Create: `src/lib/repositories/components.ts`
- Create: `src/lib/repositories/messages.ts`
- Test: `src/lib/repositories/domain.test.ts`

**Interfaces:**
- `ConversationStatus` and `DrawingChatMessage` unions from `src/lib/domain.ts`.
- `createConversation()`, `listConversations()`, `getConversation(id)`, `updateConversation(id, patch)`, and `deleteConversation(id)`.
- `createDrawingUpload()`, `getDrawingForOwner()`, `updateAnalysisStatus()`, and `getAnalysisSnapshot()`.
- `appendMessage()`, `listMessages()`, `updateComponent()`, `removeComponent()`, `generateBom()`.

- [ ] **Step 1: Write failing persistence tests**

Test conversation creation/reopen, message ordering, drawing ownership, component edit/remove persistence, and BOM regeneration after edits.

- [ ] **Step 2: Run tests and confirm RED**

Run `npm test -- src/lib/repositories/domain.test.ts --run`. Expected: FAIL because models/repositories do not exist.

- [ ] **Step 3: Implement Prisma models and repositories**

Persist owner scope on every record. Store message payload JSON plus message type. Store component evidence JSON, confidence, review status, and original/corrected values. Store export records and BOM snapshots.

- [ ] **Step 4: Push schema and run GREEN**

Run `npm run db:push && npm test -- src/lib/repositories/domain.test.ts --run`. Expected: PASS.

- [ ] **Step 5: Commit domain persistence**

```bash
git add prisma prisma.config.ts src/lib src/lib/repositories
git commit -m "feat: persist drawing conversations and results"
```

### Task 3: Implement secure DWG/DXF upload and demo adapters

**Files:**
- Create: `src/lib/uploads/validation.ts`
- Create: `src/lib/uploads/storage.ts`
- Create: `src/lib/cad/types.ts`
- Create: `src/lib/cad/demo-renderer.ts`
- Create: `src/lib/cad/demo-analyzer.ts`
- Create: `src/lib/cad/registry.ts`
- Create: `fixtures/cad/control-panel-a.dwg`
- Create: `fixtures/cad/motor-cabinet-02.dxf`
- Create: `fixtures/analysis/control-panel-a.json`
- Test: `src/lib/uploads/validation.test.ts`
- Test: `src/lib/cad/demo-adapters.test.ts`

- [ ] **Step 1: Write failing validation/adapter tests**

Cover valid `.dwg` and `.dxf`, unsupported extension, wrong signature, size limit, unsafe filename, renderer tiles, controlled categories, bounded normalized locations, and unknown values.

- [ ] **Step 2: Run focused tests and confirm RED**

Run `npm test -- src/lib/uploads/validation.test.ts src/lib/cad/demo-adapters.test.ts --run`. Expected: FAIL.

- [ ] **Step 3: Implement server validation/private storage**

Validate the filename, MIME, bounded header/signature, byte limit, and exactly one file. Store under `data/uploads/<drawingId>/safe-name`; never use the original filename as a path.

- [ ] **Step 4: Implement deterministic demo renderer/analyzer**

Return overview and overlapping tile metadata from the fixture adapter. Validate fixture output with Zod and restrict categories to the allowed enum. Add the engineer-verification warning to every result.

- [ ] **Step 5: Run tests and commit**

Run `npm test -- src/lib/uploads/validation.test.ts src/lib/cad/demo-adapters.test.ts --run` and commit the passing adapter boundary.

### Task 4: Add conversation/file/message APIs and Ant Design X chat shell

**Files:**
- Create: `src/app/api/drawing-conversations/route.ts`
- Create: `src/app/api/drawing-conversations/[id]/route.ts`
- Create: `src/app/api/conversations/[id]/messages/route.ts`
- Create: `src/app/api/drawings/upload/route.ts`
- Create: `src/app/api/drawings/[id]/route.ts`
- Create: `src/components/drawing-workspace.tsx`
- Create: `src/components/conversation-sidebar.tsx`
- Create: `src/components/chat-transcript.tsx`
- Create: `src/components/chat-composer.tsx`
- Create: `src/components/analysis-workspace.tsx`
- Modify: `src/app/page.tsx`
- Test: `src/lib/chat/commands.test.ts`

- [ ] **Step 1: Write command tests**

Test deterministic parsing of filter, select, update, delete, generate BOM, export BOM, and review commands. Reject ambiguous or unauthorized targets.

- [ ] **Step 2: Run command tests and confirm RED**

Run `npm test -- src/lib/chat/commands.test.ts --run`. Expected: FAIL.

- [ ] **Step 3: Implement APIs with Zod and owner scoping**

Create/reopen/rename/delete conversations, append/list typed messages, upload/link a drawing, and return analysis snapshots. Ensure no API accepts arbitrary operations or cross-conversation IDs.

- [ ] **Step 4: Implement Ant Design X shell**

Use `Conversations`, `Welcome`, `Prompts`, `Bubble.List`, `Sender`, `Sender.Header`, `Attachments`, `FileCard`, `ThoughtChain`, `Actions`, and `X Markdown`. Use `useXConversations` for active list state and reconcile it with persisted server data. Render explicit empty, attachment, loading, error, and result message variants.

- [ ] **Step 5: Run typecheck/lint and commit shell/API**

Run `npm run typecheck && npm run lint`. Expected: PASS.

### Task 5: Implement analysis progress, results, edits, BOM, and export

**Files:**
- Create: `src/lib/analysis/service.ts`
- Create: `src/lib/analysis/stages.ts`
- Create: `src/lib/bom.ts`
- Create: `src/lib/export.ts`
- Create: `src/app/api/drawings/[id]/analyze/route.ts`
- Create: `src/app/api/analysis-jobs/[id]/route.ts`
- Create: `src/app/api/analysis-jobs/[id]/events/route.ts`
- Create: `src/app/api/drawings/[id]/components/route.ts`
- Create: `src/app/api/drawings/[id]/components/[componentId]/route.ts`
- Create: `src/app/api/drawings/[id]/bom/route.ts`
- Create: `src/app/api/drawings/[id]/exports/route.ts`
- Test: `src/lib/analysis/service.test.ts`
- Test: `src/lib/bom.test.ts`
- Test: `src/lib/export.test.ts`

- [ ] **Step 1: Write failing analysis/BOM/export tests**

Assert real persisted stage transitions, partial-result events, review statuses, component edits/removals, BOM aggregation, CSV export content, and safe failure recovery.

- [ ] **Step 2: Run focused tests and confirm RED**

Run `npm test -- src/lib/analysis/service.test.ts src/lib/bom.test.ts src/lib/export.test.ts --run`. Expected: FAIL.

- [ ] **Step 3: Implement analysis service and event stream**

Run the demo renderer/analyzer server-side, persist stage events, append progress/result messages, and expose SSE with polling-compatible snapshot fallback. Use real persisted state rather than a client-only timer.

- [ ] **Step 4: Implement component edit/delete and controlled commands**

Require validated component IDs, persist user corrections, regenerate summary/BOM, and append confirmation messages. Keep removed components out of BOM while preserving audit history.

- [ ] **Step 5: Implement BOM and CSV export**

Aggregate active components by category/tag/specification, preserve confidence/review state, use explicit missing-data labels, and return a controlled download response.

- [ ] **Step 6: Run focused tests and commit**

Run the three focused test files plus `npm run typecheck`. Expected: PASS.

### Task 6: Finish workspace interactions and responsive states

**Files:**
- Modify: `src/components/drawing-workspace.tsx`
- Modify: `src/components/analysis-workspace.tsx`
- Modify: `src/components/chat-transcript.tsx`
- Modify: `src/components/chat-composer.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/drawing-workspace.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Cover component selection/table-marker synchronization, edit/confirm/remove actions, contextual prompts, export action, retry, and mobile drawer state.

- [ ] **Step 2: Implement drawing/components/BOM/review tabs**

Use a fixture overview with approximate markers, editable component table, BOM table, and review filters. Clearly label demo rendering and preliminary AI results.

- [ ] **Step 3: Add responsive/accessibility behavior**

Use drawers/tabs below desktop width, keyboard-accessible sender and conversations, accessible upload labels, non-color-only confidence markers, and focus-safe dialogs.

- [ ] **Step 4: Run tests, typecheck, lint, and commit**

Run `npm test -- src/components/drawing-workspace.test.tsx --run && npm run typecheck && npm run lint`.

### Task 7: Verify the end-to-end demonstration

**Files:**
- Create: `tests/e2e/drawing-chat.spec.ts`
- Create: `docs/DEMO-REPORT.md`

- [ ] **Step 1: Start the app and database**

Run `npm run db:push` and `npm run dev`.

- [ ] **Step 2: Run the full automated suite**

Run `npm test -- --run`, `npm run typecheck`, `npm run lint`, and `npm run build`.

- [ ] **Step 3: Verify in the browser at desktop/tablet/mobile widths**

Create a conversation, attach the fixture DWG, send “Analyze this drawing”, observe upload/progress, inspect components, edit/confirm one, ask for BOM, export, reload, and verify persistence. Capture responsive and error states.

- [ ] **Step 4: Add the deterministic E2E test**

Use the fixture adapters and assert conversation persistence, progress/result messages, component edit, BOM generation, export success, and no cross-conversation leakage.

- [ ] **Step 5: Write the final demo report**

Record installed versions, Ant Design X components, architecture, adapters, APIs, commands, test results, browser evidence, limitations, and the recommended production milestone.

