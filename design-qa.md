# Design QA

- Source visual truth: `/var/folders/xl/6dsz726x6597g1vr0bhx683m0000gn/T/codex-clipboard-1da8154a-f351-4dc4-8d83-a0b0a8083de9.png`
- Official implementation reference: `https://github.com/ant-design/x/blob/main/packages/x/docs/playground/independent.tsx`
- Implementation: `http://localhost:3000/`
- Viewport: 1280 × 720, desktop, light theme
- State: empty CAD analysis session, existing grouped conversation history, no pending attachment
- Final screenshot: [`design-qa-assets/independent-workspace-final-1280x720.png`](design-qa-assets/independent-workspace-final-1280x720.png)
- Side-by-side comparison: [`design-qa-assets/independent-workspace-final-comparison.png`](design-qa-assets/independent-workspace-final-comparison.png)

## Result

The workspace now follows the official Ant Design X independent-demo composition: a 280 px grouped `Conversations` sidebar and one centered chat surface. The previous right inspector and separate file region are absent from the rendered dependency graph.

- Welcome area: official `Welcome` plus three official `Prompts` groups, with CAD-specific content.
- Message stream: one official `Bubble.List`, `ThoughtChain` for CAD stages, `Think` and `Sources` for reasoning, `FileCard` for uploaded drawings, and `Actions` for copy/retry/export.
- Composer: official compact `Sender` with `Sender.Header`, `Attachments`, paperclip prefix, speech control, and the framework send/cancel action.
- Visual system: Ant Design typography, controls, borders, radii, icons, and interaction states. CSS only defines the outer two-column layout and responsive positioning.
- Responsive behavior: at widths below 900 px the fixed sidebar becomes the official Ant Design `Drawer` entry point.

## Interaction and Runtime Checks

- Verified the grouped conversation list and “开启新分析” control render.
- Opened and closed the official attachment header using the Sender paperclip action.
- Verified DWG/DXF attachment placeholder and 25 MB guidance.
- Typed in the official Sender and restored the empty value.
- Verified the speech action and disabled empty-send state.
- Browser console after the client-only speech-capability mount fix: no new errors.
- Focused component tests, typecheck, lint, and webpack production build all pass.

## Comparison History

1. Before: three columns, a custom oversized agent footer, inspector-only result navigation, and a permanent file region.
2. First pass: official two-column shell and compact Sender were in place; browser QA exposed a speech-capability hydration mismatch.
3. Final pass: Sender mounts after hydration while remaining the official Ant Design X component. The final side-by-side comparison has no remaining P0/P1/P2 mismatch for the requested composition.

final result: passed
