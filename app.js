import {
  addQuickTask, blockTask, completeTask, convertIdeaToGoal, createGoal, createIdea, createTask,
  deleteGoal, deleteIdea, deleteTask, getAppState, goalFrontier, goalProgress, makeToday,
  promoteToNext, recommendation, removeFromNext, removeQuickTask, removeToday, startTask, unblockTask, updateGoal, updateTask
} from "./src/application/taskService.js";
import { TASK_STATUS } from "./src/domain/constants.js";
import { escapeHtml, formatDate, todayKey } from "./src/shared/utils.js";
import { authRepository } from "./src/infrastructure/auth.js";
import { storageRepository } from "./src/infrastructure/storage.js";
import { taskSuggestionProvider } from "./src/infrastructure/aiTaskSuggestionProvider.js";

const viewEl = document.querySelector("#view");
const titleEl = document.querySelector("#view-title");
const modalBackdrop = document.querySelector("#modal-backdrop");
const modalEl = document.querySelector("#modal");
const navEl = document.querySelector("#nav");
document.querySelector("#app-date").textContent = formatDate();

let currentView = "today";
let timerHandle = null;
let taskSuggestions = [];
let suggestionGoalId = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function toast(message, error = false) {
  const root = $("#toast-root");
  root.innerHTML = `<div class="toast ${error ? "error" : ""}">${escapeHtml(message)}</div>`;
  setTimeout(() => { root.innerHTML = ""; }, 2600);
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
  modalEl.innerHTML = "";
}

function openModal(html) {
  modalEl.innerHTML = html;
  modalBackdrop.classList.remove("hidden");
}

async function render(view = currentView) {
  currentView = view;
  titleEl.textContent = view === "today" ? "Today" : view === "next" ? "Next" : view === "later" ? "Later" : view === "ideas" ? "Ideas" : "History";
  $$("nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  const state = await getAppState();
  if (view === "today") renderToday(state);
  if (view === "next") renderNext(state);
  if (view === "later") renderLater(state);
  if (view === "ideas") renderIdeas(state);
  if (view === "history") renderHistory(state);
}

function renderToday(state) {
  const plan = state.plans[todayKey()] ?? { mainTaskId: null, quickTaskIds: [] };
  const goals = new Map(state.goals.map((g) => [g.id, g]));
  const main = state.tasks.find((t) => t.id === plan.mainTaskId && t.status !== TASK_STATUS.DONE);
  const quick = (plan.quickTaskIds ?? []).map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean).filter((t) => t.status !== TASK_STATUS.DONE);
  const rec = recommendation(state.tasks);

  const mainHtml = main ? `
    <section class="hero-task">
      <div>
        <div class="kicker">YOUR MAIN TASK</div>
        <h2>${escapeHtml(main.title)}</h2>
        <div class="meta"><span>${escapeHtml(goals.get(main.goalId)?.title ?? "Goal")}</span>${main.estimatedMinutes ? `<span>• ~${main.estimatedMinutes} min</span>` : ""}${main.status === TASK_STATUS.IN_PROGRESS ? `<span>• In progress</span>` : ""}</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-task-action="edit" data-task-id="${main.id}">Edit</button>
        <button class="btn primary-light" data-task-action="start" data-task-id="${main.id}">${main.status === TASK_STATUS.IN_PROGRESS ? "Resume" : "Start"}</button>
        <button class="btn ghost" data-task-action="remove-today" data-task-id="${main.id}">Remove focus</button>
      </div>
    </section>` : `
    <section class="empty">
      <h2 style="margin:0;color:var(--text)">Nothing planned for today.</h2>
      <p>${rec ? `Your next recommendation is <strong>${escapeHtml(rec.title)}</strong>.` : "Your NEXT queue is empty. Choose something from LATER."}</p>
      ${rec ? `<button class="btn" data-task-action="today" data-task-id="${rec.id}">Make this today's task</button>` : `<button class="btn" data-go="later">Browse goals</button>`}
    </section>`;

  viewEl.innerHTML = `
    ${mainHtml}
    <section class="section">
      <div class="section-title"><h2>Quick</h2><span class="muted" style="font-size:12px">${quick.length}/3</span></div>
      <div class="quick-list">
        ${quick.length ? quick.map((t) => `<div class="row"><div class="grow"><div class="title">${escapeHtml(t.title)}</div><div class="sub">${escapeHtml(goals.get(t.goalId)?.title ?? "Goal")}</div></div><div class="row-actions"><button class="btn small secondary" data-task-action="complete" data-task-id="${t.id}">Complete</button><button class="btn small ghost" data-task-action="remove-quick" data-task-id="${t.id}">Remove</button></div></div>`).join("") : `<div class="muted" style="font-size:13px;padding:4px 2px">Optional. Keep these small so they never compete with your main task.</div>`}
      </div>
    </section>`;

  bindCommonActions();
}

function renderNext(state) {
  const goals = new Map(state.goals.map((g) => [g.id, g]));
  const plan = state.plans[todayKey()] ?? { mainTaskId: null, quickTaskIds: [] };
  const tasks = state.tasks.filter((t) => t.status === TASK_STATUS.NEXT || t.id === plan.mainTaskId);
  viewEl.innerHTML = `
    <div class="section-title"><div><h2>Your prepared queue</h2><div class="muted" style="font-size:12px;margin-top:4px">Ready to execute. Keep it small and intentional.</div></div><span class="badge">${tasks.length}/7</span></div>
    <div class="queue">
      ${tasks.length ? tasks.map((t, i) => {
        const isMain = plan.mainTaskId === t.id;
        const isQuick = (plan.quickTaskIds ?? []).includes(t.id);
        return `<div class="row"><div class="queue-index">${i + 1}</div><div class="grow"><div class="title">${escapeHtml(t.title)}</div><div class="sub">${escapeHtml(goals.get(t.goalId)?.title ?? "Goal")}${t.estimatedMinutes ? ` · ~${t.estimatedMinutes} min` : ""}</div></div><div class="row-actions"><button class="btn small" data-task-action="${isMain ? "remove-today" : "today"}" data-task-id="${t.id}">${isMain ? "Remove today's focus" : "Make today"}</button>${isMain ? "" : `<button class="btn small secondary" data-task-action="${isQuick ? "remove-quick" : "quick"}" data-task-id="${t.id}">${isQuick ? "Remove from quick" : "Quick"}</button><button class="btn small ghost" data-task-action="remove-next" data-task-id="${t.id}">Later</button>`}</div></div>`;
      }).join("") : `<div class="empty">Your queue is empty.<br><br><button class="btn" data-go="later">Browse Goals</button></div>`}
    </div>`;
  bindCommonActions();
}

function renderLater(state) {
  const goals = state.goals.filter((g) => g.status !== "DONE");
  viewEl.innerHTML = `
    <div class="section-title"><div><h2>Goals</h2><div class="muted" style="font-size:12px;margin-top:4px">Capture the outcome. Keep the next executable action obvious.</div></div><button class="btn secondary" data-create="goal">+ New Goal</button></div>
    <div class="goal-list">
      ${goals.length ? goals.map((goal) => goalCard(goal, state.tasks)).join("") : `<div class="empty"><h2 style="color:var(--text)">What are you trying to accomplish?</h2><p>Create your first Goal.</p><button class="btn" data-create="goal">+ New Goal</button></div>`}
    </div>`;
  bindCommonActions();
}

function goalCard(goal, tasks) {
  const goalTasks = tasks.filter((t) => t.goalId === goal.id);
  const remaining = goalTasks.filter((t) => t.status !== TASK_STATUS.DONE).length;
  const progress = goalProgress(goal.id, tasks);
  const frontier = goalFrontier(goal.id, tasks);
  const collapsed = goal.collapsed === true;
  return `
    <article class="goal-card">
      <div class="goal-head">
        <div><h3>🎯 ${escapeHtml(goal.title)}</h3><p>${escapeHtml(goal.description)}</p></div>
        <div class="row-actions">
          <button
            class="btn small ghost goal-collapse"
            data-goal-action="toggle-collapse"
            data-goal-id="${goal.id}"
            aria-expanded="${!collapsed}"
            aria-controls="goal-content-${goal.id}"
            title="${collapsed ? "Expand goal" : "Collapse goal"}">${collapsed ? "Expand goal" : "Collapse goal"}</button>
          <button
            class="btn small secondary"
            data-goal-action="suggest"
            data-goal-id="${goal.id}">✨ Suggest tasks</button>
          <button
            class="btn small secondary"
            data-create-task-for="${goal.id}">+ Task</button>
          <button
            class="btn small ghost"
            data-goal-action="edit"
            data-goal-id="${goal.id}">Edit</button>
        </div>
      </div>
      <div id="goal-content-${goal.id}" class="goal-content"${collapsed ? " hidden" : ""}>
        <div class="progress"><span style="width:${progress}%"></span></div>
        <div class="muted" style="font-size:11px">${progress}% complete · ${remaining} task${remaining === 1 ? "" : "s"} remaining</div>
        ${frontier ? `<div class="frontier"><div><div class="muted">CURRENT FRONTIER</div><strong>→ ${escapeHtml(frontier.title)}</strong></div><div class="row-actions">${frontier.status === TASK_STATUS.READY || frontier.status === TASK_STATUS.BACKLOG ? `<button class="btn small" data-task-action="next" data-task-id="${frontier.id}">Add to NEXT</button>` : ""}${frontier.status === TASK_STATUS.BLOCKED ? `<span class="badge blocked">Blocked</span>` : ""}</div></div>` : ""}
        <div class="goal-tasks">
          ${goalTasks.length ? goalTasks.map((t) => taskLine(t)).join("") : `<div class="muted" style="font-size:12px;padding:10px 2px">No tasks yet. Break this goal into executable actions.</div>`}
        </div>
      </div>
    </article>`;
}

function taskLine(task) {
  const classes = [task.status === TASK_STATUS.DONE ? "done" : "", task.status === TASK_STATUS.BLOCKED ? "blocked" : ""].join(" ");
  const statusLabel = task.status === TASK_STATUS.DONE ? "✓" : task.status === TASK_STATUS.BLOCKED ? "!" : task.status === TASK_STATUS.NEXT ? "N" : task.status === TASK_STATUS.TODAY || task.status === TASK_STATUS.IN_PROGRESS ? "T" : "";
  return `<div class="task-line ${classes}"><div class="dot">${statusLabel}</div><div class="grow"><div class="title">${escapeHtml(task.title)}</div>${task.blockedReason ? `<div class="sub">Blocked: ${escapeHtml(task.blockedReason)}</div>` : ""}</div><div class="row-actions">${[TASK_STATUS.BACKLOG, TASK_STATUS.READY].includes(task.status) ? `<button class="btn small secondary" data-task-action="next" data-task-id="${task.id}">Add to NEXT</button>` : ""}${task.status === TASK_STATUS.BLOCKED ? `<button class="btn small secondary" data-task-action="unblock" data-task-id="${task.id}">Unblock</button>` : task.status !== TASK_STATUS.DONE ? `<button class="btn small ghost" data-task-action="block" data-task-id="${task.id}">Block</button>` : ""}<button class="btn small ghost" data-task-action="edit" data-task-id="${task.id}">Edit</button></div></div>`;
}

function renderIdeas(state) {
  viewEl.innerHTML = `
    <div class="section-title"><div><h2>Ideas are not commitments.</h2><div class="muted" style="font-size:12px;margin-top:4px">Capture quickly. Decide later whether an idea deserves a Goal.</div></div><button class="btn" data-create="idea">+ Capture Idea</button></div>
    <div class="idea-list">
      ${state.ideas.length ? state.ideas.map((idea) => `<article class="idea-card"><div class="idea-icon">💡</div><div class="grow"><div class="title">${escapeHtml(idea.title)}</div>${idea.notes ? `<div class="sub">${escapeHtml(idea.notes)}</div>` : ""}</div><div class="row-actions"><button class="btn small secondary" data-idea-action="convert" data-idea-id="${idea.id}">Make Goal</button><button class="btn small ghost" data-idea-action="delete" data-idea-id="${idea.id}">Delete</button></div></article>`).join("") : `<div class="empty"><h2 style="color:var(--text)">Have an idea?</h2><p>Capture it here without committing to it.</p><button class="btn" data-create="idea">+ Capture Idea</button></div>`}
    </div>`;
  bindCommonActions();
}

function renderHistory(state) {
  const goals = new Map(state.goals.map((g) => [g.id, g]));
  const done = state.tasks.filter((t) => t.status === TASK_STATUS.DONE).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  viewEl.innerHTML = `<div class="section-title"><div><h2>Recently completed</h2><div class="muted" style="font-size:12px;margin-top:4px">Visible progress, without turning work into analytics.</div></div></div><div class="history-list">${done.length ? done.map((t) => `<div class="row"><div class="queue-index">✓</div><div class="grow"><div class="title">${escapeHtml(t.title)}</div><div class="sub">${escapeHtml(goals.get(t.goalId)?.title ?? "Goal")} · ${new Date(t.completedAt).toLocaleString()}</div></div></div>`).join("") : `<div class="empty">Completed tasks will appear here.</div>`}</div>`;
}

async function openGoalModal(goalId = null) {
  const state = await getAppState();
  const goal = state.goals.find((g) => g.id === goalId);
  openModal(`
    <h2>${goal ? "Edit Goal" : "New Goal"}</h2>
    <p>Define a meaningful outcome. What does finished look like?</p>
    <form id="goal-form" class="form-grid">
      <label class="label">Goal name<input class="input" name="title" required value="${escapeHtml(goal?.title ?? "")}" placeholder="Build my portfolio"></label>
      <label class="label">Desired outcome<textarea class="textarea" rows="3" name="description" required placeholder="A deployed interactive portfolio website built with Flutter.">${escapeHtml(goal?.description ?? "")}</textarea></label>
      <div class="form-row-2"><label class="label">Deadline (optional)<input class="input" type="date" name="deadline" value="${escapeHtml(goal?.deadline ?? "")}"></label><label class="label">Notes (optional)<input class="input" name="notes" value="${escapeHtml(goal?.notes ?? "")}"></label></div>
      <div class="modal-actions">${goal ? `<button type="button" class="btn danger" id="delete-goal">Delete</button>` : ""}<button type="button" class="btn secondary" id="cancel-modal">Cancel</button><button class="btn" type="submit">${goal ? "Save" : "Create Goal"}</button></div>
    </form>`);
  $("#cancel-modal").onclick = closeModal;
  if (goal) $("#delete-goal").onclick = async () => { if (confirm("Delete this goal and all its tasks?")) { await deleteGoal(goal.id); closeModal(); render("later"); } };
  $("#goal-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try { goal ? await updateGoal(goal.id, data) : await createGoal(data); closeModal(); render("later"); toast(goal ? "Goal updated." : "Goal created."); } catch (err) { toast(err.message, true); }
  };
}

async function openTaskModal(taskId = null, presetGoalId = null) {
  const state = await getAppState();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!state.goals.length) { toast("Create a Goal first.", true); return openGoalModal(); }
  const goalId = task?.goalId ?? presetGoalId ?? state.goals[0].id;
  const dependencies = state.tasks.filter((t) => t.id !== taskId && t.goalId === goalId && t.status !== TASK_STATUS.DONE);
  openModal(`
    <h2>${task ? "Edit Task" : "New Task"}</h2>
    <p>Use the smallest meaningful unit that requires no additional planning.</p>
    <form id="task-form" class="form-grid">
      <label class="label">Task title<input class="input" name="title" required value="${escapeHtml(task?.title ?? "")}" placeholder="Implement AuthRepository.login"></label>
      <label class="label">Goal<select class="select" name="goalId" id="task-goal">${state.goals.filter((g) => g.status !== "DONE").map((g) => `<option value="${g.id}" ${g.id === goalId ? "selected" : ""}>${escapeHtml(g.title)}</option>`).join("")}</select></label>
      <div class="form-row-2"><label class="label">Estimated minutes<input class="input" min="1" type="number" name="estimatedMinutes" value="${task?.estimatedMinutes ?? ""}" placeholder="45"></label><label class="label">Depends on<select class="select" name="dependencyId" id="dependency-select"><option value="">None</option>${dependencies.map((d) => `<option value="${d.id}" ${task?.dependencyIds?.includes(d.id) ? "selected" : ""}>${escapeHtml(d.title)}</option>`).join("")}</select></label></div>
      <label class="label">Notes (optional)<textarea class="textarea" rows="3" name="notes">${escapeHtml(task?.notes ?? "")}</textarea></label>
      <div class="modal-actions">${task ? `<button type="button" class="btn danger" id="delete-task">Delete</button>` : ""}<button type="button" class="btn secondary" id="cancel-modal">Cancel</button><button class="btn" type="submit">${task ? "Save" : "Add Task"}</button></div>
    </form>`);
  $("#cancel-modal").onclick = closeModal;
  $("#task-goal").onchange = () => openTaskModal(taskId, $("#task-goal").value);
  if (task) $("#delete-task").onclick = async () => { if (confirm("Delete this task?")) { await deleteTask(task.id); closeModal(); render(currentView); } };
  $("#task-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    data.dependencyIds = data.dependencyId ? [data.dependencyId] : [];
    delete data.dependencyId;
    try { task ? await updateTask(task.id, data) : await createTask(data); closeModal(); render(currentView === "today" ? "later" : currentView); toast(task ? "Task updated." : "Task added."); } catch (err) { toast(err.message, true); }
  };
}

function openIdeaModal() {
  openModal(`
    <h2>Capture Idea</h2><p>Fast capture. No commitment.</p>
    <form id="idea-form" class="form-grid">
      <label class="label">Idea<input class="input" name="title" required autofocus placeholder="Build a YouTube channel about algorithms"></label>
      <label class="label">Notes (optional)<textarea class="textarea" rows="3" name="notes"></textarea></label>
      <div class="modal-actions"><button type="button" class="btn secondary" id="cancel-modal">Cancel</button><button class="btn" type="submit">Capture</button></div>
    </form>`);
  $("#cancel-modal").onclick = closeModal;
  $("#idea-form").onsubmit = async (e) => { e.preventDefault(); await createIdea(Object.fromEntries(new FormData(e.currentTarget))); closeModal(); render("ideas"); toast("Idea captured."); };
}

async function openSearch() {
  const state = await getAppState();
  openModal(`<h2>Search</h2><p>Find goals and tasks fast.</p><input class="input" id="search-input" autofocus placeholder="Search goals and tasks..."><div class="search-results" id="search-results"></div><div class="modal-actions"><button class="btn secondary" id="cancel-modal">Close</button></div>`);
  $("#cancel-modal").onclick = closeModal;
  const input = $("#search-input");
  const results = $("#search-results");
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return results.innerHTML = "";
    const goals = state.goals.filter((g) => `${g.title} ${g.description}`.toLowerCase().includes(q)).slice(0, 6);
    const tasks = state.tasks.filter((t) => `${t.title} ${t.notes}`.toLowerCase().includes(q)).slice(0, 8);
    results.innerHTML = [...goals.map((g) => `<div class="search-hit"><strong>🎯 ${escapeHtml(g.title)}</strong><div class="sub">Goal</div></div>`), ...tasks.map((t) => `<div class="search-hit"><strong>${escapeHtml(t.title)}</strong><div class="sub">Task</div></div>`)].join("") || `<div class="muted">No results.</div>`;
  };
  input.focus();
}

async function openBlockModal(taskId) {
  openModal(`<h2>Block task</h2><p>Add a short reason so future-you knows what is waiting.</p><form id="block-form" class="form-grid"><label class="label">Blocking reason<input class="input" name="reason" required placeholder="Waiting for Stripe credentials"></label><div class="modal-actions"><button type="button" class="btn secondary" id="cancel-modal">Cancel</button><button class="btn" type="submit">Mark blocked</button></div></form>`);
  $("#cancel-modal").onclick = closeModal;
  $("#block-form").onsubmit = async (e) => { e.preventDefault(); const { reason } = Object.fromEntries(new FormData(e.currentTarget)); await blockTask(taskId, reason); closeModal(); render(currentView); };
}

async function toggleGoalCollapse(goalId) {
  const state = await getAppState();
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal) return;
  await updateGoal(goalId, { collapsed: goal.collapsed !== true });
  await render(currentView);
}

async function showFocus(taskId) {
  if (timerHandle) clearInterval(timerHandle);
  const state = await getAppState();
  const task = state.tasks.find((t) => t.id === taskId);
  const goal = state.goals.find((g) => g.id === task?.goalId);
  if (!task) return;
  if (task.status !== TASK_STATUS.IN_PROGRESS) await startTask(task.id);
  const overlay = document.createElement("section");
  overlay.className = "focus-view";
  overlay.innerHTML = `<div class="focus-card"><div class="label-focus">FOCUS</div><h2>${escapeHtml(task.title)}</h2><div class="goal">${escapeHtml(goal?.title ?? "Goal")}</div><div class="timer" id="timer">00:00</div><div class="focus-actions"><button class="btn secondary" id="exit-focus">Back</button><button class="btn" id="complete-focus">Complete</button></div></div>`;
  document.body.appendChild(overlay);
  const started = new Date(task.startedAt ?? new Date().toISOString()).getTime();
  const tick = () => { const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000)); const m = String(Math.floor(seconds / 60)).padStart(2, "0"); const s = String(seconds % 60).padStart(2, "0"); $("#timer", overlay).textContent = `${m}:${s}`; };
  tick(); timerHandle = setInterval(tick, 1000);
  $("#exit-focus", overlay).onclick = () => { clearInterval(timerHandle); overlay.remove(); history.replaceState(null, "", "index.html"); render("today"); };
  $("#complete-focus", overlay).onclick = async () => { await completeTask(task.id); clearInterval(timerHandle); overlay.remove(); history.replaceState(null, "", "index.html"); toast("✓ Task completed"); render("today"); };
}

function bindCommonActions() {
  $$('[data-go]').forEach((el) => el.onclick = () => render(el.dataset.go));
  $$('[data-create="goal"]').forEach((el) => el.onclick = () => openGoalModal());
  $$('[data-create="idea"]').forEach((el) => el.onclick = () => openIdeaModal());
  $$('[data-create-task-for]').forEach((el) => el.onclick = () => openTaskModal(null, el.dataset.createTaskFor));
  $$("[data-goal-action]").forEach(
    (el) => {
      el.onclick = () => {
        if (
          el.dataset.goalAction ===
          "edit"
        ) {
          return openGoalModal(
            el.dataset.goalId
          );
        }

        if (el.dataset.goalAction === "toggle-collapse") {
          return toggleGoalCollapse(el.dataset.goalId).catch((err) => toast(err.message, true));
        }

        if (
          el.dataset.goalAction ===
          "suggest"
        ) {
          return openTaskSuggestions(
            el.dataset.goalId
          );
        }
      };
    }
  );
  $$('[data-idea-action]').forEach((el) => el.onclick = async () => {
    try {
      if (el.dataset.ideaAction === "convert") await convertIdeaToGoal(el.dataset.ideaId);
      if (el.dataset.ideaAction === "delete") await deleteIdea(el.dataset.ideaId);
      render("ideas");
    } catch (err) { toast(err.message, true); }
  });
  $$('[data-task-action]').forEach((el) => el.onclick = async () => {
    const id = el.dataset.taskId;
    try {
      switch (el.dataset.taskAction) {
        case "next": await promoteToNext(id); break;
        case "remove-next": await removeFromNext(id); break;
        case "today": await makeToday(id); break;
        case "remove-today": await removeToday(id); break;
        case "quick": await addQuickTask(id); break;
        case "remove-quick": await removeQuickTask(id); break;
        case "complete": await completeTask(id); break;
        case "start": return showFocus(id);
        case "edit": return openTaskModal(id);
        case "block": return openBlockModal(id);
        case "unblock": await unblockTask(id); break;
      }
      render(currentView);
    } catch (err) { toast(err.message, true); }
  });
}

navEl.addEventListener("click", (e) => { const btn = e.target.closest("button[data-view]"); if (btn) render(btn.dataset.view); });
$("#new-goal").onclick = () => openGoalModal();
$("#new-task").onclick = () => openTaskModal();
$("#history-btn").onclick = () => render("history");
$("#search-btn").onclick = openSearch;
modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });

document.addEventListener("keydown", (e) => {
  if (!modalBackdrop.classList.contains("hidden")) { if (e.key === "Escape") closeModal(); return; }
  const tag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); return openSearch(); }
  const key = e.key.toLowerCase();
  if (key === "t") render("today");
  if (key === "x") render("next");
  if (key === "l") render("later");
  if (key === "i") render("ideas");
  if (key === "n") openTaskModal();
  if (key === "g") openGoalModal();
  if (e.key === "Escape") closeModal();
});

async function renderAccountArea(access) {
  const area = $("#account-area");
  if (!area) return;
  if (access.mode === "account") {
    const sync = await storageRepository.getSyncStatus();
    const pending = sync.pending?.length ?? 0;
    area.innerHTML = `<div class="account-card"><strong>${escapeHtml(access.session.email || "Signed in")}</strong><span>${pending ? `${pending} section${pending === 1 ? "" : "s"} waiting to sync` : "Firebase sync active"}</span><button id="sign-out">Sign out</button></div>`;
    $("#sign-out").onclick = async () => {
      await authRepository.signOut();
      storageRepository.resetRuntimeState();
      location.replace("login.html");
    };
  } else {
    area.innerHTML = `<div class="account-card"><strong>Offline mode</strong><span>Stored only on this browser</span><button id="sign-in-cloud">Sign in to sync</button></div>`;
    $("#sign-in-cloud").onclick = () => location.href = "login.html";
  }
}

function renderTaskSuggestions(goal) {
  const list = $("#ai-suggestion-list");
  const actions = $("#ai-suggestion-actions");

  if (!list || !actions) return;

  if (!taskSuggestions.length) {
    list.innerHTML = `
      <div class="ai-empty">
        No suggestions left.
        You can close this window or suggest a fresh set.
      </div>
    `;
  } else {
    list.innerHTML = taskSuggestions
      .map(
        (suggestion, index) => `
          <div class="ai-suggestion-row">

            <div class="ai-suggestion-copy">

              <strong>
                ${escapeHtml(suggestion.title)}
              </strong>

              <div class="sub">
                ~${suggestion.estimatedMinutes} min
                ${suggestion.notes
            ? ` · ${escapeHtml(suggestion.notes)}`
            : ""
          }
              </div>

            </div>

            <div class="row-actions">

              <button
                class="btn small"
                data-ai-action="add"
                data-index="${index}"
              >
                Add
              </button>

              <button
                class="btn small ghost"
                data-ai-action="remove"
                data-index="${index}"
              >
                Remove
              </button>

            </div>

          </div>
        `
      )
      .join("");
  }

  actions.innerHTML = `
    <button
      type="button"
      class="btn secondary"
      id="suggest-again"
    >
      Suggest again
    </button>

    <button
      type="button"
      class="btn"
      id="close-suggestions"
    >
      Done
    </button>
  `;

  $$(
    "[data-ai-action]",
    list
  ).forEach((button) => {
    button.onclick = async () => {
      const index =
        Number(button.dataset.index);

      const suggestion =
        taskSuggestions[index];

      if (!suggestion) return;

      if (
        button.dataset.aiAction ===
        "remove"
      ) {
        taskSuggestions.splice(
          index,
          1
        );

        renderTaskSuggestions(goal);

        return;
      }

      button.disabled = true;
      button.textContent =
        "Adding...";

      try {
        await createTask({
          goalId: goal.id,

          title:
            suggestion.title,

          estimatedMinutes:
            suggestion.estimatedMinutes,

          notes:
            suggestion.notes
        });

        taskSuggestions.splice(
          index,
          1
        );

        renderTaskSuggestions(goal);

        toast("Task added.");
      } catch (err) {
        button.disabled = false;
        button.textContent = "Add";

        toast(
          err.message,
          true
        );
      }
    };
  });

  $("#close-suggestions").onclick =
    () => {
      closeModal();

      render("later");
    };

  $("#suggest-again").onclick =
    () =>
      loadTaskSuggestions(
        goal.id
      );
}

async function loadTaskSuggestions(
  goalId
) {
  const state =
    await getAppState();

  const goal =
    state.goals.find(
      (item) =>
        item.id === goalId
    );

  if (!goal) return;

  suggestionGoalId =
    goalId;

  const list =
    $("#ai-suggestion-list");

  const actions =
    $("#ai-suggestion-actions");

  if (list) {
    list.innerHTML = `
      <div class="ai-loading">

        <span class="ai-spinner"></span>

        <div>

          <strong>
            Breaking this goal into actions...
          </strong>

          <span>
            Looking at the goal and the tasks
            you already have.
          </span>

        </div>

      </div>
    `;
  }

  if (actions) {
    actions.innerHTML = `
      <button
        type="button"
        class="btn secondary"
        id="cancel-ai"
      >
        Cancel
      </button>
    `;
  }

  if ($("#cancel-ai")) {
    $("#cancel-ai").onclick =
      closeModal;
  }

  try {
    taskSuggestions =
      await taskSuggestionProvider
        .suggestTasks({
          goal,

          existingTasks:
            state.tasks.filter(
              (task) =>
                task.goalId ===
                goal.id &&
                task.status !==
                TASK_STATUS.DONE
            )
        });

    if (
      suggestionGoalId !==
      goalId
    ) {
      return;
    }

    renderTaskSuggestions(
      goal
    );
  } catch (err) {
    if (!list) return;

    list.innerHTML = `
      <div class="ai-error">

        <strong>
          Couldn’t suggest tasks
        </strong>

        <span>
          ${escapeHtml(err.message)}
        </span>

      </div>
    `;

    if (actions) {
      actions.innerHTML = `
        <button
          type="button"
          class="btn secondary"
          id="close-ai-error"
        >
          Close
        </button>

        <button
          type="button"
          class="btn"
          id="retry-ai"
        >
          Retry
        </button>
      `;
    }

    if ($("#close-ai-error")) {
      $("#close-ai-error").onclick =
        closeModal;
    }

    if ($("#retry-ai")) {
      $("#retry-ai").onclick =
        () =>
          loadTaskSuggestions(
            goalId
          );
    }
  }
}


async function openTaskSuggestions(
  goalId
) {
  const state =
    await getAppState();

  const goal =
    state.goals.find(
      (item) =>
        item.id === goalId
    );

  if (!goal) {
    return toast(
      "Goal not found.",
      true
    );
  }

  taskSuggestions = [];

  suggestionGoalId =
    goalId;

  openModal(`
    <div class="ai-modal-head">

      <div class="ai-badge">
        AI
      </div>

      <div>

        <h2>
          Suggest tasks
        </h2>

        <p>
          ${escapeHtml(goal.title)}
        </p>

      </div>

    </div>

    <div
      id="ai-suggestion-list"
      class="ai-suggestion-list"
    ></div>

    <div
      id="ai-suggestion-actions"
      class="modal-actions"
    ></div>
  `);

  await loadTaskSuggestions(
    goalId
  );
}

async function init() {
  const access = await authRepository.getAccessState();
  if (access.mode === "none") {
    location.replace("login.html");
    return;
  }
  await renderAccountArea(access);
  const hash = location.hash;
  if (hash === "#new-task") await openTaskModal();
  else if (hash.startsWith("#focus:")) await showFocus(hash.slice(7));
  else await render("today");
}

init();