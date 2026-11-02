import { authRepository } from "./src/infrastructure/auth.js";
import { storageRepository } from "./src/infrastructure/storage.js";

const form = document.querySelector("#auth-form");
const errorEl = document.querySelector("#auth-error");
const submitEl = document.querySelector("#auth-submit");
const titleEl = document.querySelector("#auth-title");
const subtitleEl = document.querySelector("#auth-subtitle");
const tabs = [...document.querySelectorAll("[data-auth-tab]")];
const warning = document.querySelector("#config-warning");
let mode = "signin";

if (!authRepository.isConfigured()) warning.classList.remove("hidden");

const existing = await authRepository.getAccessState();
if (existing.mode === "account") location.replace("app.html");

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.toggle("hidden", !message);
}

function setMode(nextMode) {
  mode = nextMode;
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.authTab === mode));
  const signingUp = mode === "signup";
  titleEl.textContent = signingUp ? "Create your account" : "Welcome back";
  subtitleEl.textContent = signingUp ? "Create a simple email/password account for cloud sync." : "Use your email and password to restore and sync your workspace.";
  submitEl.textContent = signingUp ? "Create account" : "Sign in";
  form.elements.password.autocomplete = signingUp ? "new-password" : "current-password";
  showError("");
}

tabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.authTab)));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  showError("");
  submitEl.disabled = true;
  submitEl.textContent = mode === "signup" ? "Creating account…" : "Signing in…";
  try {
    if (mode === "signup") await authRepository.createAccount(data.email, data.password);
    else await authRepository.signIn(data.email, data.password);
    await storageRepository.initializeAccountData({ migrateGuest: true });
    location.replace("app.html");
  } catch (error) {
    showError(error.message);
    submitEl.disabled = false;
    submitEl.textContent = mode === "signup" ? "Create account" : "Sign in";
  }
});

document.querySelector("#skip-login").addEventListener("click", async () => {
  await authRepository.skipLogin();
  storageRepository.resetRuntimeState();
  location.replace("app.html");
});
