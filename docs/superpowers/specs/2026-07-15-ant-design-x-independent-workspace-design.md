# Ant Design X 双栏独立式工作台设计

## 目标

将当前三栏电气图纸分析工作台改造成 Ant Design X 官方 `independent.tsx` 演示同类的双栏对话界面：左侧是会话管理，右侧是欢迎页、消息流和固定输入区。删除右侧“工程详情 / 文件 / 元件 / 复核 / BOM”面板，不再保留独立文件区。

界面必须直接引用 `@ant-design/x` 与 `antd` 组件，不重新实现会话列表、欢迎组件、提示词集合、消息气泡、思考过程、附件面板或输入框。

官方参考：

- 仓库：<https://github.com/ant-design/x>
- 独立式工作台源码：`packages/x/docs/playground/independent.tsx`
- 组件目录：`packages/x/components`

## 方案选择

采用方案 A：完整双栏改造。

- 左侧：品牌、创建会话、按日期分组的会话列表、会话菜单、用户区。
- 右侧：空会话欢迎页或活动会话消息流，底部固定快捷提示与输入框。
- 原右侧检查器中的分析结果改为聊天消息中的结构化内容和操作，不再通过独立面板呈现。

不采用只修改首页外观后恢复旧三栏布局的混合方案，也不采用丢失业务功能的静态复刻方案。

## 官方组件映射

| 视觉或业务区域 | 直接引用组件 | 用法 |
| --- | --- | --- |
| 全局主题和中文配置 | `XProvider` | 延续现有全局 Provider，统一 Ant Design X 主题与语言 |
| 会话管理 | `Conversations` | 使用 `creation`、`groupable`、`activeKey`、`menu` 实现新建、分组、切换、重命名和删除 |
| 欢迎标题 | `Welcome` | 使用 `variant="borderless"`，展示电气图纸 AI 名称、说明和右上角操作 |
| 首页快捷卡片 | `Prompts` | 分别渲染“热门分析”“工程能力”“快速任务”三组 CAD 专业入口 |
| 输入框上方快捷项 | `Prompts` | 显示完整识别、元件筛选、工程复核、生成 BOM 等紧凑提示 |
| 消息流 | `Bubble.List` | 用户消息右对齐，助手消息左对齐，统一加载、成功、失败状态 |
| 分析状态 | `ThoughtChain.Item` | 在助手消息头显示排队、转换、分析、完成、失败或中止状态 |
| 深度思考内容 | `Think` | 折叠展示模型分析思路与过程，不自制思考面板 |
| 消息操作 | `Actions` | 提供复制、重试、反馈、导出等消息级操作 |
| Markdown 内容 | `XMarkdown` | 渲染流式文本、列表、表格和结构化分析说明 |
| 上传区域 | `Attachments` + `Sender.Header` | 点击输入框附件按钮后展开官方上传面板；不创建独立文件区 |
| 输入区 | `Sender` | 使用 `prefix`、`header`、`loading`、`allowSpeech`、`onSubmit`、`onCancel` |
| 文件消息 | `FileCard` | 仅在当前对话消息内展示待上传或已上传图纸，不形成独立文件浏览器 |
| 基础布局与按钮 | `Flex`、`Button`、`Avatar`、`Drawer` | 使用 Ant Design 的布局、按钮和移动端会话抽屉 |

## 页面结构

### 左侧会话栏

桌面端宽度按官方示例保持约 260–280px，使用浅灰布局背景。顶部显示电气图纸 AI 品牌和图标；`Conversations` 自带创建入口，条目按“今天 / 昨天 / 更早”分组。每个会话通过官方菜单提供重命名和删除。底部显示用户头像和帮助按钮。

移动端不常驻左栏，使用 Ant Design `Drawer` 展示同一份 `Conversations` 内容。

### 空会话欢迎页

主内容最大宽度约 840px并水平居中。顶部 `Welcome` 使用 CAD 业务文案：欢迎使用电气图纸 AI，以及支持 DWG/DXF、元件识别、工程复核和初步 BOM 的说明。

欢迎区下方使用三组 `Prompts`：

1. 热门分析：完整识别、筛选接触器、查看待复核项、生成 BOM、导出结果。
2. 工程能力：符号实例、物理设备、工程复核、BOM 汇总。
3. 快速任务：上传并分析图纸、查看识别规则。

卡片使用 Ant Design X `Prompts.styles` 调整布局和背景，但不重新实现卡片组件。

### 活动会话消息流

存在消息时用 `Bubble.List` 替代欢迎页。现有后端消息记录继续作为数据源：

- 用户指令使用 `role="user"`。
- 文本结果、分析进度、错误和结构化结果映射为助手消息。
- 分析作业状态在消息头使用 `ThoughtChain.Item`。
- 思考内容使用 `Think`。
- 识别摘要、元件分组、复核列表和 BOM 内容直接出现在消息正文或消息级结构化块中。
- 复制、重试、确认、导出等操作使用 `Actions`。

原本通过 `setInspectorView` 打开右侧面板的命令，改为向当前消息流追加对应结果或定位到相关结构化消息。BOM 导出继续调用现有 API，并由消息操作触发下载。

### 底部输入区

底部区域与官方示例一致，由紧凑 `Prompts` 和单个 `Sender` 构成，最大宽度约 840px并居中。

- 附件图标放在 `Sender.prefix`。
- 点击附件图标切换 `Sender.Header`，其中直接渲染 `Attachments`。
- `Sender.allowSpeech` 开启官方语音入口。
- 提交、停止和加载状态完全使用 `Sender` 原生能力。
- 不使用自制 Chat Box，不替换 `Sender` 内部 textarea，不伪造发送按钮。

## 数据流与现有能力

保留当前后端、数据库和分析流程：会话 API、图纸上传、分析任务、元件操作、BOM 生成和 Excel 导出均不改变接口。

前端数据流：

1. `Conversations` 切换会话后加载会话详情和消息。
2. `Attachments` 选择 DWG/DXF 后沿用文件类型和 25MB 校验。
3. `Sender` 提交时先上传待处理文件，再追加用户消息并触发分析或命令。
4. 分析进度轮询继续更新消息数据。
5. `Bubble.List` 根据消息状态重新渲染思考链、结果和操作。

## 错误与空状态

- 非 DWG/DXF、文件过大和上传失败通过 `Bubble.System` 显示在消息流或输入区上方。
- 无图纸时执行分析命令，助手消息明确提示先上传文件。
- 分析失败显示 `ThoughtChain.Item status="error"`，并提供 `Actions` 重试。
- 空会话显示欢迎页；已创建但暂无文件的会话仍允许直接上传。

## 视觉约束

- 布局、间距和层级以用户提供截图与官方 `independent.tsx` 为基准。
- 使用 Ant Design 设计令牌控制颜色、圆角、阴影和间距。
- 只允许外围布局 CSS 和官方组件暴露的 `styles` / `classNames` 定制；不得复制组件内部 DOM 或重写组件外观。
- 图标使用 `@ant-design/icons`，不使用 emoji、手写 SVG 或 CSS 图形。
- CAD 业务文案替换官方演示文案，但保持相同信息密度与版式。

## 响应式设计

- ≥ 900px：左侧会话栏常驻，右侧对话区占剩余空间。
- < 900px：左侧栏进入 `Drawer`，主对话区全宽。
- 欢迎页三组提示卡片在窄屏变为单列或可换行布局。
- 底部 `Sender` 始终可见，不产生水平滚动，关键按钮不被遮挡。

## 测试与验收

自动化验证：

- 测试源码直接引入 `Conversations`、`Welcome`、`Prompts`、`Bubble.List`、`Think`、`ThoughtChain`、`Actions`、`Attachments`、`Sender.Header` 和 `Sender`。
- 测试不存在 `WorkspaceInspector`、独立文件浏览器或自制 `AnalysisComposer`。
- 覆盖会话创建/切换、快捷提示填入、附件校验、发送、取消、分析状态和导出触发。
- 运行 ESLint、TypeScript、相关 Vitest 和生产构建。

视觉验收：

- 在 1280×720 同状态下将参考截图与本地页面合并对照。
- 检查左栏比例、欢迎区层级、卡片密度、底部输入区位置、字体、间距、颜色和圆角。
- 在浏览器验证会话切换、快捷入口、附件面板、输入发送、思考展开和消息操作。
- `design-qa.md` 最终结果必须为 `passed`。

## 非目标

- 不改造分析算法、数据库结构或 API 协议。
- 不新增独立文件管理页面。
- 不保留右侧工程详情检查器。
- 不为追求截图效果重新实现 Ant Design X 已提供的组件。
