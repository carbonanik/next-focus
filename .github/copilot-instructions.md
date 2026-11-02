# NextFocus Copilot Instructions

Use the repository boundaries and conventions in the root `AGENTS.md`.

Before editing, identify the owning app or package and inspect adjacent files. Do not move stable paths without updating imports, manifest entries, documentation, and workspace scripts. Preserve local-first storage and provider abstraction boundaries.

Prefer framework-free solutions for the extension and landing page. Prefer FastAPI/Pydantic/SQLAlchemy patterns already used by the API. Never expose credentials to client code.

Validate changes with `npm run verify`.
