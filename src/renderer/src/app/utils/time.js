export const currentDayMinute = (now = new Date()) => (
  now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 + now.getMilliseconds() / 60000
);

export function minutesLabel(minutes) {
  if (!minutes) return "--:--";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}:${String(rest).padStart(2, "0")}` : `0:${String(rest).padStart(2, "0")}`;
}

export function timeLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
