const KEYS = {
  goals: "nextfocus_goals",
  tasks: "nextfocus_tasks",
  ideas: "nextfocus_ideas",
  plans: "nextfocus_daily_plans"
};

class ChromeStorageRepository {
  async getGoals() {
    const data = await chrome.storage.local.get(KEYS.goals);
    return data[KEYS.goals] ?? [];
  }

  async saveGoals(goals) {
    await chrome.storage.local.set({ [KEYS.goals]: goals });
  }

  async getTasks() {
    const data = await chrome.storage.local.get(KEYS.tasks);
    return data[KEYS.tasks] ?? [];
  }

  async saveTasks(tasks) {
    await chrome.storage.local.set({ [KEYS.tasks]: tasks });
  }

  async getIdeas() {
    const data = await chrome.storage.local.get(KEYS.ideas);
    return data[KEYS.ideas] ?? [];
  }

  async saveIdeas(ideas) {
    await chrome.storage.local.set({ [KEYS.ideas]: ideas });
  }

  async getPlans() {
    const data = await chrome.storage.local.get(KEYS.plans);
    return data[KEYS.plans] ?? {};
  }

  async savePlans(plans) {
    await chrome.storage.local.set({ [KEYS.plans]: plans });
  }

  async loadAll() {
    const data = await chrome.storage.local.get(Object.values(KEYS));
    return {
      goals: data[KEYS.goals] ?? [],
      tasks: data[KEYS.tasks] ?? [],
      ideas: data[KEYS.ideas] ?? [],
      plans: data[KEYS.plans] ?? {}
    };
  }
}

export const storageRepository = new ChromeStorageRepository();
