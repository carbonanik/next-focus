import { storageRepository } from "../infrastructure/storage.js";
import { todayKey, uid } from "../shared/utils.js";

const HABIT_TYPES = new Set(["DO", "AVOID"]);
const FREQUENCY_TYPES = new Set(["DAILY", "WEEKDAYS", "SPECIFIC_DAYS", "WEEKLY_TARGET"]);
const LOG_VALUES = new Set(["done", "minimum", "kept", "broken"]);
const DAY_COUNT = 7;

function startOfWeek(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % DAY_COUNT));
  return monday;
}

function normalizeSchedule(schedule = {}) {
  const type = FREQUENCY_TYPES.has(schedule.type) ? schedule.type : "DAILY";
  const days = [...new Set((schedule.days ?? []).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day < DAY_COUNT))].sort();
  const targetPerWeek = Math.min(7, Math.max(1, Number(schedule.targetPerWeek) || 1));
  if (type === "SPECIFIC_DAYS" && !days.length) throw new Error("Choose at least one day for this habit.");
  return { type, days: type === "SPECIFIC_DAYS" ? days : [], targetPerWeek };
}

function normalizeHabitInput(input) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Enter a habit name.");
  const type = HABIT_TYPES.has(input.type) ? input.type : "DO";
  const normal = String(input.normal ?? "").trim();
  const minimum = String(input.minimum ?? "").trim();
  if (type === "DO" && !normal) throw new Error("Describe the normal version of this habit.");
  if (type === "DO" && !minimum) throw new Error("Add a minimum version to make this habit easier to keep on difficult days.");
  return {
    name,
    type,
    normal: type === "DO" ? normal : "",
    minimum: type === "DO" ? minimum : "",
    schedule: normalizeSchedule(input.schedule),
    goalId: String(input.goalId ?? "").trim() || null
  };
}

export async function createHabit(input) {
  const habit = {
    id: uid("habit"),
    ...normalizeHabitInput(input),
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    logs: {}
  };
  const habits = await storageRepository.getHabits();
  await storageRepository.saveHabits([...habits, habit]);
  return habit;
}

export async function updateHabit(habitId, patch) {
  const habits = await storageRepository.getHabits();
  const index = habits.findIndex((habit) => habit.id === habitId);
  if (index < 0) throw new Error("Habit not found.");
  habits[index] = { ...habits[index], ...normalizeHabitInput({ ...habits[index], ...patch }) };
  await storageRepository.saveHabits(habits);
  return habits[index];
}

export async function setHabitStatus(habitId, status) {
  if (!["ACTIVE", "PAUSED", "ARCHIVED"].includes(status)) throw new Error("Invalid habit status.");
  const habits = await storageRepository.getHabits();
  const habit = habits.find((entry) => entry.id === habitId);
  if (!habit) throw new Error("Habit not found.");
  habit.status = status;
  await storageRepository.saveHabits(habits);
}

export async function checkInHabit(habitId, value, dateKey = todayKey()) {
  if (value !== null && !LOG_VALUES.has(value)) throw new Error("Invalid habit check-in.");
  const habits = await storageRepository.getHabits();
  const habit = habits.find((entry) => entry.id === habitId);
  if (!habit) throw new Error("Habit not found.");
  if (habit.status !== "ACTIVE") throw new Error("Only active habits can be checked in.");
  if (value && (habit.type === "DO" ? !["done", "minimum"].includes(value) : !["kept", "broken"].includes(value))) {
    throw new Error("That check-in does not match this habit type.");
  }
  habit.logs = { ...(habit.logs ?? {}) };
  if (value === null) delete habit.logs[dateKey];
  else habit.logs[dateKey] = value;
  await storageRepository.saveHabits(habits);
}

export function isHabitScheduled(habit, date = new Date()) {
  const schedule = habit.schedule ?? { type: "DAILY" };
  const day = date.getDay();
  if (schedule.type === "WEEKDAYS") return day >= 1 && day <= 5;
  if (schedule.type === "SPECIFIC_DAYS") return (schedule.days ?? []).includes(day);
  return true;
}

export function getHabitWeeklySummary(habit, referenceDate = new Date()) {
  const monday = startOfWeek(referenceDate);
  const schedule = habit.schedule ?? { type: "DAILY" };
  let target = 7;
  if (schedule.type === "WEEKDAYS") target = 5;
  if (schedule.type === "SPECIFIC_DAYS") target = schedule.days?.length ?? 0;
  if (schedule.type === "WEEKLY_TARGET") target = schedule.targetPerWeek ?? 1;

  let completed = 0;
  for (let offset = 0; offset < DAY_COUNT; offset += 1) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);
    const log = habit.logs?.[todayKey(date)];
    if (habit.type === "AVOID" ? log === "kept" : log === "done" || log === "minimum") completed += 1;
  }
  return { completed, target };
}

export function getHabitWeekDates(referenceDate = new Date()) {
  const monday = startOfWeek(referenceDate);
  return Array.from({ length: DAY_COUNT }, (_, offset) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);
    return todayKey(date);
  });
}
