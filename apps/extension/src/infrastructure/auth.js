import { fetchWithTimeout } from "./http.js";
import { apiConfig, isApiConfigured } from "./api.config.js";
import { platformStorage } from "./platformStorage.js";

const AUTH_MODE_KEY = "nextfocus_auth_mode";
const AUTH_SESSION_KEY = "nextfocus_auth_session";
const MODE_GUEST = "guest";
const MODE_ACCOUNT = "account";
const TOKEN_SAFETY_WINDOW_MS = 60_000;

async function parseApiError(response) {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return new Error(body.detail);
    if (Array.isArray(body?.detail)) return new Error(body.detail[0]?.msg ?? "The request was invalid.");
  } catch (_) {}
  return new Error("Could not authenticate with NextFocus.");
}

function toSession(payload) {
  return {
    uid: payload.user.id,
    email: payload.user.email ?? "",
    idToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + Number(payload.expires_in ?? 900) * 1000
  };
}

class ApiAuthRepository {
  isConfigured() {
    return isApiConfigured();
  }

  async getAccessState() {
    const data = await platformStorage.local.get([AUTH_MODE_KEY, AUTH_SESSION_KEY]);
    if (data[AUTH_MODE_KEY] === MODE_GUEST) return { mode: MODE_GUEST, session: null };
    if (data[AUTH_MODE_KEY] === MODE_ACCOUNT && data[AUTH_SESSION_KEY]?.uid) return { mode: MODE_ACCOUNT, session: data[AUTH_SESSION_KEY] };
    return { mode: "none", session: null };
  }

  async signIn(email, password) {
    this.#assertConfigured();
    const response = await fetchWithTimeout(`${apiConfig.baseUrl}/api/v1/auth/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password })
    });
    if (!response.ok) throw await parseApiError(response);
    const session = toSession(await response.json());
    await platformStorage.local.set({ [AUTH_MODE_KEY]: MODE_ACCOUNT, [AUTH_SESSION_KEY]: session });
    return session;
  }

  async createAccount(email, password) {
    this.#assertConfigured();
    const response = await fetchWithTimeout(`${apiConfig.baseUrl}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password })
    });
    if (!response.ok) throw await parseApiError(response);
    const session = toSession(await response.json());
    await platformStorage.local.set({ [AUTH_MODE_KEY]: MODE_ACCOUNT, [AUTH_SESSION_KEY]: session });
    return session;
  }

  async skipLogin() {
    await platformStorage.local.remove(AUTH_SESSION_KEY);
    await platformStorage.local.set({ [AUTH_MODE_KEY]: MODE_GUEST });
  }

  async signOut() {
    const session = await this.getSession();
    if (session?.refreshToken) {
      try {
        await fetchWithTimeout(`${apiConfig.baseUrl}/api/v1/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: session.refreshToken })
        });
      } catch (_) {}
    }
    await platformStorage.local.remove([AUTH_MODE_KEY, AUTH_SESSION_KEY]);
  }

  async getSession() {
    const state = await this.getAccessState();
    return state.mode === MODE_ACCOUNT ? state.session : null;
  }

  async getIdToken() {
    const session = await this.getSession();
    if (!session) throw new Error("Sign in to sync with NextFocus.");
    if (session.idToken && session.expiresAt > Date.now() + TOKEN_SAFETY_WINDOW_MS) return session.idToken;
    return (await this.#refresh(session)).idToken;
  }

  async #refresh(session) {
    this.#assertConfigured();
    const response = await fetchWithTimeout(`${apiConfig.baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken })
    });
    if (!response.ok) throw await parseApiError(response);
    const refreshed = toSession(await response.json());
    await platformStorage.local.set({ [AUTH_MODE_KEY]: MODE_ACCOUNT, [AUTH_SESSION_KEY]: refreshed });
    return refreshed;
  }

  #assertConfigured() {
    if (!isApiConfigured()) throw new Error("NextFocus API is not configured.");
  }
}

export const authRepository = new ApiAuthRepository();
export const AUTH_MODES = { GUEST: MODE_GUEST, ACCOUNT: MODE_ACCOUNT };
