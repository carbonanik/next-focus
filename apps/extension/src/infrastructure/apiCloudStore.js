import { apiConfig } from "./api.config.js";
import { authRepository } from "./auth.js";
import { fetchWithTimeout } from "./http.js";

async function authorizedFetch(path, options = {}) {
  const token = await authRepository.getIdToken();
  const response = await fetchWithTimeout(`${apiConfig.baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  if (!response.ok) {
    let detail = "Could not sync with NextFocus.";
    try {
      const body = await response.json();
      detail = typeof body?.detail === "string" ? body.detail : detail;
    } catch (_) {}
    throw new Error(detail);
  }
  return response.status === 204 ? null : response.json();
}

class ApiCloudStore {
  async getSection(uid, section) {
    const workspace = await authorizedFetch("/api/v1/workspace");
    return workspace?.[section] ?? null;
  }

  async saveSection(uid, section, value) {
    const workspace = await authorizedFetch("/api/v1/workspace");
    workspace[section] = value;
    await authorizedFetch("/api/v1/workspace", {
      method: "PUT",
      body: JSON.stringify(workspace)
    });
  }

  async getAll(uid) {
    const workspace = await authorizedFetch("/api/v1/workspace");
    const meaningful = Object.values(workspace ?? {}).some((value) =>
      Array.isArray(value) ? value.length > 0 : value && Object.keys(value).length > 0
    );
    if (!meaningful) {
      return { goals: null, tasks: null, plans: null, journal: null, habits: null };
    }
    return workspace;
  }
}

export const apiCloudStore = new ApiCloudStore();
