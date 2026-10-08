import {
  addQuickTask, blockTask, completeTask, convertIdeaToGoal, createGoal, createIdea, createTask,
  deleteGoal, deleteIdea, deleteTask, dropTask, getAppState, getJournalEntry, getRecentJournalDates, goalFrontier,
  goalProgress, makeToday, promoteToNext, recommendation, removeFromNext, removeQuickTask, removeToday,
  saveJournalEntry, startTask, unblockTask, updateGoal, updateTask
} from "./src/application/taskService.js";
import {
  checkInHabit, createHabit, getHabitWeekDates, getHabitWeeklySummary, isHabitScheduled,
  setHabitStatus, updateHabit
} from "./src/application/habitService.js";
import { TASK_STATUS } from "./src/domain/constants.js";
import {
  escapeHtml, formatDate, formatJournalDate, formatShortDate, formatTimeOnly,
  shiftDateKey, todayKey
} from "./src/shared/utils.js";
import { authRepository } from "./src/infrastructure/auth.js";
import { storageRepository } from "./src/infrastructure/storage.js";
import { taskSuggestionProvider } from "./src/infrastructure/aiTaskSuggestionProvider.js";

// Universal Chrome storage polyfill for standard web environments
if (typeof window !== "undefined") {
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.storage) {
    window.chrome.storage = {
      local: {
        async get(keys) {
          const res = {};
          const keyList = Array.isArray(keys) ? keys : (typeof keys === "string" ? [keys] : Object.keys(keys || {}));
          for (const k of keyList) {
            const val = localStorage.getItem(k);
            if (val !== null) {
              try { res[k] = JSON.parse(val); } catch { res[k] = val; }
            }
          }
          return res;
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) {
            localStorage.setItem(k, JSON.stringify(v));
          }
        },
        async remove(keys) {
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const k of keyList) {
            localStorage.removeItem(k);
          }
        }
      }
    };
  }
}

const viewEl = document.querySelector("#view");
const titleEl = document.querySelector("#view-title");
const modalBackdrop = document.querySelector("#modal-backdrop");
const modalEl = document.querySelector("#modal");
const navEl = document.querySelector("#nav");

let currentView = "today";
let currentJournalDate = todayKey();
let isJournalHeatmapOpen = false;
let journalSaveTimer = null;
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

function setJournalStatus(statusText) {
  const el = $("#journal-status");
  if (el) {
    el.textContent = statusText;
    el.dataset.status = statusText.toLowerCase();
  }
}

function triggerJournalAutoSave() {
  setJournalStatus("Saving...");
  if (journalSaveTimer) clearTimeout(journalSaveTimer);
  journalSaveTimer = setTimeout(async () => {
    await flushJournalSave();
  }, 350);
}

async function flushJournalSave() {
  if (journalSaveTimer) {
    clearTimeout(journalSaveTimer);
    journalSaveTimer = null;
  }
  const editor = $("#journal-editor");
  if (editor && editor.dataset.date) {
    const text = editor.value;
    const date = editor.dataset.date;
    try {
      const savedEntry = await saveJournalEntry(date, text);
      setJournalStatus("Saved");
      return savedEntry;
    } catch (e) {
      setJournalStatus("Save failed");
    }
  }
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(340, textarea.scrollHeight)}px`;
}

function insertJournalThought(slotName = "") {
  const editor = $("#journal-editor");
  if (!editor) return;
  const timeStr = formatTimeOnly(new Date());
  const header = slotName ? `${timeStr} — ${slotName}` : timeStr;

  const text = editor.value;
  const start = editor.selectionStart ?? text.length;
  const end = editor.selectionEnd ?? text.length;

  const before = text.slice(0, start);
  const after = text.slice(end);

  let prefix = "";
  if (before.length > 0) {
    if (before.endsWith("\n\n")) prefix = "";
    else if (before.endsWith("\n")) prefix = "\n";
    else prefix = "\n\n";
  }

  const insertion = `${prefix}${header}\n\n`;
  editor.value = before + insertion + after;
  const newPos = start + insertion.length;
  editor.focus();
  editor.setSelectionRange(newPos, newPos);
  autoResizeTextarea(editor);
  triggerJournalAutoSave();
}

function getTasksForDate(state, dateKey) {
  const plan = state.plans[dateKey] ?? { mainTaskId: null, quickTaskIds: [] };
  const goals = new Map(state.goals.map((g) => [g.id, g]));

  const tasks = [];
  const addedIds = new Set();

  if (plan.mainTaskId) {
    const main = state.tasks.find((t) => t.id === plan.mainTaskId);
    if (main) {
      tasks.push({ task: main, role: "main", goal: goals.get(main.goalId) });
      addedIds.add(main.id);
    }
  }

  for (const qid of (plan.quickTaskIds ?? [])) {
    if (addedIds.has(qid)) continue;
    const q = state.tasks.find((t) => t.id === qid);
    if (q) {
      tasks.push({ task: q, role: "quick", goal: goals.get(q.goalId) });
      addedIds.add(qid);
    }
  }

  for (const t of state.tasks) {
    if (addedIds.has(t.id)) continue;
    if (t.status === TASK_STATUS.DONE && t.completedAt) {
      const compKey = todayKey(new Date(t.completedAt));
      if (compKey === dateKey) {
        tasks.push({ task: t, role: "completed", goal: goals.get(t.goalId) });
        addedIds.add(t.id);
      }
    }
  }

  return tasks;
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
  modalEl.innerHTML = "";
}

function openModal(html) {
  modalEl.innerHTML = html;
  modalBackdrop.classList.remove("hidden");
}

/* System Telemetry & Date Matrix */
function updateSystemDateMetadata(date = new Date()) {
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));

  // ISO Week Calculation
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  const weekNum = 1 + Math.ceil((firstThursday - target) / 604800000);
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  const year = date.getFullYear();

  const metaDay = $("#meta-day");
  const metaWeek = $("#meta-week");
  const metaQuarter = $("#meta-quarter");
  const appDate = $("#app-date");

  if (metaDay) metaDay.textContent = `DAY ${dayOfYear}`;
  if (metaWeek) metaWeek.textContent = `WK ${weekNum}`;
  if (metaQuarter) metaQuarter.textContent = `Q${quarter} ${year}`;
  if (appDate) {
    const formatted = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
    appDate.textContent = formatted;
  }
}

function startSystemTelemetryClock() {
  const updateClock = () => {
    const clockEl = $("#telemetry-clock");
    if (clockEl) {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, "0");
      const m = String(now.getMinutes()).padStart(2, "0");
      const s = String(now.getSeconds()).padStart(2, "0");
      clockEl.textContent = `${h}:${m}:${s}`;
    }
  };
  updateClock();
  setInterval(updateClock, 1000);
}

async function render(view = currentView) {
  await flushJournalSave();
  currentView = view;
  const viewTitles = {
    today: "TODAY",
    next: "NEXT",
    later: "LATER",
    habits: "HABITS",
    journal: "JOURNAL",
    ideas: "IDEAS",
    history: "HISTORY"
  };
  titleEl.textContent = viewTitles[view] ?? view.toUpperCase();

  $$("nav .nav-btn").forEach((b) => {
    const isActive = b.dataset.view === view;
    b.classList.toggle("active", isActive);
    const ind = b.querySelector(".nav-status-indicator");
    if (ind) {
      ind.textContent = isActive ? "●" : "○";
      ind.classList.toggle("active-dot", isActive);
    }
  });

  const state = await getAppState();
  if (view === "today") renderToday(state);
  if (view === "next") renderNext(state);
  if (view === "later") renderLater(state);
  if (view === "habits") renderHabits(state);
  if (view === "journal") renderJournal(state, currentJournalDate);
  if (view === "ideas") renderIdeas(state);
  if (view === "history") renderHistory(state);
}

function openQuickAddModal(state) {
  const availableTasks = state.tasks.filter((t) => t.status !== TASK_STATUS.DONE && t.status !== TASK_STATUS.DROPPED);
  openModal(`
    <h2>Quick Task Allocation</h2>
    <p>Assign an auxiliary task (maximum 15 minutes focus).</p>
    <form id="quick-alloc-form" class="form-grid">
      ${availableTasks.length ? `
        <label class="label">Choose from existing queue
          <select class="select" id="quick-existing-task">
            <option value="">-- Or create new auxiliary entry below --</option>
            ${availableTasks.map((t) => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join("")}
          </select>
        </label>
      ` : ""}
      <label class="label">Auxiliary task specification
        <input class="input" id="quick-new-title" placeholder="Verify telemetry / Check pull request #15">
      </label>
      ${state.goals.length ? `
        <label class="label">Goal reference
          <select class="select" id="quick-goal-id">
            ${state.goals.map((g) => `<option value="${g.id}">${escapeHtml(g.title)}</option>`).join("")}
          </select>
        </label>
      ` : ""}
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button class="btn signal-filled" type="submit">[ ALLOCATE ENTRY ]</button>
      </div>
    </form>
  `);
  $("#cancel-modal").onclick = closeModal;
  $("#quick-alloc-form").onsubmit = async (e) => {
    e.preventDefault();
    const existingId = $("#quick-existing-task")?.value;
    if (existingId) {
      await addQuickTask(existingId);
      closeModal();
      render("today");
      toast("Auxiliary task allocated.");
      return;
    }
    const title = $("#quick-new-title")?.value?.trim();
    if (!title) {
      toast("Specify a task title.", true);
      return;
    }
    let goalId = $("#quick-goal-id")?.value;
    if (!goalId) {
      if (state.goals.length) goalId = state.goals[0].id;
      else {
        const newGoal = await createGoal({ title: "Operations", description: "Operational auxiliary directives" });
        goalId = newGoal.id;
      }
    }
    const newTask = await createTask({ title, goalId, estimatedMinutes: 15 });
    await addQuickTask(newTask.id);
    closeModal();
    render("today");
    toast("Auxiliary task queued.");
  };
}

const habitDayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function habitFrequencyLabel(habit) {
  const schedule = habit.schedule ?? { type: "DAILY" };
  if (schedule.type === "WEEKDAYS") return "WEEKDAYS";
  if (schedule.type === "SPECIFIC_DAYS") {
    return (schedule.days ?? []).map((day) => habitDayNames[day]).join(" / ") || "CUSTOM DAYS";
  }
  if (schedule.type === "WEEKLY_TARGET") return `${schedule.targetPerWeek ?? 1}× / WEEK`;
  return "EVERY DAY";
}

function habitCheckinActions(habit, compact = false) {
  const log = habit.logs?.[todayKey()];
  const actions = habit.type === "AVOID"
    ? [["kept", "Kept"], ["broken", "Broke"]]
    : [["done", "Done"], ...(habit.minimum ? [["minimum", "Minimum"]] : [])];
  return `
    <div class="habit-checkin-actions ${compact ? "compact" : ""}">
      ${actions.map(([value, label]) => `
        <button class="btn small ${log === value ? "signal-filled" : "secondary"}"
          data-habit-checkin="${escapeHtml(habit.id)}" data-checkin-value="${value}">${label}${log === value ? " ✓" : ""}</button>
      `).join("")}
      ${log ? `<button class="btn small ghost" data-habit-checkin="${escapeHtml(habit.id)}" data-checkin-value="clear">Undo</button>` : ""}
    </div>
  `;
}

function renderTodayHabits(state) {
  const activeHabits = (state.habits ?? []).filter((habit) => habit.status === "ACTIVE");
  const due = activeHabits.filter((habit) => isHabitScheduled(habit));
  const checked = due.filter((habit) => {
    const value = habit.logs?.[todayKey()];
    return habit.type === "AVOID" ? value === "kept" : value === "done" || value === "minimum";
  }).length;
  return `
    <section class="tech-panel">
      <div class="panel-header-strip">
        <div class="panel-header-left"><span class="panel-title">HABITS</span></div>
        <div class="panel-header-right"><span>${checked} / ${due.length} CHECKED IN</span></div>
      </div>
      ${due.length ? `
        <div class="today-habit-list">
          ${due.map((habit) => {
            const dates = getHabitWeekDates();
            const summary = getHabitWeeklySummary(habit);
            const detail = habit.type === "AVOID"
              ? "Avoid habit"
              : habit.minimum ? `Minimum · ${habit.minimum}` : habitFrequencyLabel(habit);
            const log = habit.logs?.[todayKey()];
            const checkedIn = habit.type === "AVOID" ? log === "kept" : log === "done" || log === "minimum";
            return `
              <details class="today-habit-row">
                <summary class="today-habit-summary">
                  <span class="habit-state-dot ${checkedIn ? "checked" : ""} ${log === "broken" ? "broken" : ""}"></span>
                  <span class="today-habit-name">${escapeHtml(habit.name)}<span>${escapeHtml(detail)}</span></span>
                  <span class="habit-streak" aria-label="${summary.completed} of ${summary.target} this week">
                    ${dates.map((date) => {
                      const log = habit.logs?.[date];
                      const success = habit.type === "AVOID" ? log === "kept" : log === "done" || log === "minimum";
                      return `<span class="${success ? "complete" : log === "broken" ? "broken" : ""}" title="${escapeHtml(date)}"></span>`;
                    }).join("")}
                  </span>
                  <span class="habit-streak-label">${summary.completed}/${summary.target} wk</span>
                  <span class="habit-chevron" aria-hidden="true">›</span>
                </summary>
                <div class="today-habit-details">
                  ${habitCheckinActions(habit, true)}
                  <button class="btn small ghost" data-go="habits">Habit details</button>
                </div>
              </details>
            `;
          }).join("")}
        </div>
      ` : `<div class="today-habits-empty">${activeHabits.length
        ? "No habits scheduled today. Keep the space clear."
        : "No active habits yet."}
        ${activeHabits.length
          ? `<button class="btn small ghost" data-go="habits">View habits</button>`
          : `<button class="btn small secondary" data-create-habit>+ Create habit</button>`}
      </div>`}
    </section>
  `;
}

function renderHabitCard(habit, goals) {
  const summary = getHabitWeeklySummary(habit);
  const dates = getHabitWeekDates();
  const currentLog = habit.logs?.[todayKey()];
  const goal = goals.get(habit.goalId);
  const statusAction = habit.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  const statusLabel = habit.status === "ACTIVE" ? "Pause" : habit.status === "PAUSED" ? "Resume" : "Restore";
  return `
    <article class="habit-card ${habit.status.toLowerCase()}">
      <div class="habit-card-top">
        <div class="habit-card-heading">
          <div class="habit-card-type">${habit.type === "AVOID" ? "AVOID HABIT" : "DO HABIT"} <span>·</span> ${escapeHtml(habitFrequencyLabel(habit))}</div>
          <h3>${escapeHtml(habit.name)}</h3>
          ${habit.type === "DO" ? `<div class="habit-card-description">${escapeHtml(habit.normal || "")}${habit.minimum ? `<span>MINIMUM · ${escapeHtml(habit.minimum)}</span>` : ""}</div>` : ""}
          ${goal ? `<div class="habit-goal-link">LINKED GOAL · ${escapeHtml(goal.title)}</div>` : ""}
        </div>
        <div class="habit-card-actions">
          <button class="btn small ghost" data-habit-edit="${escapeHtml(habit.id)}">Edit</button>
          <button class="btn small secondary" data-habit-status="${escapeHtml(habit.id)}" data-status-value="${statusAction}">${statusLabel}</button>
          ${habit.status === "ARCHIVED" ? "" : `<button class="btn small ghost" data-habit-status="${escapeHtml(habit.id)}" data-status-value="ARCHIVED">Archive</button>`}
        </div>
      </div>
      <div class="habit-week-summary">
        <div class="habit-week-label"><span>THIS WEEK</span><strong>${summary.completed} / ${summary.target}</strong></div>
        <div class="habit-week-dots" aria-label="${summary.completed} of ${summary.target} weekly commitments">
          ${dates.map((date) => {
            const log = habit.logs?.[date];
            const success = habit.type === "AVOID" ? log === "kept" : log === "done" || log === "minimum";
            const mark = log === "broken" ? "×" : log === "minimum" ? "~" : success ? "✓" : "·";
            const label = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
            return `<span class="habit-week-day ${success ? "success" : ""} ${log === "broken" ? "broken" : ""} ${date === todayKey() ? "current" : ""}" title="${escapeHtml(`${label} · ${log || "no check-in"}`)}">${mark}</span>`;
          }).join("")}
        </div>
      </div>
      ${habit.status === "ACTIVE" ? `
        ${isHabitScheduled(habit) ? habitCheckinActions(habit) : `<div class="habit-not-scheduled">Not scheduled today${currentLog ? " · check-in recorded" : ""}</div>`}
      ` : `<div class="habit-paused-note">${habit.status === "PAUSED" ? "PAUSED · HISTORY IS KEPT" : "ARCHIVED · HISTORY IS KEPT"}</div>`}
    </article>
  `;
}

function renderHabits(state) {
  const goals = new Map(state.goals.map((goal) => [goal.id, goal]));
  const habits = state.habits ?? [];
  const active = habits.filter((habit) => habit.status === "ACTIVE");
  const paused = habits.filter((habit) => habit.status === "PAUSED");
  const archived = habits.filter((habit) => habit.status === "ARCHIVED");
  const renderGroup = (title, entries) => entries.length ? `
    <section class="habit-group">
      <div class="habit-group-heading"><h2>${title}</h2><span>${String(entries.length).padStart(2, "0")}</span></div>
      <div class="habit-list">${entries.map((habit) => renderHabitCard(habit, goals)).join("")}</div>
    </section>
  ` : "";
  viewEl.innerHTML = `
    <div class="section-title habit-page-title">
      <div><h2>Repeat what matters.</h2><div class="muted" style="font-size:12px;margin-top:4px">Small commitments, steady consistency. No streak pressure.</div></div>
      <button class="btn signal-filled" data-create-habit>+ New habit</button>
    </div>
    ${renderGroup("ACTIVE", active)}
    ${!active.length ? `<div class="empty habit-empty">No active habits. Add one small behavior you want to repeat.</div>` : ""}
    ${renderGroup("PAUSED", paused)}
    ${renderGroup("ARCHIVED", archived)}
  `;
  bindCommonActions();
}

function openHabitModal(state, habit = null) {
  const selectedDays = new Set(habit?.schedule?.days ?? []);
  const selectedFrequency = habit?.schedule?.type ?? "DAILY";
  const dayOptions = [1, 2, 3, 4, 5, 6, 0];
  const goals = state.goals.filter((goal) => goal.status !== "DONE" || goal.id === habit?.goalId);
  openModal(`
    <h2>${habit ? "Edit habit" : "New habit"}</h2>
    <p>A habit is a repeatable behavior, not another task in your queue.</p>
    <form id="habit-form" class="form-grid">
      <label class="label">Name
        <input class="input" name="name" maxlength="100" required value="${escapeHtml(habit?.name ?? "")}" placeholder="DSA practice">
      </label>
      <label class="label">Habit type
        <select class="select" name="type" id="habit-type">
          <option value="DO" ${habit?.type !== "AVOID" ? "selected" : ""}>Do something</option>
          <option value="AVOID" ${habit?.type === "AVOID" ? "selected" : ""}>Avoid something</option>
        </select>
      </label>
      <div id="habit-version-fields" class="habit-form-pair">
        <label class="label">Normal version
          <input class="input" name="normal" maxlength="120" required value="${escapeHtml(habit?.normal ?? "")}" placeholder="Practice for 45 minutes">
        </label>
        <label class="label">Minimum version
          <input class="input" name="minimum" maxlength="120" required value="${escapeHtml(habit?.minimum ?? "")}" placeholder="Review one problem">
        </label>
      </div>
      <label class="label">Frequency
        <select class="select" name="frequency" id="habit-frequency">
          <option value="DAILY" ${selectedFrequency === "DAILY" ? "selected" : ""}>Every day</option>
          <option value="WEEKDAYS" ${selectedFrequency === "WEEKDAYS" ? "selected" : ""}>Weekdays</option>
          <option value="SPECIFIC_DAYS" ${selectedFrequency === "SPECIFIC_DAYS" ? "selected" : ""}>Specific days</option>
          <option value="WEEKLY_TARGET" ${selectedFrequency === "WEEKLY_TARGET" ? "selected" : ""}>Times per week</option>
        </select>
      </label>
      <fieldset class="habit-days-field" id="habit-days-field" ${selectedFrequency === "SPECIFIC_DAYS" ? "" : "hidden"}>
        <legend>Choose days</legend>
        <div class="habit-day-options">
          ${dayOptions.map((day) => `<label><input type="checkbox" name="days" value="${day}" ${selectedDays.has(day) ? "checked" : ""}> ${habitDayNames[day]}</label>`).join("")}
        </div>
      </fieldset>
      <label class="label" id="habit-target-field" ${selectedFrequency === "WEEKLY_TARGET" ? "" : "hidden"}>Times per week
        <input class="input" type="number" name="targetPerWeek" min="1" max="7" value="${habit?.schedule?.targetPerWeek ?? 3}">
      </label>
      <label class="label">Linked goal <span class="muted">(optional)</span>
        <select class="select" name="goalId">
          <option value="">No linked goal</option>
          ${goals.map((goal) => `<option value="${escapeHtml(goal.id)}" ${habit?.goalId === goal.id ? "selected" : ""}>${escapeHtml(goal.title)}</option>`).join("")}
        </select>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button class="btn signal-filled" type="submit">${habit ? "Save habit" : "Create habit"}</button>
      </div>
    </form>
  `);
  $("#cancel-modal").onclick = closeModal;
  const frequency = $("#habit-frequency");
  const type = $("#habit-type");
  const updateConditionalFields = () => {
    $("#habit-days-field").hidden = frequency.value !== "SPECIFIC_DAYS";
    $("#habit-target-field").hidden = frequency.value !== "WEEKLY_TARGET";
    $("#habit-version-fields").hidden = type.value === "AVOID";
    $("#habit-form [name='normal']").required = type.value === "DO";
    $("#habit-form [name='minimum']").required = type.value === "DO";
  };
  frequency.onchange = updateConditionalFields;
  type.onchange = updateConditionalFields;
  updateConditionalFields();
  $("#habit-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const habitInput = {
      name: form.get("name"),
      type: form.get("type"),
      normal: form.get("normal"),
      minimum: form.get("minimum"),
      goalId: form.get("goalId"),
      schedule: {
        type: form.get("frequency"),
        days: form.getAll("days"),
        targetPerWeek: form.get("targetPerWeek")
      }
    };
    try {
      if (habit) await updateHabit(habit.id, habitInput);
      else await createHabit(habitInput);
      closeModal();
      await render(currentView);
      toast(habit ? "Habit updated." : "Habit created.");
    } catch (error) {
      toast(error.message, true);
    }
  };
}

function renderToday(state) {
  const plan = state.plans[todayKey()] ?? { mainTaskId: null, quickTaskIds: [] };
  const goals = new Map(state.goals.map((g) => [g.id, g]));
  const main = state.tasks.find((t) => t.id === plan.mainTaskId && t.status !== TASK_STATUS.DONE);
  const quick = (plan.quickTaskIds ?? []).map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean).filter((t) => t.status !== TASK_STATUS.DONE);

  // Real recommendation or authentic fallback matching the reference mockup
  let rec = recommendation(state.tasks);
  let isMockRec = false;
  if (!rec && !main) {
    isMockRec = true;
    rec = {
      id: "153",
      title: "Find Minimum in Rotated Sorted Array",
      estimatedMinutes: 42,
      goalTitle: "ALGORITHM",
      difficulty: "MEDIUM",
      source: "LEETCODE"
    };
  }

  // 1. Primary Objective Header & Columns
  const statusHtml = main
    ? `STATUS : <span class="status-active">ACTIVE // IN FOCUS</span>`
    : `STATUS : <span class="status-unscheduled">UNSCHEDULED</span>`;
  const refCode = main
    ? `REF. TSK-${main.id.slice(0, 4).toUpperCase()}`
    : (rec ? `REF. TSK-${rec.id.length > 4 ? rec.id.slice(0, 4).toUpperCase() : rec.id}` : `REF. TSK-000`);

  let directiveHtml = "";
  if (main) {
    directiveHtml = `
      <div style="font-size:10px;font-family:var(--font-mono);letter-spacing:0.12em;color:var(--accent);">PRIMARY DIRECTIVE // IN FOCUS</div>
      <h2 class="directive-heading">${escapeHtml(main.title.toUpperCase())}</h2>
      <p class="directive-sub">
        <span>GOAL : ${escapeHtml((goals.get(main.goalId)?.title ?? "SYSTEM GOAL").toUpperCase())}</span>
        ${main.estimatedMinutes ? `<span> · ~${main.estimatedMinutes} MIN FOCUS</span>` : ""}
        ${main.status === TASK_STATUS.IN_PROGRESS ? ` · <span style="color:#55c78a;">● TELEMETRY RECORDING</span>` : ""}
      </p>
      <div class="directive-actions">
        <button class="cmd-btn signal-filled" data-task-action="start" data-task-id="${main.id}">[ ${main.status === TASK_STATUS.IN_PROGRESS ? "RESUME FOCUS" : "INITIATE FOCUS"} ]</button>
        <button class="cmd-btn" data-task-action="complete" data-task-id="${main.id}">[ RESOLVE OBJECTIVE ]</button>
        <button class="cmd-btn" data-task-action="info" data-task-id="${main.id}">[ INFO ]</button>
        <button class="cmd-btn" data-task-action="edit" data-task-id="${main.id}">[ EDIT SPEC ]</button>
        <button class="cmd-btn danger" data-task-action="remove-today" data-task-id="${main.id}">[ DISENGAGE ]</button>
      </div>
    `;
  } else {
    const recDisplayTitle = rec ? `${rec.id ? `${rec.id}. ` : ""}${rec.title.toUpperCase()}` : "";
    directiveHtml = `
      <h2 class="directive-heading">NOTHING PLANNED FOR TODAY.</h2>
      <p class="directive-sub">
        ${rec ? `YOUR NEXT RECOMMENDATION IS <span class="rec-highlight">${escapeHtml(recDisplayTitle)}</span>` : "YOUR NEXT QUEUE IS EMPTY. SELECT AN OBJECTIVE FROM LATER."}
      </p>
      <div class="directive-actions">
        ${rec ? `<button class="cmd-btn signal" data-today-rec="${rec.id}">[ MAKE THIS TODAY'S TASK ]</button>` : `<button class="cmd-btn" data-go="later">[ BROWSE GOALS ]</button>`}
      </div>
    `;
  }

  const recGoalTitle = rec ? (rec.goalTitle || (goals.get(rec.goalId)?.title ?? "ALGORITHM")) : "ALGORITHM";
  const recDifficulty = rec ? (rec.difficulty || (rec.estimatedMinutes ? `${rec.estimatedMinutes} MIN` : "MEDIUM")) : "MEDIUM";
  const recSource = rec ? (rec.source || "LEETCODE") : "SYSTEM";
  const chartBoxHtml = `
    <div class="chart-box-header">RECOMMENDATION #${rec ? (rec.id.length > 4 ? rec.id.slice(0, 4).toUpperCase() : rec.id) : "153"}</div>
    <div class="diagnostic-canvas-box">
      <svg class="diagnostic-chart-svg" viewBox="0 0 160 80">
        <defs>
          <pattern id="diag-grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="0.8"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#diag-grid)" />
        <path d="M 10 20 L 50 38 L 90 52 L 135 65" fill="none" stroke="#DE7455" stroke-dasharray="2 3" stroke-width="1.4" />
        <rect x="86" y="48" width="8" height="8" fill="none" stroke="#DE7455" stroke-width="1.5" />
      </svg>
    </div>
    <div class="chart-meta-list">
      <div class="chart-meta-row"><span class="lbl">TYPE :</span> <span class="val">${escapeHtml(recGoalTitle.toUpperCase())}</span></div>
      <div class="chart-meta-row"><span class="lbl">DIFFICULTY :</span> <span class="val">${escapeHtml(recDifficulty.toUpperCase())}</span></div>
      <div class="chart-meta-row"><span class="lbl">SOURCE :</span> <span class="val">${escapeHtml(recSource.toUpperCase())}</span></div>
    </div>
  `;

  const primaryObjectiveHtml = `
    <section class="tech-panel">
      <div class="panel-header-strip">
        <div class="panel-header-left">
          <span class="panel-title">PRIMARY OBJECTIVE</span>
          <span class="barcode-strip"></span>
        </div>
        <div class="panel-header-right">
          <span>${statusHtml}</span>
          <span class="module-ref">${refCode}</span>
          <span class="barcode-strip sm"></span>
        </div>
      </div>
      <div class="objective-grid">
        <div class="scope-col">
          <div class="scope-label-top">${main ? "OBJ ACQUIRED" : "OBJ NULL"}</div>
          <div class="scope-reticle-wrap ${main ? "active" : ""}">
            <div class="reticle-ring-outer"></div>
            <div class="reticle-ring-inner"></div>
            <div class="reticle-axis-h"></div>
            <div class="reticle-axis-v"></div>
            <div class="reticle-corner-tick tl">+</div>
            <div class="reticle-corner-tick tr">+</div>
            <div class="reticle-corner-tick bl">+</div>
            <div class="reticle-corner-tick br">+</div>
            <div class="scope-icon-center">
              <svg width="42" height="48" viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-width="1.2">
                <path d="M4 2h10l6 6v18H4V2z"/>
                <path d="M14 2v6h6"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
                <line x1="8" y1="16" x2="16" y2="16"/>
                <line x1="8" y1="20" x2="13" y2="20"/>
              </svg>
            </div>
          </div>
          <div class="scope-label-bottom">${main ? "LOCKED ON TARGET" : "NO TASKS DETECTED"}</div>
        </div>

        <div class="directive-col">
          ${directiveHtml}
        </div>

        <div class="telemetry-chart-col">
          ${chartBoxHtml}
        </div>
      </div>
    </section>
  `;

  // 2. Quick Queue Module (Bottom Left)
  let quickBodyHtml = "";
  if (quick.length === 0) {
    quickBodyHtml = `
      <div class="quick-queue-empty">
        <div class="wireframe-cross-box"><span class="plus-icon">+</span></div>
        <div class="empty-title">NO QUICK TASKS</div>
        <div class="empty-desc">OPTIONAL. KEEP THESE SMALL SO THEY NEVER COMPETE WITH YOUR MAIN TASK.</div>
        <div class="queue-actions">
          <button class="cmd-btn" id="add-quick-entry">[ + ADD ENTRY ]</button>
        </div>
      </div>
      <div class="queue-footer-telemetry">
        <span>MAX 3 AUXILIARY TASKS</span>
        <span class="slot-indicators"><span class="slot">□</span><span class="slot">□</span><span class="slot">□</span></span>
      </div>
    `;
  } else {
    const slots = [0, 1, 2].map((i) => i < quick.length ? `<span class="slot filled">■</span>` : `<span class="slot">□</span>`).join("");
    quickBodyHtml = `
      <div class="quick-queue-list">
        ${quick.map((t, idx) => `
          <div class="proc-task-row">
            <span class="proc-idx">${String(idx + 1).padStart(2, "0")}</span>
            <div class="proc-info">
              <div class="proc-title">${escapeHtml(t.title)}</div>
              <div class="proc-sub">${escapeHtml(goals.get(t.goalId)?.title ?? "GOAL")}${t.estimatedMinutes ? ` · ~${t.estimatedMinutes} MIN` : ""}</div>
            </div>
            <div class="proc-actions">
              <button class="cmd-btn sm" data-task-action="info" data-task-id="${t.id}">[ INFO ]</button>
              <button class="cmd-btn sm signal" data-task-action="complete" data-task-id="${t.id}">[ RESOLVE ]</button>
              <button class="cmd-btn sm" data-task-action="remove-quick" data-task-id="${t.id}">[ PURGE ]</button>
            </div>
          </div>
        `).join("")}
      </div>
      <div style="padding: 4px 14px 12px;">
        <button class="cmd-btn" id="add-quick-entry">[ + ADD ENTRY ]</button>
      </div>
      <div class="queue-footer-telemetry">
        <span>${quick.length} / 3 AUXILIARY SLOTS USED</span>
        <span class="slot-indicators">${slots}</span>
      </div>
    `;
  }

  const quickModuleHtml = `
    <section class="tech-panel">
      <div class="panel-header-strip">
        <div class="panel-header-left">
          <span class="panel-title">QUICK QUEUE</span>
          <span class="barcode-strip"></span>
        </div>
        <div class="panel-header-right">
          <span>${quick.length} / 3</span>
          <span class="slot">□</span>
        </div>
      </div>
      ${quickBodyHtml}
    </section>
  `;

  // 3. Day Report Module (Bottom Right)
  const contextTasks = getTasksForDate(state, todayKey());
  const completedTodayCount = contextTasks.filter((item) => item.task.status === TASK_STATUS.DONE).length;
  const now = new Date();
  const dateFormatted = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;

  let reportBodyHtml = "";
  if (contextTasks.length === 0) {
    reportBodyHtml = `
      <div class="report-empty">
        <div class="wireframe-doc-box">
          <svg width="24" height="26" viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M4 2h10l6 6v18H4V2z" stroke-dasharray="2 2"/>
            <path d="M14 2v6h6"/>
          </svg>
        </div>
        <div class="empty-desc">NO TASKS RECORDED FOR TODAY.</div>
      </div>
    `;
  } else {
    reportBodyHtml = `
      <div class="report-tasks-list">
        ${contextTasks.map((item) => {
      const isDone = item.task.status === TASK_STATUS.DONE;
      const isMain = item.role === "main";
      const sym = isDone ? "[✓]" : isMain ? "[★]" : "[○]";
      const roleBadge = isMain ? `<span class="report-entry-badge">MAIN</span>` : item.role === "quick" ? `<span class="report-entry-badge">QUICK</span>` : "";
      return `
            <div class="report-task-entry ${isDone ? "done" : ""}">
              <span class="report-sym">${sym}</span>
              <span class="report-entry-title">${escapeHtml(item.task.title)}</span>
              ${roleBadge}
              <span style="font-size:9px;color:var(--text-dim);">${escapeHtml(item.goal?.title ?? "GOAL")}</span>
            </div>
          `;
    }).join("")}
      </div>
    `;
  }

  const dayReportModuleHtml = `
    <section class="tech-panel">
      <div class="panel-header-strip">
        <div class="panel-header-left">
          <span class="panel-title">DAY REPORT</span>
        </div>
        <div class="panel-header-right"><span>${completedTodayCount} / ${contextTasks.length} COMPLETED</span></div>
      </div>
      ${reportBodyHtml}
    </section>
  `;

  // Render view
  viewEl.innerHTML = `
    ${primaryObjectiveHtml}
    <div class="today-lower-grid">
      ${quickModuleHtml}
      ${dayReportModuleHtml}
    </div>
    ${renderTodayHabits(state)}
    ${renderCompletionChart(state.tasks, true)}
  `;

  bindCommonActions();

  // Quick Queue add entry handler
  const addQuickBtn = $("#add-quick-entry");
  if (addQuickBtn) {
    addQuickBtn.onclick = () => openQuickAddModal(state);
  }

  // Handle recommendation click
  const recBtn = $("[data-today-rec]");
  if (recBtn) {
    recBtn.onclick = async () => {
      const recId = recBtn.dataset.todayRec;
      if (isMockRec && recId === "153") {
        let goal = state.goals.find((g) => g.title.toLowerCase().includes("algorithm"));
        if (!goal) goal = await createGoal({ title: "Algorithm Mastery", description: "Core data structures & algorithms problem set" });
        const createdTask = await createTask({ title: "153. Find Minimum in Rotated Sorted Array", goalId: goal.id, estimatedMinutes: 42 });
        await makeToday(createdTask.id);
        render("today");
        toast("Objective 153 assigned to Today.");
      } else {
        await makeToday(recId);
        render("today");
        toast("Objective assigned to Today.");
      }
    };
  }
}


function preparedTaskCard(task, index, goal, plan) {
  const isMain = plan.mainTaskId === task.id;
  const isQuick = (plan.quickTaskIds ?? []).includes(task.id);
  const goalTitle = goal?.title ?? "General Goal";
  const goalPriority = goal?.priority ?? "NORMAL";
  const goalPriorityBadge = goalPriority === "PRIMARY" ? `<span class="badge primary">Primary Goal</span>` : goalPriority === "SECONDARY" ? `<span class="badge secondary">Secondary Goal</span>` : "";
  const cardStateClass = isMain ? "prepared-card-main" : isQuick ? "prepared-card-quick" : "";

  return `
    <article class="prepared-task-card ${cardStateClass}" data-task-id="${task.id}">
      <div class="prepared-card-head">
        <div class="prepared-card-info">
          <div class="prepared-card-badges">
            <span class="queue-idx-pill">#${String(index + 1).padStart(2, "0")}</span>
            ${isMain ? `<span class="badge active">★ TODAY'S FOCUS</span>` : isQuick ? `<span class="badge secondary">⚡ QUICK TASK</span>` : `<span class="badge">PREPARED QUEUE</span>`}
            ${goalPriorityBadge}
            <span class="prepared-ref">REF. TSK-${task.id.slice(0, 4).toUpperCase()}</span>
          </div>
          <h3 class="prepared-card-title">${escapeHtml(task.title)}</h3>
          <div class="prepared-card-goal">◎ <strong>TARGET GOAL:</strong> ${escapeHtml(goalTitle)}</div>
        </div>
        <div class="row-actions">
          <button class="btn small ghost" data-task-action="info" data-task-id="${task.id}">Info</button>
          <button class="btn small ${isMain ? "danger" : "signal-filled"}" data-task-action="${isMain ? "remove-today" : "today"}" data-task-id="${task.id}">${isMain ? "Remove Today" : "Make Today"}</button>
          ${isMain ? "" : `
            <button class="btn small secondary" data-task-action="${isQuick ? "remove-quick" : "quick"}" data-task-id="${task.id}">${isQuick ? "Remove Quick" : "Quick"}</button>
            <button class="btn small ghost" data-task-action="remove-next" data-task-id="${task.id}">Later</button>
          `}
          <button class="btn small ghost" data-task-action="edit" data-task-id="${task.id}">Edit</button>
        </div>
      </div>
      <div class="prepared-card-meta">
        ${task.estimatedMinutes ? `<span>⏱ <strong>EST:</strong> ~${task.estimatedMinutes} min</span>` : `<span>⏱ <strong>EST:</strong> Unspecified</span>`}
        ${task.status === TASK_STATUS.IN_PROGRESS ? `<span style="color:#55c78a;">● TELEMETRY RECORDING</span>` : `<span><strong>STATUS:</strong> Ready for Execution</span>`}
        ${task.createdAt ? `<span><strong>LOGGED:</strong> ${formatDateLabel(task.createdAt, "—")}</span>` : ""}
      </div>
      ${task.notes ? `<div class="prepared-card-notes">${escapeHtml(task.notes)}</div>` : ""}
      ${task.blockedReason ? `<div class="prepared-card-blocked">⚠️ <strong>BLOCKED:</strong> ${escapeHtml(task.blockedReason)}</div>` : ""}
    </article>`;
}

function renderNext(state) {
  const goals = new Map(state.goals.map((g) => [g.id, g]));
  const plan = state.plans[todayKey()] ?? { mainTaskId: null, quickTaskIds: [] };
  const tasks = state.tasks.filter((t) => t.status === TASK_STATUS.NEXT || t.id === plan.mainTaskId);
  viewEl.innerHTML = `
    <div class="section-title">
      <div>
        <h2>Your prepared queue</h2>
        <div class="muted" style="font-size:12px;margin-top:4px">Ready to execute. Keep it small and intentional.</div>
      </div>
      <span class="badge">${tasks.length}/7</span>
    </div>
    <div class="queue">
      ${tasks.length ? tasks.map((t, i) => preparedTaskCard(t, i, goals.get(t.goalId), plan)).join("") : `<div class="empty">Your queue is empty.<br><br><button class="btn" data-go="later">Browse Goals</button></div>`}
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

function formatDateLabel(value, fallback = "—") {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function dayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildCompletionChartData(tasks) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets = new Map();
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = dayKey(date);
    buckets.set(key, {
      key,
      date,
      count: 0,
      shortLabel: date.toLocaleDateString([], { month: "short", day: "numeric" })
    });
  }

  for (const task of tasks) {
    if (task.status !== TASK_STATUS.DONE || !task.completedAt) continue;
    const completedAt = new Date(task.completedAt);
    if (Number.isNaN(completedAt.getTime())) continue;
    const key = dayKey(completedAt);
    if (buckets.has(key)) buckets.get(key).count += 1;
  }

  return Array.from(buckets.values());
}

function renderCompletionChart(tasks, compact = false) {
  const chartData = buildCompletionChartData(tasks);
  const maxCount = Math.max(...chartData.map((day) => day.count), 1);
  const chartHeader = compact
    ? `<div class="chart-head"><h3>Daily task completion <span>— LAST 30 DAYS</span></h3></div>`
    : `
      <div class="chart-head">
        <div>
          <h3>Daily task completion</h3>
          <div class="muted" style="font-size:11px;margin-top:2px;">Last 30 days matrix telemetry</div>
        </div>
        <div class="chart-qr-legend">
          <span>DENSITY:</span>
          <span title="0 completed: Transparent"><i class="q0"></i> 0</span>
          <span title="1-9 completed: Gradient"><i class="q5"></i> 1-9</span>
          <span title="10+ completed: Pure White #FFF"><i class="q10"></i> 10+</span>
        </div>
      </div>
    `;

  return `
    <section class="chart-panel ${compact ? "today-completion-chart" : ""}">
      ${chartHeader}
      <div class="chart-grid">
        ${chartData.map((day, index) => {
          const count = day.count;
          if (compact) {
            const alpha = count ? Math.min(1, Math.max(0.22, count / maxCount)).toFixed(2) : "0.05";
            const occupiedHeight = count ? Math.min(100, Math.max(12, (count / maxCount) * 100)) : 3;
            const showLabel = index === 0 || index === chartData.length - 1 || index % 7 === 0;
            return `
              <div class="chart-day" title="${escapeHtml(day.shortLabel)}: ${count} resolved">
                <div class="chart-bar-wrap">
                  <div class="chart-bar ${count ? "has-activity" : ""}" style="height:${occupiedHeight}%;opacity:${alpha};"></div>
                </div>
                <div class="chart-label">${showLabel ? day.date.toLocaleDateString([], { month: "short", day: "numeric" }) : ""}</div>
              </div>`;
          }

          let barBg = "transparent";
          let barShadow = "none";
          let barBorderTop = "none";
          if (count >= 10) {
            barBg = "#FFFFFF";
            barShadow = "0 0 8px rgba(255, 255, 255, 0.6)";
            barBorderTop = "1px solid #FFFFFF";
          } else if (count > 0) {
            const alpha = Math.min(1, Math.max(0.12, count / 10)).toFixed(2);
            barBg = `rgba(255, 255, 255, ${alpha})`;
            barBorderTop = `1px solid rgba(255, 255, 255, ${Math.min(1, parseFloat(alpha) + 0.25).toFixed(2)})`;
          }

          const occupiedHeight = count ? Math.min(100, Math.max(14, (count / Math.max(maxCount, 10)) * 100)) : 0;
          return `
            <div class="chart-day" title="${escapeHtml(day.shortLabel)}: ${count} resolved">
              <div class="chart-value ${count >= 10 ? "max-val" : count > 0 ? "active-val" : ""}">${count}</div>
              <div class="chart-bar-wrap">
                <div class="chart-bar" style="height:${occupiedHeight}%;background-color:${barBg};box-shadow:${barShadow};border-top:${barBorderTop};"></div>
              </div>
              <div class="chart-label">${day.shortLabel}</div>
            </div>`;
        }).join("")}
      </div>
    </section>`;
}


function goalDeadlineProgress(goal) {
  if (!goal?.deadline || !goal?.startedAt) return null;

  const startedAt = new Date(goal.startedAt);
  const deadline = new Date(goal.deadline);
  const now = new Date();

  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(deadline.getTime()) || deadline <= startedAt) {
    return null;
  }

  const totalWindow = deadline.getTime() - startedAt.getTime();
  const elapsed = now.getTime() - startedAt.getTime();

  return Math.min(100, Math.max(0, Math.round((elapsed / totalWindow) * 100)));
}

function goalCard(goal, tasks) {
  const goalTasks = tasks.filter((t) => t.goalId === goal.id);
  const remainingTasks = goalTasks.filter((t) => t.status !== TASK_STATUS.DONE && t.status !== TASK_STATUS.DROPPED);
  const doneTasks = goalTasks.filter((t) => t.status == TASK_STATUS.DONE || t.status === TASK_STATUS.DROPPED);
  const remaining = remainingTasks.length;
  const progress = goalProgress(goal.id, tasks);
  const deadlineProgress = goalDeadlineProgress(goal);
  const frontier = goalFrontier(goal.id, tasks);
  const collapsed = goal.collapsed === true;
  const goalCardStateClass = goal.status === "ACTIVE" ? "goal-card-active" : goal.status === "DONE" ? "goal-card-done" : "goal-card-inactive";
  const goalPriority = goal.priority ?? "NORMAL";
  const goalPriorityClass = goalPriority === "PRIMARY" ? "goal-card-primary" : goalPriority === "SECONDARY" ? "goal-card-secondary" : "goal-card-normal";
  const goalPriorityBadge = goalPriority === "PRIMARY" ? `<span class="badge primary">★ PRIMARY DIRECTIVE</span>` : goalPriority === "SECONDARY" ? `<span class="badge secondary">⚡ SECONDARY PRIORITY</span>` : `<span class="badge normal">NORMAL PRIORITY</span>`;
  const goalStatusBadge = goal.status === "ACTIVE" ? `<span class="badge active">● ACTIVE</span>` : goal.status === "DONE" ? `<span class="badge done">✓ RESOLVED</span>` : `<span class="badge inactive">○ INACTIVE // DORMANT</span>`;

  return `
    <article class="goal-card ${goalCardStateClass} ${goalPriorityClass}" data-goal-id="${goal.id}">
      <div class="goal-head">
        <div class="goal-info">
          <div class="goal-header-badges">
            ${goalStatusBadge}
            ${goalPriorityBadge}
            <span class="goal-ref">REF. GOL-${goal.id.slice(0, 4).toUpperCase()}</span>
          </div>
          <h3>◎ ${escapeHtml(goal.title)}</h3>
          <p>${escapeHtml(goal.description)}</p>
        </div>
        <div class="row-actions">
          <button
            class="btn small ghost goal-collapse"
            data-goal-action="toggle-collapse"
            data-goal-id="${goal.id}"
            aria-expanded="${!collapsed}"
            aria-controls="goal-content-${goal.id}"
            title="${collapsed ? "Expand goal" : "Collapse goal"}">${collapsed ? "Expand" : "Collapse"}</button>
          <button
            class="btn small ${goal.status === "ACTIVE" ? "ghost" : "signal-filled"}"
            data-goal-action="${goal.status === "ACTIVE" ? "deactivate" : "activate"}"
            data-goal-id="${goal.id}">${goal.status === "ACTIVE" ? "Deactivate" : "Activate"}</button>
          <button
            class="btn small secondary"
            data-goal-action="suggest"
            data-goal-id="${goal.id}">✦ Suggest</button>
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
        <div class="goal-meta muted">
          <span>Created ${formatDateLabel(goal.createdAt, "—")}</span>
          <span>Started ${formatDateLabel(goal.startedAt, "Not started yet")}</span>
          <span>Deadline ${formatDateLabel(goal.deadline, "No deadline")}</span>
        </div>
        <div class="progress goal-progress"><span style="width:${progress}%"></span></div>
        <div class="muted" style="font-size:11px">${progress}% complete · ${remaining} task${remaining === 1 ? "" : "s"} remaining</div>
        ${deadlineProgress !== null ? `<div class="progress deadline-progress"><span style="width:${deadlineProgress}%"></span></div>` : ""}
        ${frontier ? `<div class="frontier"><div><div class="muted">CURRENT FRONTIER</div><strong>→ ${escapeHtml(frontier.title)}</strong></div><div class="row-actions">${frontier.status === TASK_STATUS.READY || frontier.status === TASK_STATUS.BACKLOG ? `<button class="btn small" data-task-action="next" data-task-id="${frontier.id}">Add to NEXT</button>` : ""}${frontier.status === TASK_STATUS.BLOCKED ? `<span class="badge blocked">Blocked</span>` : ""}</div></div>` : ""}
        <div class="goal-tasks">
          ${goalTasks.length ? remainingTasks.map((t) => taskLine(t, goal)).join("") + doneTasks.map((t) => taskLine(t, goal)).join("") : `<div class="muted" style="font-size:12px;padding:10px 2px">No tasks yet. Break this goal into executable actions.</div>`}
        </div>
      </div>
    </article>`;
}

function taskLine(task, goal) {
  const classes = [task.status === TASK_STATUS.DONE || task.status === TASK_STATUS.DROPPED ? "done" : "", task.status === TASK_STATUS.BLOCKED ? "blocked" : ""].join(" ");
  const statusLabel = task.status === TASK_STATUS.DONE ? "✓" : task.status === TASK_STATUS.DROPPED ? "×" : task.status === TASK_STATUS.BLOCKED ? "!" : task.status === TASK_STATUS.NEXT ? "N" : task.status === TASK_STATUS.TODAY || task.status === TASK_STATUS.IN_PROGRESS ? "T" : "";
  const canPromoteToNext = goal?.status !== "INACTIVE";
  const canAddToNext = [TASK_STATUS.BACKLOG, TASK_STATUS.READY].includes(task.status) && canPromoteToNext;
  return `<div class="task-line ${classes}"><div class="dot">${statusLabel}</div><div class="grow"><div class="title">${escapeHtml(task.title)}</div>${task.blockedReason ? `<div class="sub">Blocked: ${escapeHtml(task.blockedReason)}</div>` : ""}</div><div class="row-actions"><button class="btn small ghost" data-task-action="info" data-task-id="${task.id}">Info</button>${canAddToNext ? `<button class="btn small secondary" data-task-action="next" data-task-id="${task.id}">Add to NEXT</button><button class="btn small ghost drop-task" data-task-action="drop" data-task-id="${task.id}">Drop</button>` : ""}${task.status === TASK_STATUS.BLOCKED ? `<button class="btn small secondary" data-task-action="unblock" data-task-id="${task.id}">Unblock</button>` : task.status !== TASK_STATUS.DONE && task.status !== TASK_STATUS.DROPPED ? `<button class="btn small ghost" data-task-action="block" data-task-id="${task.id}">Block</button>` : ""}<button class="btn small ghost" data-task-action="edit" data-task-id="${task.id}">Edit</button></div></div>`;
}

function renderJournalHeatmap(state, selectedDateKey) {
  const today = new Date();
  const endOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  endOfWeek.setDate(endOfWeek.getDate() + (6 - endOfWeek.getDay()));
  const startDate = new Date(endOfWeek);
  startDate.setDate(startDate.getDate() - (25 * 7 + 6));
  const weeks = [];

  for (let weekIndex = 0; weekIndex < 26; weekIndex += 1) {
    const week = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + weekIndex * 7 + dayIndex);
      const dateKey = todayKey(date);
      const content = state.journal?.[dateKey]?.content?.trim() ?? "";
      const level = content ? (content.length > 800 ? 3 : content.length > 240 ? 2 : 1) : 0;
      const isFuture = date > today;
      week.push(`<button class="journal-heatmap-cell level-${level}${dateKey === selectedDateKey ? " selected" : ""}${isFuture ? " future" : ""}" data-journal-date="${dateKey}" aria-label="${escapeHtml(formatJournalDate(dateKey))}${content ? ", note saved" : ", no note"}" title="${escapeHtml(formatShortDate(dateKey))}${content ? " · Note saved" : ""}"></button>`);
    }
    weeks.push(`<div class="journal-heatmap-week">${week.join("")}</div>`);
  }

  const monthLabels = [];
  weeks.forEach((_, weekIndex) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + weekIndex * 7);
    if (weekIndex === 0 || date.getDate() <= 7) {
      monthLabels.push(`<span style="grid-column:${weekIndex + 2}">${escapeHtml(new Intl.DateTimeFormat(undefined, { month: "short" }).format(date))}</span>`);
    }
  });

  return `
    <section class="journal-heatmap-panel" aria-label="Journal activity">
      <div class="journal-heatmap-head">
        <div>
          <div class="context-kicker">JOURNAL ACTIVITY</div>
          <div class="context-sub">Select a day to open its note</div>
        </div>
        <div class="journal-heatmap-legend"><span>Less</span><i class="level-0"></i><i class="level-1"></i><i class="level-2"></i><i class="level-3"></i><span>More</span></div>
      </div>
      <div class="journal-heatmap-scroll">
        <div class="journal-heatmap-months"><span></span>${monthLabels.join("")}</div>
        <div class="journal-heatmap-body">
          <div class="journal-heatmap-weekdays"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
          <div class="journal-heatmap-grid">${weeks.join("")}</div>
        </div>
      </div>
    </section>`;
}

function renderJournal(state, dateKey = todayKey()) {
  currentJournalDate = dateKey;
  const isToday = (dateKey === todayKey());
  const prevDateKey = shiftDateKey(dateKey, -1);
  const nextDateKey = shiftDateKey(dateKey, 1);
  const dateDisplay = formatJournalDate(dateKey);
  const entry = state.journal?.[dateKey] ?? { content: "" };
  const heatmapHiddenClass = isJournalHeatmapOpen ? "" : "hidden";
  const ariaExpanded = isJournalHeatmapOpen ? "true" : "false";

  viewEl.innerHTML = `
    <section class="journal-container">
      <div id="journal-heatmap" class="${heatmapHiddenClass}">${renderJournalHeatmap(state, dateKey)}</div>
      <div class="journal-timeline-bar">
        <button class="journal-nav-btn" data-journal-date="${prevDateKey}">
          <span class="arrow">←</span>
          <span>${formatShortDate(prevDateKey)}</span>
        </button>

        <div class="journal-date-heading">
          <h2 id="journal-date-toggle" role="button" tabindex="0" aria-expanded="${ariaExpanded}" aria-controls="journal-heatmap" title="${isJournalHeatmapOpen ? "Hide journal calendar" : "Show journal calendar"}">${escapeHtml(dateDisplay)}</h2>
          ${isToday ? `<span class="badge journal-today-badge">Today</span>` : `<button class="btn small ghost" id="jump-today-btn">Jump to Today</button>`}
        </div>

        <button class="journal-nav-btn" data-journal-date="${nextDateKey}">
          <span>${formatShortDate(nextDateKey)}</span>
          <span class="arrow">→</span>
        </button>
      </div>

      <div class="journal-toolbar">
        <div class="journal-thought-actions">
          <button class="btn small" id="add-thought-main">+ Add thought</button>
          <button class="btn small ghost" data-slot="Morning">Morning</button>
          <button class="btn small ghost" data-slot="During day">During day</button>
          <button class="btn small ghost" data-slot="Evening">Evening</button>
        </div>
        <div class="journal-status" id="journal-status" data-status="saved">Saved</div>
      </div>

      <div class="journal-layout">
        <div class="journal-paper">
          <textarea
            id="journal-editor"
            data-date="${dateKey}"
            class="journal-textarea"
            placeholder="What's on your mind? Start writing..."
            spellcheck="true">${escapeHtml(entry.content ?? "")}</textarea>
        </div>
      </div>
    </section>
  `;

  const editor = $("#journal-editor");
  if (editor) {
    autoResizeTextarea(editor);
    editor.oninput = () => {
      autoResizeTextarea(editor);
      triggerJournalAutoSave();
    };
    editor.onblur = () => {
      flushJournalSave();
    };

    // Auto focus and place cursor at end
    editor.focus();
    const len = editor.value.length;
    editor.setSelectionRange(len, len);
  }

  const heatmap = $("#journal-heatmap");
  const dateToggle = $("#journal-date-toggle");
  if (heatmap && dateToggle) {
    const toggleHeatmap = () => {
      const isHidden = heatmap.classList.toggle("hidden");
      isJournalHeatmapOpen = !isHidden;
      dateToggle.setAttribute("aria-expanded", String(!isHidden));
      dateToggle.title = isHidden ? "Show journal calendar" : "Hide journal calendar";
    };
    dateToggle.onclick = toggleHeatmap;
    dateToggle.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleHeatmap();
      }
    };
  }

  // Timeline button listeners
  $$("[data-journal-date]").forEach((btn) => {
    btn.onclick = async () => {
      const savedEntry = await flushJournalSave();
      if (savedEntry) state.journal[savedEntry.date] = savedEntry;
      renderJournal(state, btn.dataset.journalDate);
    };
  });

  const jumpTodayBtn = $("#jump-today-btn");
  if (jumpTodayBtn) {
    jumpTodayBtn.onclick = async () => {
      const savedEntry = await flushJournalSave();
      if (savedEntry) state.journal[savedEntry.date] = savedEntry;
      renderJournal(state, todayKey());
    };
  }

  // Thought shortcut buttons
  const addThoughtBtn = $("#add-thought-main");
  if (addThoughtBtn) {
    addThoughtBtn.onclick = () => insertJournalThought();
  }

  $$("[data-slot]").forEach((btn) => {
    btn.onclick = () => insertJournalThought(btn.dataset.slot);
  });
}

function renderIdeas(state) {
  viewEl.innerHTML = `
    <div class="section-title"><div><h2>Ideas are not commitments.</h2><div class="muted" style="font-size:12px;margin-top:4px">Capture quickly. Decide later whether an idea deserves a Goal.</div></div><button class="btn" data-create="idea">+ Capture Idea</button></div>
    <div class="idea-list">
      ${state.ideas.length ? state.ideas.map((idea) => `<article class="idea-card"><div class="idea-icon">◇</div><div class="grow"><div class="title">${escapeHtml(idea.title)}</div>${idea.notes ? `<div class="sub">${escapeHtml(idea.notes)}</div>` : ""}</div><div class="row-actions"><button class="btn small secondary" data-idea-action="convert" data-idea-id="${idea.id}">Make Goal</button><button class="btn small ghost" data-idea-action="delete" data-idea-id="${idea.id}">Delete</button></div></article>`).join("") : `<div class="empty"><h2 style="color:var(--text)">Have an idea?</h2><p>Capture it here without committing to it.</p><button class="btn" data-create="idea">+ Capture Idea</button></div>`}
    </div>`;
  bindCommonActions();
}

function doneTaskCard(task, goal) {
  const completedDate = task.completedAt ? new Date(task.completedAt) : null;
  const dateStr = completedDate ? completedDate.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—";
  const timeStr = completedDate ? completedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const goalTitle = goal?.title ?? "General Goal";
  const timeEstimate = task.estimatedMinutes ? `~${task.estimatedMinutes} min` : null;

  return `
    <article class="done-card" data-task-id="${task.id}">
      <div class="done-card-head">
        <div class="done-card-info">
          <div class="done-card-badges">
            <span class="badge done">✓ RESOLVED</span>
            <span class="done-card-ref">REF. TSK-${task.id.slice(0, 4).toUpperCase()}</span>
          </div>
          <h3 class="done-card-title">${escapeHtml(task.title)}</h3>
          <div class="done-card-goal">◎ <strong>GOAL:</strong> ${escapeHtml(goalTitle)}</div>
        </div>
        <div class="row-actions">
          <button class="btn small ghost" data-task-action="info" data-task-id="${task.id}">Info</button>
          <button class="btn small secondary" data-task-action="next" data-task-id="${task.id}" title="Re-queue back to Prepared Queue">Re-Queue</button>
          <button class="btn small ghost" data-task-action="edit" data-task-id="${task.id}">Edit</button>
        </div>
      </div>
      <div class="done-card-meta">
        <span><strong>RESOLVED:</strong> ${dateStr}${timeStr ? ` · ${timeStr}` : ""}</span>
        ${timeEstimate ? `<span>⏱ <strong>EST:</strong> ${timeEstimate}</span>` : ""}
        ${task.createdAt ? `<span><strong>LOGGED:</strong> ${formatDateLabel(task.createdAt, "—")}</span>` : ""}
      </div>
      ${task.notes ? `<div class="done-card-notes">${escapeHtml(task.notes)}</div>` : ""}
    </article>`;
}

function renderHistory(state) {
  const goals = new Map(state.goals.map((g) => [g.id, g]));
  const done = state.tasks.filter((t) => t.status === TASK_STATUS.DONE && t.completedAt).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  viewEl.innerHTML = `
    <div class="section-title">
      <div>
        <h2>Recently completed</h2>
        <div class="muted" style="font-size:12px;margin-top:4px">Visible progress, without turning work into analytics.</div>
      </div>
      <span class="badge done">${done.length} RESOLVED</span>
    </div>

    ${renderCompletionChart(state.tasks)}

    <div class="history-list" style="margin-top:20px;">
      ${done.length ? done.map((t) => doneTaskCard(t, goals.get(t.goalId))).join("") : `<div class="empty">Completed tasks will appear here.</div>`}
    </div>`;
  bindCommonActions();
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
      <div class="form-row-2">
        <label class="label">Status<select class="select" name="status"><option value="INACTIVE" ${goal?.status === "ACTIVE" ? "" : "selected"}>Inactive</option><option value="ACTIVE" ${goal?.status === "ACTIVE" ? "selected" : ""}>Active</option></select></label>
        <label class="label">Deadline (optional)<input class="input" type="date" name="deadline" value="${escapeHtml(goal?.deadline ?? "")}"></label>
      </div>
      <label class="label">Priority<select class="select" name="priority"><option value="NORMAL" ${goal?.priority !== "PRIMARY" && goal?.priority !== "SECONDARY" ? "selected" : ""}>Normal</option><option value="PRIMARY" ${goal?.priority === "PRIMARY" ? "selected" : ""}>Primary</option><option value="SECONDARY" ${goal?.priority === "SECONDARY" ? "selected" : ""}>Secondary</option></select></label>
      <label class="label">Notes (optional)<input class="input" name="notes" value="${escapeHtml(goal?.notes ?? "")}"></label>
      <div class="muted" style="font-size:11px; margin-top:-4px;">${goal ? `Created ${formatDateLabel(goal.createdAt, "—")} • Started ${formatDateLabel(goal.startedAt, "Not started yet")}` : "New goals start inactive until you activate them."}</div>
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

async function openTaskDetails(taskId) {
  const state = await getAppState();
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return toast("Task not found.", true);

  const goal = state.goals.find((g) => g.id === task.goalId);
  const dependency = task.dependencyIds?.[0] ? state.tasks.find((t) => t.id === task.dependencyIds[0]) : null;
  const formatDateValue = (value) => {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  };

  openModal(`
    <h2>Task details</h2>
    <p>Everything captured for this task.</p>
    <div class="detail-grid">
      <div class="detail-item"><span class="detail-label">Title</span><strong>${escapeHtml(task.title)}</strong></div>
      <div class="detail-item"><span class="detail-label">Goal</span><strong>${escapeHtml(goal?.title ?? "Goal removed")}</strong></div>
      <div class="detail-item"><span class="detail-label">Status</span><strong>${escapeHtml(task.status)}</strong></div>
      <div class="detail-item"><span class="detail-label">Estimated minutes</span><strong>${task.estimatedMinutes ? `${task.estimatedMinutes} min` : "—"}</strong></div>
      <div class="detail-item"><span class="detail-label">Created</span><strong>${escapeHtml(formatDateValue(task.createdAt))}</strong></div>
      <div class="detail-item"><span class="detail-label">Started</span><strong>${escapeHtml(formatDateValue(task.startedAt))}</strong></div>
      <div class="detail-item"><span class="detail-label">Completed</span><strong>${escapeHtml(formatDateValue(task.completedAt))}</strong></div>
      <div class="detail-item"><span class="detail-label">Dependency</span><strong>${escapeHtml(dependency?.title ?? "None")}</strong></div>
      <div class="detail-item detail-item-full"><span class="detail-label">Blocked reason</span><div class="detail-text">${task.blockedReason ? escapeHtml(task.blockedReason) : "—"}</div></div>
      <div class="detail-item detail-item-full"><span class="detail-label">Notes</span><div class="detail-text">${task.notes ? escapeHtml(task.notes) : "No notes saved."}</div></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn secondary" id="cancel-modal">Close</button>
      <button type="button" class="btn" id="edit-task-details">Edit task</button>
    </div>
  `);

  $("#cancel-modal").onclick = closeModal;
  $("#edit-task-details").onclick = () => { closeModal(); openTaskModal(task.id); };
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
    results.innerHTML = [...goals.map((g) => `<div class="search-hit"><strong>◎ ${escapeHtml(g.title)}</strong><div class="sub">Goal</div></div>`), ...tasks.map((t) => `<div class="search-hit"><strong>${escapeHtml(t.title)}</strong><div class="sub">Task</div></div>`)].join("") || `<div class="muted">No results.</div>`;
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
  overlay.innerHTML = `
    <div class="focus-card tech-panel">
      <div class="label-focus">CRITICAL FOCUS PROTOCOL // DIRECTIVE ACTIVE</div>
      <div class="barcode-strip" style="margin:10px auto;display:block;width:120px;"></div>
      <h2>${escapeHtml(task.title.toUpperCase())}</h2>
      <div class="goal">OBJECTIVE: ${escapeHtml((goal?.title ?? "SYSTEM GOAL").toUpperCase())}</div>
      <div class="timer" id="timer">00:00</div>
      <div class="focus-actions">
        <button class="cmd-btn" id="exit-focus">[ ABORT / EXIT ]</button>
        <button class="cmd-btn signal-filled" id="complete-focus">[ RESOLVE OBJECTIVE ]</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const started = new Date(task.startedAt ?? new Date().toISOString()).getTime();
  const tick = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const m = String(Math.floor(seconds / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    $("#timer", overlay).textContent = `${m}:${s}`;
  };
  tick();
  timerHandle = setInterval(tick, 1000);
  $("#exit-focus", overlay).onclick = () => {
    clearInterval(timerHandle);
    overlay.remove();
    history.replaceState(null, "", "index.html");
    render("today");
  };
  $("#complete-focus", overlay).onclick = async () => {
    await completeTask(task.id);
    clearInterval(timerHandle);
    overlay.remove();
    history.replaceState(null, "", "index.html");
    toast("✓ Objective resolved.");
    render("today");
  };
}

function bindCommonActions() {
  $$('[data-go]').forEach((el) => el.onclick = () => render(el.dataset.go));
  $$('[data-create="goal"]').forEach((el) => el.onclick = () => openGoalModal());
  $$('[data-create="idea"]').forEach((el) => el.onclick = () => openIdeaModal());
  $$("[data-create-habit]").forEach((el) => el.onclick = async () => {
    try { openHabitModal(await getAppState()); }
    catch (error) { toast(error.message, true); }
  });
  $$("[data-habit-edit]").forEach((el) => el.onclick = async () => {
    try {
      const state = await getAppState();
      const habit = (state.habits ?? []).find((item) => item.id === el.dataset.habitEdit);
      if (habit) openHabitModal(state, habit);
    } catch (error) { toast(error.message, true); }
  });
  $$("[data-habit-status]").forEach((el) => el.onclick = async () => {
    try {
      await setHabitStatus(el.dataset.habitStatus, el.dataset.statusValue);
      await render(currentView);
      toast(el.dataset.statusValue === "ARCHIVED" ? "Habit archived; history kept." : `Habit ${el.dataset.statusValue.toLowerCase()}.`);
    } catch (error) { toast(error.message, true); }
  });
  $$("[data-habit-checkin]").forEach((el) => el.onclick = async () => {
    try {
      const value = el.dataset.checkinValue === "clear" ? null : el.dataset.checkinValue;
      await checkInHabit(el.dataset.habitCheckin, value);
      await render(currentView);
    } catch (error) { toast(error.message, true); }
  });
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

        if (el.dataset.goalAction === "activate") {
          return updateGoal(el.dataset.goalId, { status: "ACTIVE" })
            .then(() => render(currentView))
            .catch((err) => toast(err.message, true));
        }

        if (el.dataset.goalAction === "deactivate") {
          return updateGoal(el.dataset.goalId, { status: "INACTIVE" })
            .then(() => render(currentView))
            .catch((err) => toast(err.message, true));
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
        case "drop": await dropTask(id); break;
        case "today": await makeToday(id); break;
        case "remove-today": await removeToday(id); break;
        case "quick": await addQuickTask(id); break;
        case "remove-quick": await removeQuickTask(id); break;
        case "complete": await completeTask(id); break;
        case "start": return showFocus(id);
        case "info": return openTaskDetails(id);
        case "edit": return openTaskModal(id);
        case "block": return openBlockModal(id);
        case "unblock": await unblockTask(id); break;
      }
      render(currentView);
    } catch (err) { toast(err.message, true); }
  });
}

navEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.action === "search" || btn.id === "search-btn") {
    return openSearch();
  }
  if (btn.dataset.view) {
    if (btn.dataset.view === "journal") {
      currentJournalDate = todayKey();
      isJournalHeatmapOpen = false;
    }
    render(btn.dataset.view);
  }
});
$("#new-goal").onclick = () => openGoalModal();
$("#new-task").onclick = () => openTaskModal();
$("#history-btn").onclick = () => render("history");
$("#search-btn").onclick = openSearch;
modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });

window.addEventListener("beforeunload", () => {
  flushJournalSave();
});

document.addEventListener("keydown", (e) => {
  if (!modalBackdrop.classList.contains("hidden")) { if (e.key === "Escape") closeModal(); return; }
  const tag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); return openSearch(); }
  const key = e.key.toLowerCase();
  if (key === "t") render("today");
  if (key === "x") render("next");
  if (key === "l") render("later");
  if (key === "h") render("habits");
  if (key === "j") {
    currentJournalDate = todayKey();
    isJournalHeatmapOpen = false;
    render("journal");
  }
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
    area.innerHTML = `
      <div class="user-telemetry-box" id="user-telemetry-box" title="Click to sign out">
        <div class="user-telemetry-row">
          <span class="user-telemetry-email">${escapeHtml(access.session?.email || "OPERATOR")}</span>
          <span class="user-arrow">›</span>
        </div>
        <div class="user-telemetry-status">
          <span class="status-dot">●</span>
          <span class="status-text">${pending ? `${pending} PENDING SYNC` : "SYNC ACTIVE"}</span>
          <span class="telemetry-ticks">|||||||||||||</span>
        </div>
      </div>
    `;
    const box = $("#user-telemetry-box");
    if (box) {
      box.onclick = async () => {
        if (confirm("Disconnect and sign out of session?")) {
          await authRepository.signOut();
          storageRepository.resetRuntimeState();
          location.replace("login.html");
        }
      };
    }
  } else {
    area.innerHTML = `
      <div class="user-telemetry-box" id="user-telemetry-box" title="Click to connect cloud sync">
        <div class="user-telemetry-row">
          <span class="user-telemetry-email">OPERATOR // LOCAL</span>
          <span class="user-arrow">›</span>
        </div>
        <div class="user-telemetry-status">
          <span class="status-dot">●</span>
          <span class="status-text">OFFLINE LOG</span>
          <span class="telemetry-ticks">|||||||||||||</span>
        </div>
      </div>
    `;
    const box = $("#user-telemetry-box");
    if (box) {
      box.onclick = () => location.href = "login.html";
    }
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
  startSystemTelemetryClock();
  updateSystemDateMetadata();

  let access = await authRepository.getAccessState();
  if (access.mode === "none") {
    // If not set yet, initialize as guest mode so NextFocus OS displays immediately
    await chrome.storage.local.set({ nextfocus_auth_mode: "guest" });
    access = await authRepository.getAccessState();
  }
  await renderAccountArea(access);
  const hash = location.hash;
  if (hash === "#new-task") await openTaskModal();
  else if (hash.startsWith("#focus:")) await showFocus(hash.slice(7));
  else if (hash === "#journal") { currentJournalDate = todayKey(); await render("journal"); }
  else await render("today");
}

init();