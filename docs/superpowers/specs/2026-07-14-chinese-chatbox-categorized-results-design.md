# Chinese Chatbox and Categorized Results Design

## Objective

Adapt the MVP to the independent chat layout in
`wzc520pyfm/ant-design-x-vue` while retaining the installed React Ant Design X
stack. All user-facing product copy will be Simplified Chinese. Developer
communication, code identifiers, database enums, and API field names remain in
English.

The reference repository is MIT licensed. Its layout and interaction structure
will be adapted, not copied as Vue runtime code.

## Layout

The current three-column workspace will become a two-column independent chat
experience:

- A 280px conversation sidebar containing the product name, new-analysis
  action, grouped conversation history, rename/delete actions, and a concise
  preliminary-results warning.
- A flexible chat area with a centered 700px content column, independently
  scrolling message history, contextual prompts, attachments, and a sticky
  sender.
- No permanently visible right analysis panel. Drawing previews, component
  results, review items, and BOM results appear as structured chat messages.

The layout follows the reference repository's `independent.vue` proportions,
spacing, conversation sidebar, centered chat column, welcome prompts, bubble
roles, attachment header, and sender placement. Ant Design X component styles
and theme tokens provide visual treatment; no standalone custom stylesheet is
introduced.

## Ant Design X Components

The interface uses `XProvider`, `Conversations`, `Welcome`, `Prompts`,
`Bubble.List`, `Sender`, `Sender.Header`, `Attachments`, `FileCard`,
`ThoughtChain`, `Actions`, and `XMarkdown`.

## Categorized Component List

Every active detected component appears exactly once in the assistant's result
message. Components are grouped by category in a stable category order. Each
category heading includes its count. Every item displays:

- Tag or stable detection identifier
- Chinese category label
- Description
- Visible specifications, or `图纸中未显示`
- Confidence percentage
- Review status

Unknown detections are grouped under `未知元件（需工程师复核）`. Removed
components are excluded. Empty categories are omitted.

The same grouping utility supplies category counts for contextual prompts and
future result views, preventing the chat summary and persisted component data
from diverging.

## Chinese Product Copy

All visible UI and generated demo content becomes Simplified Chinese:

- Product name, welcome text, prompts, placeholders, menus, and actions
- Upload, processing, completion, review, retry, and error states
- Assistant receipt, progress, summary, component, BOM, and export messages
- Category names, confidence labels, and review statuses
- Fixture descriptions, warnings, and evidence shown to users
- CSV filename, headers, missing-value markers, and review-state labels

Internal category keys such as `circuit_breaker` remain unchanged for data
compatibility.

## Interaction Flow

The user creates a conversation, attaches one DWG or DXF, and sends a Chinese
or English analysis request. The assistant confirms receipt in Chinese, shows
Chinese progress stages, and returns a complete categorized component list.
Follow-up commands continue to support filtering, selecting, correcting,
removing, BOM regeneration, and export. Mutations refresh the categorized list
and BOM from persisted component data.

## Testing

Tests will verify:

- Stable category ordering and one appearance per active component
- Unknown-item grouping and removed-item exclusion
- Chinese category, review-status, and missing-value labels
- Chinese CSV headers and values
- Existing upload, analysis, correction, BOM, and export behavior
- Type checking, linting, production build, and the deterministic API flow

Visual comparison is source-code based because the in-app browser is
unavailable. The implementation will be checked against the reference
repository's `docs/examples/playground/independent.vue` structure and tokens.

## Explicit Limitations

This remains a fixture-backed demonstration. The UI will list and categorize
all detections returned by the analyzer, but the analyzer does not yet detect
all components in arbitrary real DWG or DXF files.
