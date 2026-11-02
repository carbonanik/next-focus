function getChromeStorage() {
  return globalThis.chrome?.runtime?.id ? globalThis.chrome?.storage?.local ?? null : null;
}

function parseStoredValue(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const browserStorage = {
  async get(keys) {
    const requested = keys == null
      ? Object.keys(localStorage)
      : Array.isArray(keys)
        ? keys
        : typeof keys === "string"
          ? [keys]
          : Object.keys(keys);
    const result = {};
    for (const key of requested) {
      const value = localStorage.getItem(key);
      if (value !== null) result[key] = parseStoredValue(value);
      else if (keys && !Array.isArray(keys) && typeof keys === "object" && key in keys) result[key] = keys[key];
    }
    return result;
  },
  async set(values) {
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  },
  async remove(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) localStorage.removeItem(key);
  }
};

export const platformStorage = {
  get local() {
    return getChromeStorage() ?? browserStorage;
  }
};
