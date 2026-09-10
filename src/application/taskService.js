import { storageRepository } from "../infrastructure/storage.js";
import { MAX_NEXT_TASKS, MAX_QUICK_TASKS, TASK_STATUS } from "../domain/constants.js";
import { todayKey, uid } from "../shared/utils.js";

function now() {
  return new Date().toISOString();
}

function normalizeGoalStatus(status) {
  if (status === "ACTIVE" || status === "INACTIVE" || status === "DONE") return status;
  return "INACTIVE";
}

function normalizeTaskStatus(task, allTasks) {
  if (task.status === TASK_STATUS.DONE || task.status === TASK_STATUS.BLOCKED || task.status === TASK_STATUS.NEXT || task.status === TASK_STATUS.TODAY || task.status === TASK_STATUS.IN_PROGRESS) {
    return task.status;
  }
  const depsReady = (task.dependencyIds ?? []).every((id) => allTasks.find((t) => t.id === id)?.status === TASK_STATUS.DONE);
  return depsReady ? TASK_STATUS.READY : TASK_STATUS.BACKLOG;
}

export async function getAppState() {
  const state = await storageRepository.loadAll();
  state.tasks = state.tasks.map((task) => ({ ...task, status: normalizeTaskStatus(task, state.tasks) }));
  const currentKey = todayKey();
  let plansChanged = false;
  for (const [key, plan] of Object.entries(state.plans)) {
    if (key >= currentKey || !plan.mainTaskId) continue;
    const task = state.tasks.find((candidate) => candidate.id === plan.mainTaskId);
    if (task && task.status !== TASK_STATUS.DONE && task.status !== TASK_STATUS.BLOCKED) {
      task.status = normalizeTaskStatus({ ...task, status: TASK_STATUS.READY }, state.tasks);
    }
    plan.mainTaskId = null;
    plansChanged = true;
  }
  if (plansChanged) {
    await Promise.all([storageRepository.saveTasks(state.tasks), storageRepository.savePlans(state.plans)]);
  }
  return state;
}

export async function createGoal({ title, description, deadline = "", notes = "", status = "INACTIVE" }) {
  const goals = await storageRepository.getGoals();
  const goalStatus = normalizeGoalStatus(status);
  const goal = {
    id: uid("goal"),
    title: title.trim(),
    description: description.trim(),
    deadline,
    notes: notes.trim(),
    status: goalStatus,
    collapsed: false,
    createdAt: now(),
    startedAt: goalStatus === "ACTIVE" ? now() : null,
    completedAt: null
  };
  goals.push(goal);
  await storageRepository.saveGoals(goals);
  return goal;
}

export async function updateGoal(goalId, patch) {
  const goals = await storageRepository.getGoals();
  const index = goals.findIndex((g) => g.id === goalId);
  if (index < 0) throw new Error("Goal not found.");

  const nextGoal = { ...goals[index], ...patch };
  nextGoal.status = normalizeGoalStatus(nextGoal.status ?? goals[index].status ?? "INACTIVE");
  if (nextGoal.status === "ACTIVE" && !nextGoal.startedAt) {
    nextGoal.startedAt = now();
  }

  goals[index] = nextGoal;
  await storageRepository.saveGoals(goals);
  return goals[index];
}

export async function deleteGoal(goalId) {
  const [goals, tasks] = await Promise.all([storageRepository.getGoals(), storageRepository.getTasks()]);
  await storageRepository.saveGoals(goals.filter((g) => g.id !== goalId));
  await storageRepository.saveTasks(tasks.filter((t) => t.goalId !== goalId));
}

export async function createTask({ title, goalId, estimatedMinutes = null, notes = "", dependencyIds = [] }) {
  const tasks = await storageRepository.getTasks();
  const task = {
    id: uid("task"), goalId, title: title.trim(), notes: notes.trim(), status: TASK_STATUS.BACKLOG,
    estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
    dependencyIds, blockedReason: "", createdAt: now(), completedAt: null, startedAt: null
  };
  tasks.push(task);
  task.status = normalizeTaskStatus(task, tasks);
  await storageRepository.saveTasks(tasks);
  return task;
}

export async function updateTask(taskId, patch) {
  const tasks = await storageRepository.getTasks();
  const index = tasks.findIndex((t) => t.id === taskId);
  if (index < 0) throw new Error("Task not found.");
  tasks[index] = { ...tasks[index], ...patch };
  tasks[index].status = normalizeTaskStatus(tasks[index], tasks);
  await storageRepository.saveTasks(tasks);
  return tasks[index];
}

export async function deleteTask(taskId) {
  const [tasks, plans] = await Promise.all([storageRepository.getTasks(), storageRepository.getPlans()]);
  await storageRepository.saveTasks(tasks.filter((t) => t.id !== taskId).map((t) => ({ ...t, dependencyIds: (t.dependencyIds ?? []).filter((id) => id !== taskId) })));
  for (const key of Object.keys(plans)) {
    if (plans[key].mainTaskId === taskId) plans[key].mainTaskId = null;
    plans[key].quickTaskIds = (plans[key].quickTaskIds ?? []).filter((id) => id !== taskId);
  }
  await storageRepository.savePlans(plans);
}

export async function promoteToNext(taskId) {
  const [tasks, goals] = await Promise.all([storageRepository.getTasks(), storageRepository.getGoals()]);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found.");
  const goal = goals.find((g) => g.id === task.goalId);
  if (goal?.status === "INACTIVE") throw new Error("Activate this goal before adding its tasks to NEXT.");
  if (task.status === TASK_STATUS.BLOCKED) throw new Error("Blocked tasks cannot enter NEXT.");
  const depsReady = (task.dependencyIds ?? []).every((id) => tasks.find((t) => t.id === id)?.status === TASK_STATUS.DONE);
  if (!depsReady) throw new Error("Complete this task's dependencies first.");
  if (tasks.filter((t) => t.status === TASK_STATUS.NEXT).length >= MAX_NEXT_TASKS) throw new Error("NEXT already has 7 tasks. Remove one before adding another.");
  task.status = TASK_STATUS.NEXT;
  await storageRepository.saveTasks(tasks);
}

export async function removeFromNext(taskId) {
  const tasks = await storageRepository.getTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.status = normalizeTaskStatus({ ...task, status: TASK_STATUS.READY }, tasks);
  await storageRepository.saveTasks(tasks);
}

export async function makeToday(taskId) {
  const [tasks, plans] = await Promise.all([storageRepository.getTasks(), storageRepository.getPlans()]);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found.");
  if (task.status === TASK_STATUS.BLOCKED) throw new Error("Blocked tasks cannot become TODAY.");
  const depsReady = (task.dependencyIds ?? []).every((id) => tasks.find((t) => t.id === id)?.status === TASK_STATUS.DONE);
  if (!depsReady) throw new Error("Complete this task's dependencies first.");

  const key = todayKey();
  const plan = plans[key] ?? { date: key, mainTaskId: null, quickTaskIds: [] };
  if (plan.mainTaskId && plan.mainTaskId !== taskId) {
    const old = tasks.find((t) => t.id === plan.mainTaskId);
    if (old && old.status !== TASK_STATUS.DONE) old.status = TASK_STATUS.NEXT;
  }
  plan.mainTaskId = taskId;
  plan.quickTaskIds = (plan.quickTaskIds ?? []).filter((id) => id !== taskId);
  plans[key] = plan;
  task.status = TASK_STATUS.TODAY;
  await Promise.all([storageRepository.saveTasks(tasks), storageRepository.savePlans(plans)]);
}

export async function removeToday(taskId) {
  const [tasks, plans] = await Promise.all([storageRepository.getTasks(), storageRepository.getPlans()]);
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error("Task not found.");
  const key = todayKey();
  const plan = plans[key];
  if (!plan || plan.mainTaskId !== taskId) return;
  plan.mainTaskId = null;
  if (task.status !== TASK_STATUS.DONE && task.status !== TASK_STATUS.BLOCKED) {
    task.status = TASK_STATUS.NEXT;
  }
  await Promise.all([storageRepository.saveTasks(tasks), storageRepository.savePlans(plans)]);
}

export async function addQuickTask(taskId) {
  const [tasks, plans] = await Promise.all([storageRepository.getTasks(), storageRepository.getPlans()]);
  const task = tasks.find((t) => t.id === taskId);
  if (!task || task.status === TASK_STATUS.DONE || task.status === TASK_STATUS.BLOCKED) throw new Error("This task cannot be added as a quick task.");
  const key = todayKey();
  const plan = plans[key] ?? { date: key, mainTaskId: null, quickTaskIds: [] };
  if (plan.mainTaskId === taskId) throw new Error("The main task is already on TODAY.");
  if ((plan.quickTaskIds ?? []).length >= MAX_QUICK_TASKS) throw new Error("TODAY can have at most 3 quick tasks.");
  if (!plan.quickTaskIds.includes(taskId)) plan.quickTaskIds.push(taskId);
  plans[key] = plan;
  await storageRepository.savePlans(plans);
}

export async function removeQuickTask(taskId) {
  const plans = await storageRepository.getPlans();
  const key = todayKey();
  if (!plans[key]) return;
  plans[key].quickTaskIds = (plans[key].quickTaskIds ?? []).filter((id) => id !== taskId);
  await storageRepository.savePlans(plans);
}

export async function startTask(taskId) {
  const tasks = await storageRepository.getTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found.");
  task.status = TASK_STATUS.IN_PROGRESS;
  task.startedAt = task.startedAt ?? now();
  await storageRepository.saveTasks(tasks);
}

export async function completeTask(taskId) {
  const [tasks, plans, goals] = await Promise.all([storageRepository.getTasks(), storageRepository.getPlans(), storageRepository.getGoals()]);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found.");
  task.status = TASK_STATUS.DONE;
  task.completedAt = now();
  task.blockedReason = "";

  for (const plan of Object.values(plans)) {
    if (plan.mainTaskId === taskId) plan.mainTaskId = null;
    plan.quickTaskIds = (plan.quickTaskIds ?? []).filter((id) => id !== taskId);
  }

  // Recompute dependency readiness after completion.
  for (const candidate of tasks) {
    if ([TASK_STATUS.BACKLOG, TASK_STATUS.READY].includes(candidate.status)) {
      candidate.status = normalizeTaskStatus(candidate, tasks);
    }
  }

  const goalTasks = tasks.filter((t) => t.goalId === task.goalId);
  const goal = goals.find((g) => g.id === task.goalId);
  if (goal && goalTasks.length && goalTasks.every((t) => t.status === TASK_STATUS.DONE)) {
    goal.status = "DONE";
    goal.completedAt = now();
  }

  await Promise.all([storageRepository.saveTasks(tasks), storageRepository.savePlans(plans), storageRepository.saveGoals(goals)]);
}

export async function blockTask(taskId, reason) {
  const tasks = await storageRepository.getTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found.");
  task.status = TASK_STATUS.BLOCKED;
  task.blockedReason = reason.trim() || "Blocked";
  await storageRepository.saveTasks(tasks);
}

export async function unblockTask(taskId) {
  const tasks = await storageRepository.getTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("Task not found.");
  task.blockedReason = "";
  task.status = normalizeTaskStatus({ ...task, status: TASK_STATUS.READY }, tasks);
  await storageRepository.saveTasks(tasks);
}

export async function createIdea({ title, notes = "" }) {
  const ideas = await storageRepository.getIdeas();
  const idea = { id: uid("idea"), title: title.trim(), notes: notes.trim(), createdAt: now() };
  ideas.unshift(idea);
  await storageRepository.saveIdeas(ideas);
  return idea;
}

export async function deleteIdea(ideaId) {
  const ideas = await storageRepository.getIdeas();
  await storageRepository.saveIdeas(ideas.filter((idea) => idea.id !== ideaId));
}

export async function convertIdeaToGoal(ideaId) {
  const ideas = await storageRepository.getIdeas();
  const idea = ideas.find((i) => i.id === ideaId);
  if (!idea) throw new Error("Idea not found.");
  await createGoal({ title: idea.title, description: idea.notes || `Finished outcome for: ${idea.title}` });
  await storageRepository.saveIdeas(ideas.filter((i) => i.id !== ideaId));
}

export function goalProgress(goalId, tasks) {
  const goalTasks = tasks.filter((t) => t.goalId === goalId);
  if (!goalTasks.length) return 0;
  return Math.round((goalTasks.filter((t) => t.status === TASK_STATUS.DONE).length / goalTasks.length) * 100);
}

export function goalFrontier(goalId, tasks) {
  const goalTasks = tasks.filter((t) => t.goalId === goalId && t.status !== TASK_STATUS.DONE);
  return goalTasks.find((t) => t.status === TASK_STATUS.IN_PROGRESS)
    ?? goalTasks.find((t) => t.status === TASK_STATUS.TODAY)
    ?? goalTasks.find((t) => t.status === TASK_STATUS.NEXT)
    ?? goalTasks.find((t) => t.status === TASK_STATUS.READY)
    ?? goalTasks.find((t) => t.status === TASK_STATUS.BACKLOG)
    ?? goalTasks.find((t) => t.status === TASK_STATUS.BLOCKED)
    ?? null;
}

export function recommendation(tasks) {
  const candidates = tasks.filter((t) => t.status === TASK_STATUS.NEXT && !t.blockedReason);
  return candidates.sort((a, b) => {
    const durationA = a.estimatedMinutes ?? 999;
    const durationB = b.estimatedMinutes ?? 999;
    if (durationA !== durationB) return durationA - durationB;
    return new Date(a.createdAt) - new Date(b.createdAt);
  })[0] ?? null;
}
