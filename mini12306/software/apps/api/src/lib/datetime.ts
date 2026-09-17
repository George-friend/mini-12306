/**
 * 时间工具：全系统统一按东八区（+08:00）理解与展示。
 * 运行日的发车时刻 = runDate + train.departTime，落库为 Date（UTC 瞬间）。
 */

/** 把「运行日 + HH:mm」组合成 Date（按 +08:00 解释） */
export function combineDateTime(runDate: string, hhmm: string): Date {
  return new Date(`${runDate}T${hhmm}:00+08:00`);
}

/** 东八区「今天」的日期字符串 */
export function todayCn(): string {
  return cnDateString(new Date());
}

/** 把 Date 转成东八区日期字符串 yyyy-MM-dd */
export function cnDateString(d: Date): string {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 把 Date 转成东八区时间字符串 yyyy-MM-dd HH:mm:ss */
export function cnDateTimeString(d: Date): string {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/** 日期字符串加减天数 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return cnDateString(d);
}

/** 两个时刻相差小时数（保留 2 位小数） */
export function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 3600000) * 100) / 100;
}

/** 时长（分钟）转 "8小时30分" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}小时` : `${h}小时${m}分`;
}
