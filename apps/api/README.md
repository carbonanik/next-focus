# NextFocus FastAPI backend

FastAPI backend for the NextFocus extension, backed by PostgreSQL (Neon recommended).

## Local setup

1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and a long random `JWT_SECRET`.
3. Install and run:

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/docs` for the interactive OpenAPI documentation.

## API

- `POST /api/v1/auth/signup` - create an account
- `POST /api/v1/auth/signin` - get access and refresh tokens
- `POST /api/v1/auth/refresh` - rotate a refresh token
- `POST /api/v1/auth/logout` - revoke a refresh token
- `GET /api/v1/auth/me` - current user
- `GET /api/v1/workspace` - complete user workspace
- `PUT /api/v1/workspace` - replace complete user workspace, including guest-data migration
- `GET|POST|PATCH|DELETE /api/v1/goals`
- `GET|POST|PATCH|DELETE /api/v1/tasks`
- Goal and task workflow actions
- Plans, journal entries, and habits with CRUD/check-in endpoints
- `GET /health` - Render health check

Authenticated endpoints require:

```text
Authorization: Bearer <access_token>
```

Access tokens expire after 15 minutes. Store refresh tokens securely in the extension and rotate them through `/auth/refresh`; refresh tokens are stored in PostgreSQL only as SHA-256 hashes.

## Render deployment

1. Create a Neon PostgreSQL database and copy its connection string.
2. On Render, create a Web Service from this repository using `apps/api/Dockerfile`.
3. Set `DATABASE_URL` to the Neon URL.
4. Generate a strong `JWT_SECRET` and set it in Render environment variables.
5. Set `CORS_ORIGINS` if needed (Chrome extension origins are allowed automatically).
6. Deploy and set the health check to `/health`.

Tables are created automatically at startup. For production schema evolution, migrate the `create_all` startup behavior to Alembic before using destructive migrations.
