# 天智图纸智能问询演示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户上传两张真实 DWG 后，在现有聊天框中可靠演示设备问询、跨图纸比较、BOM 和基础图纸审查。

**Architecture:** 分析阶段从 DWG 转换得到的原生 DXF 文本提取版本化结构快照并持久化；查询阶段使用确定性问询引擎聚合当前图纸或同一用户的多张图纸，视觉模型只作为补充。现有聊天 UI 的命令未命中分支调用新的会话问询 API。

**Tech Stack:** Next.js 16、TypeScript、Vitest、Prisma 7/SQLite、现有 DWG→DXF 渲染器、Python 真实 DWG 验证脚本。

## Global Constraints

- 原生 CAD 证据优先于视觉模型输出。
- 不配置模型 API 时，结构问询、BOM 和基础审查仍必须工作。
- 所有跨图纸读取必须限制在同一 `ownerScope`。
- 不宣称完成电气拓扑、保护整定、结构干涉或公差校核。
- `M-T1-01.dwg` 电流继电器验收值为 2 种、4 只；`M-T1-02.dwg` 为 2 种、7 只。

---

### Task 1: 原生 BOM 表格提取器

**Files:**
- Create: `src/lib/cad/native-bom.ts`
- Test: `src/lib/cad/native-bom.test.ts`
- Modify: `src/lib/cad/types.ts`

**Interfaces:**
- Consumes: `NormalizedDxfDrawing.texts`。
- Produces: `extractNativeBomRows(drawing): NativeBomRow[]` 和 `buildStructuralSnapshot(drawing, rendered): StructuralSnapshot`。

- [ ] 写合成表格红灯测试，断言 `KC1,2,3` 展开为三个代号且数量保留为 3。
- [ ] 运行 `npx vitest run src/lib/cad/native-bom.test.ts`，确认因模块不存在失败。
- [ ] 实现表头定位、同行聚类、列映射、代号展开和审查问题生成。
- [ ] 运行测试，确认通过，并提交 `feat: extract native CAD BOM evidence`。

### Task 2: 结构快照和原生 BOM 持久化

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/repositories/drawings.ts`
- Modify: `src/lib/repositories/components.ts`
- Modify: `src/lib/analysis/service.ts`
- Test: `src/lib/analysis/service.test.ts`

**Interfaces:**
- Consumes: `StructuralSnapshot`。
- Produces: `saveStructuralSnapshot(...)`、`listStructuralDrawings(...)`、`replaceBomFromNativeRows(...)`。

- [ ] 写红灯集成测试，断言分析器调用视觉模型前保存快照，并能从原生行生成 BOM。
- [ ] 运行目标测试，确认 `structuralSnapshot` 尚不存在而失败。
- [ ] 增加 Prisma JSON 字段、repository 方法，并在渲染完成后立即保存快照。
- [ ] 执行 `npx prisma generate && npx prisma db push` 后运行目标测试，确认通过，并提交 `feat: persist native drawing evidence`。

### Task 3: 确定性图纸问询引擎

**Files:**
- Create: `src/lib/chat/drawing-query.ts`
- Test: `src/lib/chat/drawing-query.test.ts`

**Interfaces:**
- Consumes: 当前图纸 ID、问题文本、`StructuralDrawingRecord[]`。
- Produces: `answerDrawingQuestion(input): DrawingQuestionAnswer`，包含 `text`、`evidence`、`intent`。

- [ ] 写红灯测试覆盖“几种类型”“多少只”“哪张最多”“在哪张图纸”“生成 BOM”“审查图纸”。
- [ ] 运行目标测试，确认模块不存在而失败。
- [ ] 实现问题意图、设备名称提取、数量/型号聚合、跨图纸排序和边界提示。
- [ ] 运行目标测试，确认 `M-T1-02` 为 7、`M-T1-01` 为 4，并提交 `feat: answer drawing evidence questions`。

### Task 4: 会话问询 API

**Files:**
- Create: `src/app/api/conversations/[id]/query/route.ts`
- Create: `src/app/api/conversations/[id]/query/route.test.ts`
- Modify: `src/lib/repositories/messages.ts`

**Interfaces:**
- Consumes: `{ question: string, drawingId: string }`。
- Produces: `{ answer: DrawingQuestionAnswer }` 并保存一条助手 `text` 消息。

- [ ] 写 API 红灯测试，覆盖无效请求、会话隔离、成功回答和助手消息保存。
- [ ] 运行目标测试，确认路由不存在而失败。
- [ ] 实现 Zod 校验、owner 限制、问询调用与消息持久化。
- [ ] 运行目标测试，确认通过，并提交 `feat: expose drawing question API`。

### Task 5: 聊天界面接入

**Files:**
- Modify: `src/components/drawing-workspace.tsx`
- Modify: `src/components/drawing-workspace.test.ts`

**Interfaces:**
- Consumes: 现有 `submit` 未处理分支。
- Produces: 调用 `/api/conversations/${conversationId}/query`，刷新后显示证据型助手回答。

- [ ] 修改 UI 测试，要求存在 query API 调用且旧占位回答消失，先运行并观察失败。
- [ ] 最小修改 `submit`，保留现有明确命令和分析触发逻辑，只替换未处理 fallback。
- [ ] 运行组件测试、完整测试、类型检查和 Lint，确认通过，并提交 `feat: connect drawing questions to chat`。

### Task 6: 真实 DWG 端到端烟测

**Files:**
- Create: `scripts/smoke-drawing-qa.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: 两张用户提供的真实 DWG 路径。
- Produces: 可重复执行的 `npm run smoke:drawing-qa` 验收输出。

- [ ] 先写烟测断言并运行，确认当前结构提取结果不满足 4/7 基准。
- [ ] 根据真实 DXF 表格坐标修正提取器，不写文件名特例。
- [ ] 运行 Python 7 项测试、两张 DWG gate、TypeScript 全量测试、typecheck、lint、build 和新烟测。
- [ ] 记录实际结果并提交 `test: verify drawing QA with real DWGs`。
