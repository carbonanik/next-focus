# NextFocus Agent Guide

## Repository

NextFocus is an npm-workspaces monorepo with a separate Python API:

- `apps/extension/`: Chrome Manifest V3 extension and browser web app.
- `apps/web/`: static marketing and GitHub Pages site.
- `apps/api/`: FastAPI and PostgreSQL service.
- `packages/`: reusable packages shared by applications.
- `scripts/`: repository-level automation.

## Boundaries

- Keep browser code framework-free and ES-module compatible.
- Never add secrets or provider API keys to browser bundles.
- Preserve local-first behavior through the storage repository.
- Keep authentication, cloud storage, and HTTP transport behind infrastructure interfaces.
- Keep API changes in `apps/api/app/`; never couple them to browser UI code.

## Working conventions

- Make narrow changes and preserve existing behavior.
- Follow the existing separation:
  `domain/ -> application/ -> infrastructure/ -> UI`.
- Keep Python dependencies pinned in `apps/api/requirements.txt`.
- Run `npm run verify` before completing code changes.

## Entry points

- Extension: `apps/extension/app.html`
- Extension manifest: `apps/extension/manifest.json`
- Extension logic: `apps/extension/src/`
- Website: `apps/web/index.html`
- API: `apps/api/app/main.py`
