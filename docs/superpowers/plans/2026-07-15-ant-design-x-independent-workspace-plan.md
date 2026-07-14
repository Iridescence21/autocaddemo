# Ant Design X Independent Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current three-pane CAD analysis workspace with the screenshot-matched Ant Design X independent two-column chat workspace while preserving upload, analysis, review, BOM, and export behavior inside the conversation.

**Architecture:** Keep the existing APIs and `DrawingWorkspace` orchestration. Simplify `WorkspaceShell` to sidebar + main, make `ConversationSidebar` use the official grouped `Conversations` pattern, and render the official `Welcome`, `Prompts`, `Bubble.List`, `ThoughtChain`, `Think`, `Actions`, `Attachments`, `Sender.Header`, and compact `Sender` directly in the main chat surface. Inspector-only actions become inline messages or downloads.

**Tech Stack:** Next.js 16, React 19, TypeScript, Ant Design 6, `@ant-design/x` 2.8, `@ant-design/x-markdown`, Vitest, CSS Modules.

## Global Constraints

- Use `/var/folders/xl/6dsz726x6597g1vr0bhx683m0000gn/T/codex-clipboard-1da8154a-f351-4dc4-8d83-a0b0a8083de9.png` as the visual target.
- Follow `packages/x/docs/playground/independent.tsx` from `https://github.com/ant-design/x` for component composition.
- Do not keep `WorkspaceInspector`, the right detail rail, or a separate file browser in the rendered workspace.
- Do not recreate Ant Design X component internals; only use layout CSS and documented `styles`/`classNames` hooks.
- Keep existing API contracts and backend behavior unchanged.
- Use `@ant-design/icons` for visible icons.

---

### Task 1: Lock the official-component and two-column UI contract

**Files:**
- Modify: `src/components/drawing-workspace.test.ts`
- Modify: `src/components/drawing-message-list.test.ts`

**Interfaces:**
- Consumes: current source-file contract tests.
- Produces: failing assertions requiring the official independent-workspace component composition and prohibiting the inspector rail.

- [ ] **Step 1: Write failing workspace tests**

Replace the three-pane and Agent Sender expectations with assertions equivalent to:

```ts
expect(source).toContain("Attachments, Bubble, Prompts, Sender, Welcome");
expect(source).toContain("<Sender.Header");
expect(source).toContain("allowSpeech");
expect(source).toContain("<Welcome");
expect(source).toContain("<Prompts");
expect(source).not.toContain("WorkspaceInspector");
expect(source).not.toContain("inspector=");
expect(shell).not.toContain("rightOpen");
expect(styles).toContain("grid-template-columns: 280px minmax(0, 1fr)");
```

Add message-list assertions for one `Bubble.List` fed by all mapped items and official inline actions:

```ts
expect(source).toContain("<Bubble.List");
expect(source).toContain("ThoughtChain");
expect(source).toContain("Think");
expect(source).toContain("Actions");
expect(source).not.toContain("onOpenInspector");
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run src/components/drawing-workspace.test.ts src/components/drawing-message-list.test.ts
```

Expected: failures mentioning `WorkspaceInspector`, missing `Sender.Header`, old three-pane columns, and `onOpenInspector`.

- [ ] **Step 3: Commit the test contract after implementation reaches green**

```bash
git add src/components/drawing-workspace.test.ts src/components/drawing-message-list.test.ts
git commit -m "test: define independent Ant Design X workspace"
```

### Task 2: Build the official two-column shell and welcome experience

**Files:**
- Modify: `src/components/workspace-shell.tsx`
- Modify: `src/components/conversation-sidebar.tsx`
- Modify: `src/components/drawing-workspace.tsx`
- Modify: `src/components/drawing-workspace.module.css`

**Interfaces:**
- Consumes: existing conversation CRUD, upload, submit, cancel, and polling functions in `DrawingWorkspace`.
- Produces: `WorkspaceShell({ sidebar, children })`, grouped `ConversationSidebar`, official empty-state prompts, and official compact Sender.

- [ ] **Step 1: Simplify the shell**

Change the public shell contract to:

```ts
export default function WorkspaceShell({ sidebar, children }: {
  sidebar: ReactNode;
  children: ReactNode;
})
```

Render only the desktop sidebar, main section, one mobile menu button, and one left `Drawer`. Remove inspector props, right drawer state, and engineering-detail controls.

- [ ] **Step 2: Match the official Conversations composition**

Use `Conversations` with:

```tsx
<Conversations
  creation={{ label: "开启新分析", onClick: onCreate }}
  items={items}
  activeKey={activeKey}
  onActiveChange={onActiveChange}
  groupable
  menu={() => ({ items: renameAndDeleteItems, onClick: handleMenu }))}
/>
```

Add the compact brand header and Ant Design `Avatar`/help button footer. Remove the sidebar `Welcome` warning card.

- [ ] **Step 3: Replace the empty state with official Welcome and Prompts**

Render a borderless `Welcome` followed by three CAD-specific prompt groups. Each item calls the existing submit or attachment flow. Use `Prompts.styles` for the light blue/lilac official card treatment and CSS only for the outer grid.

- [ ] **Step 4: Replace the Agent footer with the official compact Sender**

Implement the official independent-demo composition:

```tsx
<Sender
  value={senderValue}
  header={senderHeader}
  prefix={<Button type="text" icon={<PaperClipOutlined />} />}
  allowSpeech
  loading={loading}
  onSubmit={handleSenderSubmit}
  onCancel={handleCancel}
/>
```

`senderHeader` must be `Sender.Header` containing `Attachments`; the upload area opens only when the paperclip is clicked. Keep a compact `Prompts` row above Sender.

- [ ] **Step 5: Implement the two-column and responsive CSS**

Set the desktop shell to `280px minmax(0, 1fr)`, main content to a centered maximum width of 840px, and the composer to the bottom of the main flex column. At `< 900px`, hide the fixed sidebar and use the existing left Drawer. Remove all `.inspector*`, `.fileBrowser`, and right-rail layout rules.

- [ ] **Step 6: Run Task 1 tests until green**

Run:

```bash
npx vitest run src/components/drawing-workspace.test.ts
```

Expected: all workspace tests pass.

### Task 3: Move result navigation into the official message stream

**Files:**
- Modify: `src/components/drawing-message-list.tsx`
- Modify: `src/components/drawing-workspace.tsx`
- Modify: `src/components/drawing-message-list.test.ts`
- Delete from rendered dependency graph: `src/components/workspace-inspector.tsx`, `src/components/result-inspectors.tsx`, `src/components/session-files-panel.tsx`

**Interfaces:**
- Consumes: `MessageRecord[]`, `buildMessageView`, retry and download callbacks.
- Produces: `DrawingMessageList({ messages, onRetry, onExport })` with one official `Bubble.List` and inline `Actions`.

- [ ] **Step 1: Convert the message list to one Bubble.List**

Map all non-system records into `BubbleItemType[]` and pass the array once:

```tsx
<Bubble.List
  items={items}
  role={{
    user: { placement: "end", variant: "filled" },
    ai: { placement: "start", variant: "borderless" },
  }}
/>
```

Keep `ThoughtChain` for job progress, `Think`/`Sources` for rationale, `XMarkdown` for text, and `FileCard` for uploaded drawing messages.

- [ ] **Step 2: Replace inspector actions**

Remove `onOpenInspector`. Use `Actions` for copy/retry/export. Component, review, and BOM messages keep their content inline; the export action invokes the existing `downloadBom` callback.

- [ ] **Step 3: Remove inspector state and render dependencies**

Delete `inspectorView`, `selectedComponent`, inspector JSX, and all `setInspectorView` calls from `DrawingWorkspace`. Commands should append result messages through existing APIs; filter commands no longer navigate to a panel.

- [ ] **Step 4: Run focused tests and type checking**

```bash
npx vitest run src/components/drawing-workspace.test.ts src/components/drawing-message-list.test.ts src/components/workspace-model.test.ts
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

### Task 4: Browser verification and design QA

**Files:**
- Modify: `design-qa.md`
- Create/replace: `design-qa-assets/independent-workspace-*.png`

**Interfaces:**
- Consumes: local URL and selected screenshot.
- Produces: browser-verified visual evidence and `final result: passed`.

- [ ] **Step 1: Start or reuse the dev server**

```bash
npm run dev
```

Expected: `http://localhost:3000/` responds with HTTP 200.

- [ ] **Step 2: Verify primary interactions in the in-app browser**

Check creation/switching, prompt selection, attachment header open/close, Sender typing/send state, speech control presence, and message action availability. Check console errors.

- [ ] **Step 3: Capture and compare**

Capture the local empty state at 1280×720, combine it side by side with the reference screenshot, inspect full view and focused sidebar/composer regions, and fix every P0/P1/P2 mismatch.

- [ ] **Step 4: Run final verification**

```bash
npx vitest run src/components/drawing-workspace.test.ts src/components/drawing-message-list.test.ts src/components/workspace-model.test.ts
npm run typecheck
npm run lint
npx next build --webpack
```

Expected: focused tests, typecheck, lint, and webpack production build pass. Record any unrelated pre-existing full-suite failure separately.

- [ ] **Step 5: Save QA result**

Update `design-qa.md` with source and implementation paths, viewport/state, full and focused comparison evidence, tested interactions, console result, comparison history, and the exact terminal line:

```text
final result: passed
```
