export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(date);
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function parseDateKey(dateKeyStr) {
  const [y, m, d] = dateKeyStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDateKey(dateKeyStr, days) {
  const date = parseDateKey(dateKeyStr);
  date.setDate(date.getDate() + days);
  return todayKey(date);
}

export function formatJournalDate(dateKeyStr) {
  const date = parseDateKey(dateKeyStr);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(date);
}

export function formatShortDate(dateKeyStr) {
  const date = parseDateKey(dateKeyStr);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(date);
}

export function formatTimeOnly(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
