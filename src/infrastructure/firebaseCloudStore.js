import { fetchWithTimeout } from "./http.js";
import { authRepository } from "./auth.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase.config.js";

const VALID_SECTIONS = new Set(["goals", "tasks", "ideas", "plans", "journal", "habits"]);

function documentUrl(uid, section) {
  if (!VALID_SECTIONS.has(section)) throw new Error("Unknown data section.");
  const project = encodeURIComponent(firebaseConfig.projectId);
  const user = encodeURIComponent(uid);
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/users/${user}/data/${section}`;
}

async function firestoreError(response) {
  let message = `Firebase sync failed (${response.status}).`;
  try {
    const body = await response.json();
    if (body?.error?.message) message = body.error.message;
  } catch (_) {}
  return new Error(message);
}

class FirebaseCloudStore {
  isConfigured() {
    return isFirebaseConfigured();
  }

  async getSection(uid, section) {
    this.#assertConfigured();
    const token = await authRepository.getIdToken();
    const response = await fetchWithTimeout(documentUrl(uid, section), { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 404) return null;
    if (!response.ok) throw await firestoreError(response);
    const document = await response.json();
    const payload = document?.fields?.payload?.stringValue;
    if (typeof payload !== "string") return null;
    try { return JSON.parse(payload); } catch (_) { throw new Error(`Cloud ${section} data is invalid.`); }
  }

  async saveSection(uid, section, value) {
    this.#assertConfigured();
    const token = await authRepository.getIdToken();
    const response = await fetchWithTimeout(documentUrl(uid, section), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          payload: { stringValue: JSON.stringify(value) },
          schemaVersion: { integerValue: "1" },
          updatedAt: { timestampValue: new Date().toISOString() }
        }
      })
    });
    if (!response.ok) throw await firestoreError(response);
  }

  async getAll(uid) {
    const entries = await Promise.all([...VALID_SECTIONS].map(async (section) => [section, await this.getSection(uid, section)]));
    return Object.fromEntries(entries);
  }

  #assertConfigured() {
    if (!isFirebaseConfigured()) throw new Error("Firebase is not configured.");
  }
}

export const firebaseCloudStore = new FirebaseCloudStore();
