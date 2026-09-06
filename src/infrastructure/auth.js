import { fetchWithTimeout } from "./http.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase.config.js";

const AUTH_MODE_KEY = "nextfocus_auth_mode";
const AUTH_SESSION_KEY = "nextfocus_auth_session";
const MODE_GUEST = "guest";
const MODE_ACCOUNT = "account";
const TOKEN_SAFETY_WINDOW_MS = 60_000;

function authErrorMessage(code) {
  const messages = {
    EMAIL_EXISTS: "An account already exists with this email.",
    EMAIL_NOT_FOUND: "No account was found for this email.",
    INVALID_PASSWORD: "The email or password is incorrect.",
    INVALID_LOGIN_CREDENTIALS: "The email or password is incorrect.",
    INVALID_EMAIL: "Enter a valid email address.",
    MISSING_PASSWORD: "Enter your password.",
    WEAK_PASSWORD: "Use a password with at least 6 characters.",
    USER_DISABLED: "This account has been disabled.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Try again later.",
    OPERATION_NOT_ALLOWED: "Enable Email/Password sign-in in Firebase Authentication."
  };
  return messages[code] ?? "Could not authenticate with Firebase.";
}

async function parseFirebaseError(response) {
  let code = "";
  try {
    const body = await response.json();
    code = body?.error?.message?.split(" : ")[0] ?? "";
  } catch (_) {}
  return new Error(authErrorMessage(code));
}

function toSession(payload) {
  return {
    uid: payload.localId ?? payload.user_id,
    email: payload.email ?? "",
    idToken: payload.idToken ?? payload.id_token,
    refreshToken: payload.refreshToken ?? payload.refresh_token,
    expiresAt: Date.now() + Number(payload.expiresIn ?? payload.expires_in ?? 3600) * 1000
  };
}

class FirebaseAuthRepository {
  isConfigured() {
    return isFirebaseConfigured();
  }

  async getAccessState() {
    const data = await chrome.storage.local.get([AUTH_MODE_KEY, AUTH_SESSION_KEY]);
    if (data[AUTH_MODE_KEY] === MODE_GUEST) return { mode: MODE_GUEST, session: null };
    if (data[AUTH_MODE_KEY] === MODE_ACCOUNT && data[AUTH_SESSION_KEY]?.uid) return { mode: MODE_ACCOUNT, session: data[AUTH_SESSION_KEY] };
    return { mode: "none", session: null };
  }

  async signIn(email, password) {
    this.#assertConfigured();
    const response = await fetchWithTimeout(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true })
    });
    if (!response.ok) throw await parseFirebaseError(response);
    const session = toSession(await response.json());
    await chrome.storage.local.set({ [AUTH_MODE_KEY]: MODE_ACCOUNT, [AUTH_SESSION_KEY]: session });
    return session;
  }

  async createAccount(email, password) {
    this.#assertConfigured();
    const response = await fetchWithTimeout(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true })
    });
    if (!response.ok) throw await parseFirebaseError(response);
    const session = toSession(await response.json());
    await chrome.storage.local.set({ [AUTH_MODE_KEY]: MODE_ACCOUNT, [AUTH_SESSION_KEY]: session });
    return session;
  }

  async skipLogin() {
    await chrome.storage.local.remove(AUTH_SESSION_KEY);
    await chrome.storage.local.set({ [AUTH_MODE_KEY]: MODE_GUEST });
  }

  async signOut() {
    await chrome.storage.local.remove([AUTH_MODE_KEY, AUTH_SESSION_KEY]);
  }

  async getSession() {
    const state = await this.getAccessState();
    return state.mode === MODE_ACCOUNT ? state.session : null;
  }

  async getIdToken() {
    const session = await this.getSession();
    if (!session) throw new Error("Sign in to sync with Firebase.");
    if (session.idToken && session.expiresAt > Date.now() + TOKEN_SAFETY_WINDOW_MS) return session.idToken;
    return (await this.#refresh(session)).idToken;
  }

  async #refresh(session) {
    this.#assertConfigured();
    const response = await fetchWithTimeout(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken }).toString()
    });
    if (!response.ok) throw await parseFirebaseError(response);
    const refreshed = { ...session, ...toSession({ ...(await response.json()), email: session.email }) };
    await chrome.storage.local.set({ [AUTH_MODE_KEY]: MODE_ACCOUNT, [AUTH_SESSION_KEY]: refreshed });
    return refreshed;
  }

  #assertConfigured() {
    if (!isFirebaseConfigured()) throw new Error("Firebase is not configured yet. Add your Web API key and project ID in firebase.config.js.");
  }
}

export const authRepository = new FirebaseAuthRepository();
export const AUTH_MODES = { GUEST: MODE_GUEST, ACCOUNT: MODE_ACCOUNT };
