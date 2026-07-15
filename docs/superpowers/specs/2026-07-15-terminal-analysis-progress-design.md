# Terminal Analysis Progress Design

## Problem

Analysis jobs update the database to `progress: 100` after successful completion, but the message stream ends at 92%. The chat interface renders the latest `analysis_progress` message, so a completed job continues to appear active at 92%. Failed jobs have the same mismatch: the database records failure, while the latest progress message remains in a loading state.

## Design

The analysis service will append a terminal `analysis_progress` message whenever a run reaches a terminal state.

- Successful jobs append `progress: 100`, the final job status (`completed` or `requires_review`), and stage `分析完成`.
- Failed jobs append the actual stopping percentage, status `failed`, and the mapped failure stage.
- Existing error messages remain unchanged and continue to contain the user-facing failure explanation.
- Existing intermediate progress messages remain unchanged.

The frontend already treats a 100% progress message as successful and a message with status `failed` as an error, so no new client-side state or database fields are required.

## Data Flow

1. The analysis pipeline records intermediate progress messages.
2. On success, result messages are persisted and the analysis job is updated to its terminal status.
3. A matching terminal progress message is appended to the conversation.
4. On failure, the job is updated with its failure details, then a failed terminal progress message and the existing error message are appended.
5. The client refreshes the conversation and renders the terminal message instead of the stale intermediate message.

## Error Handling

Failure progress preserves the last real percentage rather than reporting 100%. The terminal progress message uses the same mapped failure stage stored on the job. If no analysis job exists, failure persistence remains a no-op as it is today.

## Testing

- Add a regression test proving a successful run appends a 100% terminal progress message with its final status.
- Add a regression test proving failure persistence appends a failed terminal progress message at the actual stopping percentage.
- Run the focused analysis-service tests, full test suite, type checking, linting, and production build.

## Scope

This change only corrects terminal progress reporting. It does not change DWG conversion, OpenAI analysis, retry behavior, database schema, or component-result generation.
