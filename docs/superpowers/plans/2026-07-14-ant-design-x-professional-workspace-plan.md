# Ant Design X 专业图纸分析工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**目标：** 将现有单列图纸聊天页重构为左会话、中对话、右工程检查器的专业工作台，并真实接入 Ant Design X 的消息、思考、任务链、文件、来源和输入组件。

**架构：** `DrawingWorkspace` 保留请求与业务动作，纯函数模块生成消息和当前会话文件模型，展示组件分别负责壳层、消息流、输入区与右侧检查器。所有宏观布局集中到 CSS Module，业务组件优先使用 Ant Design X 官方组件和语义插槽。

**技术栈：** Next.js 16、React 19、TypeScript、Ant Design X 2.8、Ant Design 6、Vitest、CSS Modules。

---

## Task 1：建立共享类型和当前会话文件模型

**文件：**
- 新建：`src/components/workspace-types.ts`
- 新建：`src/components/workspace-model.ts`
- 新建：`src/components/workspace-model.test.ts`

**步骤 1：先写失败测试**

测试 `buildSessionFileGroups` 只从当前 `Drawing` 和当前消息生成三组文件：原始图纸、分析产物、导出结果；断言不存在预览或导出消息时不伪造可下载文件。

```ts
expect(buildSessionFileGroups(drawing, messages).map((group) => group.key))
  .toEqual(["source", "artifacts", "exports"]);
expect(groups[0].files[0].name).toBe("cabinet.dxf");
expect(groups[2].files[0].name).toBe("元件分析清单.xlsx");
```

**步骤 2：验证 RED**

运行：`npm test -- src/components/workspace-model.test.ts`

预期：模块不存在或导出不存在，测试失败。

**步骤 3：最小实现并验证 GREEN**

实现共享类型、文件分组、计数与状态标签纯函数；运行同一测试，预期通过。

**步骤 4：提交**

```bash
git add src/components/workspace-types.ts src/components/workspace-model.ts src/components/workspace-model.test.ts
git commit -m "feat: model workspace files and status"
```

## Task 2：建立三段式壳层、主题和会话栏

**文件：**
- 新建：`src/components/drawing-workspace.module.css`
- 新建：`src/components/workspace-shell.tsx`
- 新建：`src/components/conversation-sidebar.tsx`
- 修改：`src/app/providers.tsx`
- 修改：`src/components/drawing-workspace.test.ts`

**步骤 1：先写失败测试**

更新源码结构测试，要求存在 `WorkspaceShell`、`ConversationSidebar`、CSS Module、响应式媒体查询，并禁止 `minWidth: 1000` 和页面级内联网格。

**步骤 2：验证 RED**

运行：`npm test -- src/components/drawing-workspace.test.ts`

预期：新组件和样式文件尚不存在，测试失败。

**步骤 3：最小实现并验证 GREEN**

实现三列 CSS Grid 壳层；桌面固定左右栏，窄屏隐藏侧栏并提供抽屉入口。会话栏真实使用 `Conversations` 和紧凑品牌/复核提示。通过 `XProvider` 统一主色、背景、圆角和阴影令牌。

运行：`npm test -- src/components/drawing-workspace.test.ts`

**步骤 4：提交**

```bash
git add src/components/drawing-workspace.module.css src/components/workspace-shell.tsx src/components/conversation-sidebar.tsx src/app/providers.tsx src/components/drawing-workspace.test.ts
git commit -m "feat: add responsive three-pane workspace shell"
```

## Task 3：重构消息流，区分 AI 思考和 CAD 任务链

**文件：**
- 新建：`src/components/drawing-message-list.tsx`
- 新建：`src/components/drawing-message-list.test.ts`
- 修改：`src/components/workspace-model.ts`

**步骤 1：先写失败测试**

测试消息展示模型：用户文本为 `user`，错误为 `system`，图纸摘要包含公开识别依据，进度消息生成真实任务阶段；覆盖受限警告持续可见。

```ts
expect(buildMessageView(errorMessage).role).toBe("system");
expect(buildMessageView(summaryMessage).showThink).toBe(true);
expect(buildMessageView(progressMessage).showTaskChain).toBe(true);
```

**步骤 2：验证 RED**

运行：`npm test -- src/components/drawing-message-list.test.ts`

**步骤 3：最小实现并验证 GREEN**

使用 `Bubble.List`、`Bubble.System`、`Bubble.Divider`、`Think`、`ThoughtChain`、`Actions`、`FileCard`、`Sources` 和 `XMarkdown` 渲染消息。`Think` 只显示可公开的识别依据摘要，`ThoughtChain` 只显示后台任务阶段。

运行：`npm test -- src/components/drawing-message-list.test.ts`

**步骤 4：提交**

```bash
git add src/components/drawing-message-list.tsx src/components/drawing-message-list.test.ts src/components/workspace-model.ts
git commit -m "feat: render rich Ant Design X drawing messages"
```

## Task 4：实现完整智能输入区

**文件：**
- 新建：`src/components/analysis-composer.tsx`
- 新建：`src/components/analysis-composer.test.ts`
- 修改：`src/components/drawing-workspace.module.css`

**步骤 1：先写失败测试**

测试快捷建议到真实命令的映射，以及附件限制和分析模式标签。

```ts
expect(commandForSuggestion("review")).toBe("显示需要工程师复核的项目");
expect(commandForSuggestion("export")).toBe("导出 BOM");
```

**步骤 2：验证 RED**

运行：`npm test -- src/components/analysis-composer.test.ts`

**步骤 3：最小实现并验证 GREEN**

用 `Suggestion` 包裹 `Sender`，接入 `Sender.Header`、`Sender.Switch`、`Attachments`、prefix、footer、粘贴文件、发送中/取消状态。开关只控制真实的“完整识别”默认指令，不虚构后端能力。

运行：`npm test -- src/components/analysis-composer.test.ts`

**步骤 4：提交**

```bash
git add src/components/analysis-composer.tsx src/components/analysis-composer.test.ts src/components/drawing-workspace.module.css
git commit -m "feat: add Ant Design X analysis composer"
```

## Task 5：实现右侧工程检查器与当前会话文件区

**文件：**
- 新建：`src/components/workspace-inspector.tsx`
- 新建：`src/components/session-files-panel.tsx`
- 新建：`src/components/result-inspectors.tsx`
- 新建：`src/components/workspace-inspector.test.ts`
- 修改：`src/components/drawing-workspace.module.css`

**步骤 1：先写失败测试**

源码测试要求五个页签“图纸 / 文件 / 元件 / 复核 / BOM”，并要求文件页真实使用 `Folder` 与 `FileCard`、元件证据真实使用 `Sources`。

**步骤 2：验证 RED**

运行：`npm test -- src/components/workspace-inspector.test.ts`

**步骤 3：最小实现并验证 GREEN**

使用 Ant Design `Tabs` 组织工程信息，用 X `Folder` 展示三组文件、`FileCard` 展示选中文件、`Sources` 展示图层/块/文字/识别证据，保留确认、改类、移除、生成与 Excel 导出动作。

运行：`npm test -- src/components/workspace-inspector.test.ts`

**步骤 4：提交**

```bash
git add src/components/workspace-inspector.tsx src/components/session-files-panel.tsx src/components/result-inspectors.tsx src/components/workspace-inspector.test.ts src/components/drawing-workspace.module.css
git commit -m "feat: add drawing inspector and session file browser"
```

## Task 6：接回业务容器并完成回归

**文件：**
- 修改：`src/components/drawing-workspace.tsx`
- 修改：`src/components/drawing-workspace.test.ts`

**步骤 1：先写失败测试**

更新集成断言，要求容器使用拆分组件、仍保留中文复核警告、符号实例/物理设备语义和 Excel 文件名，并不再声明旧 `WorkspaceResult`。

**步骤 2：验证 RED**

运行：`npm test -- src/components/drawing-workspace.test.ts`

**步骤 3：最小实现并验证 GREEN**

将现有网络请求、轮询、命令处理、附件校验和结果更新动作连接到新展示组件。结果页签联动由容器持有，消息和文件卡片可切到对应检查器。

运行：`npm test -- src/components/drawing-workspace.test.ts`

**步骤 4：完整验证**

```bash
npm test
npm run typecheck
npm run lint
npm run build -- --webpack
```

已知基线：领域仓储测试中存在一条与本次 UI 无关的级联删除失败；验收时必须明确区分该基线失败与新增回归。

**步骤 5：浏览器视觉检查**

启动本地服务，检查桌面三栏、空会话、完成结果、当前会话文件区及 768px 以下响应式布局；修正控制台错误、溢出、遮挡和不可点击元素。

**步骤 6：提交**

```bash
git add src/components/drawing-workspace.tsx src/components/drawing-workspace.test.ts
git commit -m "feat: integrate professional drawing analysis workspace"
```

