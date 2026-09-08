import { dateFromKey } from "./calendar-dates";

export const RECURRENCE_PRESETS = {
  NONE: "none",
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  ANNUALLY: "annually",
  WEEKDAYS: "weekdays",
  CUSTOM: "custom",
};

export const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

const pluralUnit = (unit, amount) => amount === 1 ? unit : `${unit}s`;

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizedEnd = (end = {}) => ({
  type: ["on", "after"].includes(end.type) ? end.type : "never",
  date: end.date || "",
  count: Math.max(1, Number(end.count) || 10),
});

export const noRecurrence = () => ({
  preset: RECURRENCE_PRESETS.NONE,
  frequency: "none",
  interval: 1,
  weekDays: [],
  monthMode: "day",
  end: normalizedEnd(),
});

export const recurrenceForPreset = (preset, dateKey, current = noRecurrence()) => {
  const startDate = dateFromKey(dateKey);
  const weekDay = startDate.getDay();
  const base = {
    preset,
    interval: 1,
    weekDays: [weekDay],
    monthMode: "weekday",
    end: normalizedEnd(),
  };

  if (preset === RECURRENCE_PRESETS.NONE) return noRecurrence();
  if (preset === RECURRENCE_PRESETS.DAILY) return { ...base, frequency: "day" };
  if (preset === RECURRENCE_PRESETS.WEEKLY) return { ...base, frequency: "week" };
  if (preset === RECURRENCE_PRESETS.MONTHLY) return { ...base, frequency: "month" };
  if (preset === RECURRENCE_PRESETS.ANNUALLY) return { ...base, frequency: "year" };
  if (preset === RECURRENCE_PRESETS.WEEKDAYS) {
    return { ...base, frequency: "week", weekDays: [1, 2, 3, 4, 5] };
  }

  return {
    ...base,
    preset: RECURRENCE_PRESETS.CUSTOM,
    frequency: current.frequency === "none" ? "week" : current.frequency,
    interval: Math.max(1, Number(current.interval) || 1),
    weekDays: current.weekDays?.length ? current.weekDays : [weekDay],
    monthMode: current.monthMode === "weekday" ? "weekday" : "day",
    end: normalizedEnd(current.end),
  };
};

const ordinalWeekdayLabel = (date) => {
  const ordinal = Math.ceil(date.getDate() / 7);
  const isLast = date.getDate() + 7 > new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
  ).getDate();
  const ordinalLabel = isLast
    ? "last"
    : ["first", "second", "third", "fourth", "fifth"][ordinal - 1];
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  return `${ordinalLabel} ${weekday}`;
};

export const recurrenceOptions = (dateKey) => {
  const date = dateFromKey(dateKey);
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const annualDate = date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return [
    { value: RECURRENCE_PRESETS.NONE, label: "Does not repeat" },
    { value: RECURRENCE_PRESETS.DAILY, label: "Daily" },
    { value: RECURRENCE_PRESETS.WEEKLY, label: `Weekly on ${weekday}` },
    { value: RECURRENCE_PRESETS.MONTHLY, label: `Monthly on the ${ordinalWeekdayLabel(date)}` },
    { value: RECURRENCE_PRESETS.ANNUALLY, label: `Annually on ${annualDate}` },
    { value: RECURRENCE_PRESETS.WEEKDAYS, label: "Every weekday (Monday to Friday)" },
    { value: RECURRENCE_PRESETS.CUSTOM, label: "Custom…" },
  ];
};

export const recurrenceLabel = (recurrence, dateKey) => {
  const preset = recurrence?.preset || RECURRENCE_PRESETS.NONE;
  const presetOption = recurrenceOptions(dateKey).find((option) => option.value === preset);
  if (preset !== RECURRENCE_PRESETS.CUSTOM) return presetOption?.label || "Does not repeat";

  const interval = Math.max(1, Number(recurrence.interval) || 1);
  return `Every ${interval === 1 ? "" : `${interval} `}${pluralUnit(recurrence.frequency, interval)}`;
};

export const customRecurrenceForChange = (recurrence, change, dateKey) => {
  const next = {
    ...recurrenceForPreset(RECURRENCE_PRESETS.CUSTOM, dateKey, recurrence),
    ...change,
    preset: RECURRENCE_PRESETS.CUSTOM,
  };
  if (change.end) next.end = normalizedEnd({ ...recurrence.end, ...change.end });
  if (change.frequency === "week" && !next.weekDays.length) {
    next.weekDays = [dateFromKey(dateKey).getDay()];
  }
  return next;
};

const monthlyCandidate = (start, monthOffset, monthMode) => {
  const monthStart = new Date(start.getFullYear(), start.getMonth() + monthOffset, 1);
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  if (monthMode !== "weekday") {
    const candidate = new Date(year, month, start.getDate());
    return candidate.getMonth() === month ? candidate : null;
  }

  const weekday = start.getDay();
  const startMonthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const startIsLast = start.getDate() + 7 > startMonthEnd.getDate();
  if (startIsLast) {
    const monthEnd = new Date(year, month + 1, 0);
    monthEnd.setDate(monthEnd.getDate() - ((monthEnd.getDay() - weekday + 7) % 7));
    return monthEnd;
  }

  const ordinal = Math.ceil(start.getDate() / 7);
  const firstWeekdayOffset = (weekday - monthStart.getDay() + 7) % 7;
  const candidate = new Date(year, month, 1 + firstWeekdayOffset + (ordinal - 1) * 7);
  return candidate.getMonth() === month ? candidate : null;
};

export const recurrenceDateKeys = (
  startDateKey,
  recurrence = noRecurrence(),
  visibleHorizonDateKey = startDateKey,
) => {
  if (!recurrence || recurrence.frequency === "none") return [startDateKey];

  const start = dateFromKey(startDateKey);
  const end = normalizedEnd(recurrence.end);
  const visibleHorizon = dateFromKey(visibleHorizonDateKey);
  const horizon = end.type === "on" && end.date && end.date < visibleHorizonDateKey
    ? dateFromKey(end.date)
    : visibleHorizon < start ? start : visibleHorizon;
  const targetCount = end.type === "after" ? end.count : Number.POSITIVE_INFINITY;
  const results = [startDateKey];
  const interval = Math.max(1, Number(recurrence.interval) || 1);
  const canAdd = (candidate) => (
    candidate
    && candidate > start
    && candidate <= horizon
    && results.length < targetCount

  );
  const addCandidate = (candidate) => {
    if (!canAdd(candidate)) return false;
    results.push(toDateKey(candidate));
    return true;
  };

  if (recurrence.frequency === "day") {
    for (let cycle = 1; cycle < 100000 && results.length < targetCount; cycle += 1) {
      const candidate = new Date(start);
      candidate.setDate(candidate.getDate() + cycle * interval);
      if (!addCandidate(candidate)) break;
    }
  } else if (recurrence.frequency === "week") {
    const weekStart = new Date(start);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekDays = [...new Set(recurrence.weekDays)].sort((first, second) => first - second);
    for (let cycle = 0; cycle < 100000 && results.length < targetCount; cycle += 1) {
      let pastHorizon = false;
      weekDays.forEach((weekDay) => {
        if (results.length >= targetCount) return;
        const candidate = new Date(weekStart);
        candidate.setDate(candidate.getDate() + cycle * interval * 7 + weekDay);
        if (candidate > horizon) pastHorizon = true;
        addCandidate(candidate);
      });
      if (pastHorizon) break;
    }
  } else if (recurrence.frequency === "month") {
    for (let cycle = 1; cycle < 100000 && results.length < targetCount; cycle += 1) {
      const candidate = monthlyCandidate(start, cycle * interval, recurrence.monthMode);
      if (!addCandidate(candidate) && candidate > horizon) break;
    }
  } else if (recurrence.frequency === "year") {
    for (let cycle = 1; cycle < 100000 && results.length < targetCount; cycle += 1) {
      const year = start.getFullYear() + cycle * interval;
      const candidate = new Date(year, start.getMonth(), start.getDate());
      const validDate = candidate.getFullYear() === year
        && candidate.getMonth() === start.getMonth()
        ? candidate
        : null;
      if (!addCandidate(validDate) && validDate > horizon) break;
    }
  }

  return results;
};
