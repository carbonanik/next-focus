# Monorepo architecture

## Applications

- `apps/extension`: Chrome extension and browser app.
- `apps/web`: static marketing site and GitHub Pages entry point.
- `apps/api`: FastAPI backend, PostgreSQL models, authentication, and workspace API.

## Packages

`packages/` is reserved for code intentionally reusable across applications. Packages must declare dependencies and public entry points rather than reach into app-private files.

## Dependency direction

```text
UI
  -> application services
  -> infrastructure interfaces
  -> browser storage / API cloud store
```

The API is deployed separately. Browser applications communicate with it only through HTTP infrastructure modules.
