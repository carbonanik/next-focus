# NextFocus Chrome Extension

A local-first Manifest V3 Chrome extension based on the workflow:

**LATER → NEXT → TODAY → DONE**

## Install locally

1. Unzip the project.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extension folder.

## V1 features

- Goal CRUD with desired outcome, optional deadline and notes
- Task CRUD with goal, duration, notes and a simple dependency
- LATER goal view with progress and current frontier
- NEXT queue capped at 7 tasks
- Dependency and blocked-task gating
- TODAY with exactly one main task and up to 3 quick tasks
- Focus mode with a secondary elapsed timer
- Completion flow and goal progress updates
- Ideas capture and Idea → Goal conversion
- History
- Search (`Ctrl/Cmd + K`)
- Keyboard navigation (`T`, `X`, `L`, `I`, `N`, `G`)
- `chrome.storage.local` persistence; no account/backend
- Lightweight popup optimized for TODAY

## Architecture

- `src/domain/` — states and business constants
- `src/application/` — central business rules / use cases
- `src/infrastructure/` — Chrome Storage repository
- `src/shared/` — shared utilities
- `app.js` / `popup.js` — UI orchestration

The UI never calls `chrome.storage.local` directly; storage is isolated behind the repository.
