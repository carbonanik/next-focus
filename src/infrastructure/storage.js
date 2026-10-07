import { authRepository, AUTH_MODES } from "./auth.js";
import { cloudStore } from "./cloudStore.js";

const GUEST_KEYS = {
  goals: "nextfocus_goals",
  tasks: "nextfocus_tasks",
  ideas: "nextfocus_ideas",
  plans: "nextfocus_daily_plans",
  journal: "nextfocus_journal",
  habits: "nextfocus_habits"
};

const DEFAULTS = { goals: [], tasks: [], ideas: [], plans: {}, journal: {}, habits: [] };
const freshDefault = (section) => section === "plans" || section === "journal" ? {} : [];
const pendingSectionKey = (uid, section) => `nextfocus_user_${uid}_pending_${section}`;
const pendingKeys = (uid) => Object.fromEntries(Object.keys(DEFAULTS).map((section) => [section, pendingSectionKey(uid, section)]));
const initializedKey = (uid) => `nextfocus_user_${uid}_initialized`;
const userKey = (uid, section) => `nextfocus_user_${uid}_${section}`;

function hasMeaningfulData(state) {
  return Boolean(
    state.goals?.length ||
    state.tasks?.length ||
    state.ideas?.length ||
    Object.keys(state.plans ?? {}).length ||
    Object.keys(state.journal ?? {}).length ||
    state.habits?.length
  );
}

class HybridStorageRepository {
  constructor() {
    this.bootstrapPromises = new Map();
  }

  async getGoals() { return this.#get("goals"); }
  async saveGoals(value) { return this.#save("goals", value); }
  async getTasks() { return this.#get("tasks"); }
  async saveTasks(value) { return this.#save("tasks", value); }
  async getIdeas() { return this.#get("ideas"); }
  async saveIdeas(value) { return this.#save("ideas", value); }
  async getPlans() { return this.#get("plans"); }
  async savePlans(value) { return this.#save("plans", value); }
  async getJournal() { return this.#get("journal"); }
  async saveJournal(value) { return this.#save("journal", value); }
  async getHabits() { return this.#get("habits"); }
  async saveHabits(value) { return this.#save("habits", value); }

  async loadAll() {
    const access = await authRepository.getAccessState();
    if (access.mode === AUTH_MODES.ACCOUNT) await this.#ensureAccountInitialized(access.session.uid);
    const keys = this.#keysFor(access);
    const data = await chrome.storage.local.get(Object.values(keys));
    return {
      goals: data[keys.goals] ?? [],
      tasks: data[keys.tasks] ?? [],
      ideas: data[keys.ideas] ?? [],
      plans: data[keys.plans] ?? {},
      journal: data[keys.journal] ?? {},
      habits: data[keys.habits] ?? []
    };
  }

  async initializeAccountData({ migrateGuest = true } = {}) {
    const session = await authRepository.getSession();
    if (!session) return { restored: false, migrated: false };
    this.bootstrapPromises.delete(session.uid);
    return this.#bootstrapAccount(session.uid, migrateGuest, true);
  }

  async getSyncStatus() {
    const session = await authRepository.getSession();
    if (!session) return { mode: "guest", pending: [] };
    const keys = pendingKeys(session.uid);
    const data = await chrome.storage.local.get(Object.values(keys));
    return { mode: "account", pending: Object.keys(keys).filter((section) => data[keys[section]] === true) };
  }

  async syncNow() {
    const session = await authRepository.getSession();
    if (!session) return { synced: false, reason: "guest" };
    await this.#flushPending(session.uid);
    return { synced: true };
  }

  resetRuntimeState() {
    this.bootstrapPromises.clear();
  }

  async #get(section) {
    const access = await authRepository.getAccessState();
    if (access.mode === AUTH_MODES.ACCOUNT) await this.#ensureAccountInitialized(access.session.uid);
    const key = this.#keysFor(access)[section];
    const data = await chrome.storage.local.get(key);
    return data[key] ?? freshDefault(section);
  }

  async #save(section, value) {
    const access = await authRepository.getAccessState();
    if (access.mode === AUTH_MODES.ACCOUNT) await this.#ensureAccountInitialized(access.session.uid);
    const key = this.#keysFor(access)[section];
    await chrome.storage.local.set({ [key]: value });
    if (access.mode === AUTH_MODES.ACCOUNT) {
      // Local-first: persist the pending marker before starting the network request.
      await this.#addPending(access.session.uid, section);
      void this.#syncSection(access.session.uid, section, value);
    }
  }

  #keysFor(access) {
    if (access.mode !== AUTH_MODES.ACCOUNT || !access.session?.uid) return GUEST_KEYS;
    const uid = access.session.uid;
    return Object.fromEntries(Object.keys(DEFAULTS).map((section) => [section, userKey(uid, section)]));
  }

  async #ensureAccountInitialized(uid) {
    if (!this.bootstrapPromises.has(uid)) this.bootstrapPromises.set(uid, this.#bootstrapAccount(uid, true, false));
    return this.bootstrapPromises.get(uid);
  }

  async #bootstrapAccount(uid, migrateGuest, force) {
    const marker = initializedKey(uid);
    const existing = await chrome.storage.local.get(marker);

    // Normal launches stay instant/offline-first. Pending cloud writes retry in the background.
    if (existing[marker] && !force) {
      void this.#flushPending(uid);
      return { restored: false, migrated: false };
    }

    // Explicit sign-in/re-auth may safely reconcile before reading cloud data.
    if (existing[marker] && force) {
      await this.#flushPending(uid);
      const sync = await this.getSyncStatus();
      if (sync.pending.length) return { restored: false, migrated: false, offline: true };
    }

    let cloud = { goals: null, tasks: null, ideas: null, plans: null, journal: null, habits: null };
    try { cloud = await cloudStore.getAll(uid); } catch (error) {
      if (!existing[marker]) {
        // The account can still work from its UID-scoped local cache while offline.
        await chrome.storage.local.set({ [marker]: true });
      }
      return { restored: false, migrated: false, offline: true, error };
    }

    const cloudHasData = Object.values(cloud).some((value) => value !== null);
    if (cloudHasData) {
      const writes = {};
      for (const section of Object.keys(DEFAULTS)) writes[userKey(uid, section)] = cloud[section] ?? freshDefault(section);
      writes[marker] = true;
      await chrome.storage.local.set(writes);
      await this.#clearPending(uid);
      return { restored: true, migrated: false };
    }

    const accountLocal = await this.#readUserState(uid);
    if (hasMeaningfulData(accountLocal)) {
      await this.#uploadAll(uid, accountLocal);
      await chrome.storage.local.set({ [marker]: true });
      return { restored: false, migrated: false };
    }

    // Guest data is migrated only when the signed-in account has no cloud/local data.
    const guest = await this.#readGuestState();
    if (migrateGuest && hasMeaningfulData(guest)) {
      await this.#writeUserState(uid, guest);
      await this.#uploadAll(uid, guest);
      await chrome.storage.local.set({ [marker]: true });
      return { restored: false, migrated: true };
    }

    await this.#writeUserState(uid, DEFAULTS);
    await chrome.storage.local.set({ [marker]: true });
    await this.#clearPending(uid);
    return { restored: false, migrated: false };
  }

  async #readGuestState() {
    const data = await chrome.storage.local.get(Object.values(GUEST_KEYS));
    return {
      goals: data[GUEST_KEYS.goals] ?? [],
      tasks: data[GUEST_KEYS.tasks] ?? [],
      ideas: data[GUEST_KEYS.ideas] ?? [],
      plans: data[GUEST_KEYS.plans] ?? {},
      journal: data[GUEST_KEYS.journal] ?? {},
      habits: data[GUEST_KEYS.habits] ?? []
    };
  }

  async #readUserState(uid) {
    const keys = Object.fromEntries(Object.keys(DEFAULTS).map((section) => [section, userKey(uid, section)]));
    const data = await chrome.storage.local.get(Object.values(keys));
    return Object.fromEntries(Object.keys(DEFAULTS).map((section) => [section, data[keys[section]] ?? freshDefault(section)]));
  }

  async #writeUserState(uid, state) {
    const writes = {};
    for (const section of Object.keys(DEFAULTS)) writes[userKey(uid, section)] = state[section] ?? freshDefault(section);
    await chrome.storage.local.set(writes);
  }

  async #uploadAll(uid, state) {
    for (const section of Object.keys(DEFAULTS)) {
      try {
        await cloudStore.saveSection(uid, section, state[section] ?? freshDefault(section));
        await this.#removePending(uid, section);
      } catch (_) {
        await this.#addPending(uid, section);
      }
    }
  }

  async #syncSection(uid, section, value) {
    try {
      await cloudStore.saveSection(uid, section, value);
      await this.#removePending(uid, section);
    } catch (_) {
      await this.#addPending(uid, section);
    }
  }

  async #flushPending(uid) {
    const keys = pendingKeys(uid);
    const data = await chrome.storage.local.get(Object.values(keys));
    const pending = Object.keys(keys).filter((section) => data[keys[section]] === true);
    if (!pending.length) return;
    const state = await this.#readUserState(uid);
    for (const section of pending) {
      try {
        await cloudStore.saveSection(uid, section, state[section]);
        await this.#removePending(uid, section);
      } catch (_) {}
    }
  }

  async #addPending(uid, section) {
    await chrome.storage.local.set({ [pendingSectionKey(uid, section)]: true });
  }

  async #removePending(uid, section) {
    await chrome.storage.local.remove(pendingSectionKey(uid, section));
  }

  async #clearPending(uid) {
    await chrome.storage.local.remove(Object.values(pendingKeys(uid)));
  }
}

export const storageRepository = new HybridStorageRepository();
