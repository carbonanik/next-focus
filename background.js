chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(["nextfocus_initialized"]);
  if (!existing.nextfocus_initialized) {
    await chrome.storage.local.set({
      nextfocus_initialized: true,
      nextfocus_goals: [],
      nextfocus_tasks: [],
      nextfocus_ideas: [],
      nextfocus_daily_plans: {}
    });
  }
});
