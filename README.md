# NextFocus Monorepo

NextFocus turns goals into executable actions and gives you one thing to focus on today.

## Layout

- `apps/extension/` — Chrome Manifest V3 extension and browser app
- `apps/web/` — static marketing site for GitHub Pages
- `apps/api/` — FastAPI backend and PostgreSQL persistence
- `packages/` — reusable packages for future cross-app code
- `scripts/` — monorepo validation and automation

AI-agent context is defined in `AGENTS.md` and `.github/copilot-instructions.md`.

## Workspace commands

```bash
npm run verify
npm run dev:web
npm run dev:api
```

`dev:api` uses the Python environment configured for the API; create `.venv` under `apps/api` when needed.

## Chrome extension

Load the unpacked extension from `apps/extension/`:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select `apps/extension/`.

The extension opens `app.html` directly and supports account and offline modes.

## Website

The repository root `index.html` redirects visitors to `apps/web/index.html`. Deploy GitHub Pages from the repository root.

## Backend

See `apps/api/README.md` for local setup and deployment instructions. Install the pinned dependencies with:

```bash
cd apps/api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Configure the browser API base URL in:

```text
apps/extension/src/infrastructure/api.config.js
```

```js
export const apiConfig = {
  baseUrl: "https://your-service.onrender.com"
};
```

Do not place private provider secrets or API keys in browser files.

## Architecture

Browser behavior follows:

```text
UI
  -> application services
  -> storage repository
  -> Chrome/local storage or API cloud store
```

Provider boundaries remain in:

- `apps/extension/src/infrastructure/cloudStore.js`
- `apps/extension/src/infrastructure/auth.js`
- `apps/extension/src/infrastructure/apiCloudStore.js`

More detail is available in `docs/ARCHITECTURE.md`.
