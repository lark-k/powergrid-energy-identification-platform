const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
export const timeText = (value: string | Date, withSeconds = false) => new Intl.DateTimeFormat("zh-CN", {
  timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined, hour12: false,
}).format(new Date(value));
export const dateText = (value: string | Date) => new Intl.DateTimeFormat("zh-CN", {
  timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value)).replaceAll("/", "-");
export const dateTimeText = (value: string | Date) => `${dateText(value)} ${timeText(value, true)}`;
export const powerText = (value: number | null | undefined) => {
  if (value == null) return "—";
  const magnitude = Math.abs(value);
  if (magnitude > 0 && magnitude < 0.01) {
    return value.toLocaleString("zh-CN", { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  }
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
};
export const percentText = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
