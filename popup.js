import { getAppState, makeToday, recommendation, startTask } from "./src/application/taskService.js";
import { TASK_STATUS } from "./src/domain/constants.js";
import { escapeHtml, formatDate, todayKey } from "./src/shared/utils.js";
import { authRepository } from "./src/infrastructure/auth.js";
import { storageRepository } from "./src/infrastructure/storage.js";

const shell = document.querySelector(".popup-shell");

function openFullApp(path = "app.html") {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}

function renderAuthGate() {
  shell.innerHTML = `
    <section class="popup-auth">
      <div class="popup-auth-mark">N</div>
      <h1>Welcome to NextFocus</h1>
      <p>Sign in to sync your data to Firebase, or continue completely offline.</p>
      <button class="btn" id="popup-signin">Sign in</button>
      <button class="popup-skip" id="popup-skip">Skip — continue offline</button>
    </section>`;
  document.querySelector("#popup-signin").onclick = () => openFullApp("login.html");
  document.querySelector("#popup-skip").onclick = async () => {
    await authRepository.skipLogin();
    storageRepository.resetRuntimeState();
    location.reload();
  };
}

async function render() {
  const access = await authRepository.getAccessState();
  if (access.mode === "none") return renderAuthGate();

  const dateEl = document.querySelector("#popup-date");
  const mainEl = document.querySelector("#popup-main");
  const nextEl = document.querySelector("#popup-next");
  const countEl = document.querySelector("#next-count");
  dateEl.textContent = formatDate();

  document.querySelector("#open-journal").onclick = () => openFullApp("app.html#journal");
  document.querySelector("#open-app").onclick = () => openFullApp();
  document.querySelector("#quick-capture").onclick = () => openFullApp("app.html#new-task");

  const status = document.createElement("div");
  status.className = "popup-mode";
  status.textContent = access.mode === "account" ? "☁ Synced" : "Offline";
  document.querySelector("header > div").appendChild(status);

  const state = await getAppState();
  const plan = state.plans[todayKey()] ?? { mainTaskId: null, quickTaskIds: [] };
  const main = state.tasks.find((t) => t.id === plan.mainTaskId && t.status !== TASK_STATUS.DONE);
  const next = state.tasks.filter((t) => t.status === TASK_STATUS.NEXT).slice(0, 3);
  const goals = new Map(state.goals.map((g) => [g.id, g]));

  if (main) {
    mainEl.innerHTML = `
      <div class="main-task">
        <div class="goal">${escapeHtml(goals.get(main.goalId)?.title ?? "Goal")}</div>
        <h2>${escapeHtml(main.title)}</h2>
        <div class="meta">${main.estimatedMinutes ? `~${main.estimatedMinutes} min` : "Ready to start"}</div>
        <button class="btn" id="start-main">${main.status === TASK_STATUS.IN_PROGRESS ? "RESUME" : "START"}</button>
      </div>`;
    document.querySelector("#start-main").onclick = async () => {
      if (main.status !== TASK_STATUS.IN_PROGRESS) await startTask(main.id);
      openFullApp(`app.html#focus:${main.id}`);
    };
  } else {
    const rec = recommendation(state.tasks);
    mainEl.innerHTML = `
      <div class="empty-main">
        <strong>Nothing planned for today.</strong>
        <p class="muted">${rec ? `Recommended: ${escapeHtml(rec.title)}` : "Prepare a small NEXT queue first."}</p>
        ${rec ? '<button class="btn" id="accept-rec">Make today\'s task</button>' : '<button class="btn" id="open-later">Open app</button>'}
      </div>`;
    if (rec) document.querySelector("#accept-rec").onclick = async () => { await makeToday(rec.id); render(); };
    else document.querySelector("#open-later").onclick = () => openFullApp();
  }

  countEl.textContent = `${state.tasks.filter((t) => t.status === TASK_STATUS.NEXT).length}/7`;
  nextEl.innerHTML = next.length ? next.map((t, i) => `<div class="next-row"><span class="index">${i + 1}</span><span>${escapeHtml(t.title)}</span></div>`).join("") : `<div class="muted" style="font-size:12px">Your prepared queue is empty.</div>`;
}

render();
