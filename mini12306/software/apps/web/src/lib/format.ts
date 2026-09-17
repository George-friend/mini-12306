/** 展示层格式化工具 */

/** 分 → 元（保留 2 位小数，不带符号） */
export function yuan(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '0.00';
  return (cents / 100).toFixed(2);
}

/** 分 → ￥元 */
export function money(cents: number | null | undefined): string {
  return `￥${yuan(cents)}`;
}

/** ISO 时间 → 2026-09-20 14:30 */
export function dateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '--';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '--';
  const cn = new Date(d.getTime() + 8 * 3600 * 1000);
  return cn.toISOString().slice(0, 16).replace('T', ' ');
}

/** ISO 时间 → 2026-09-20 */
export function dateOnly(iso: string | Date | null | undefined): string {
  if (!iso) return '--';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '--';
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 东八区今天 yyyy-MM-dd */
export function today(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 日期偏移 n 天 */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 星期几 */
export function weekday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()];
}

/** 倒计时展示：剩余 12 分 30 秒 */
export function countdown(target: string | Date): string {
  const t = typeof target === 'string' ? new Date(target) : target;
  const ms = t.getTime() - Date.now();
  if (ms <= 0) return '已超时';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`;
}

/** 分钟 → 8小时30分 */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}小时` : `${h}小时${m}分`;
}

/** 订单状态 → 徽标配色 */
export function orderStatusTone(status: string): string {
  switch (status) {
    case 'PENDING_PAYMENT':
      return 'bg-amber-50 text-amber-700';
    case 'PAID':
      return 'bg-emerald-50 text-emerald-700';
    case 'PARTIAL_REFUNDED':
      return 'bg-sky-50 text-sky-700';
    case 'REFUNDED':
      return 'bg-slate-100 text-slate-600';
    case 'CHANGED':
      return 'bg-violet-50 text-violet-700';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'bg-slate-100 text-slate-500';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

/** 车票状态 → 徽标配色 */
export function ticketStatusTone(status: string): string {
  switch (status) {
    case 'TICKETED':
      return 'bg-emerald-50 text-emerald-700';
    case 'LOCKED':
      return 'bg-amber-50 text-amber-700';
    case 'REFUNDING':
      return 'bg-sky-50 text-sky-700';
    case 'REFUNDED':
    case 'CANCELLED':
      return 'bg-slate-100 text-slate-500';
    case 'CHANGED':
      return 'bg-violet-50 text-violet-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

/** 席别 → 静态样式 */
export function seatClassStyle(seatClass: string): string {
  switch (seatClass) {
    case 'BUSINESS':
      return 'text-violet-700 bg-violet-50';
    case 'FIRST':
      return 'text-sky-700 bg-sky-50';
    case 'SECOND':
      return 'text-brand-700 bg-brand-50';
    case 'SOFT_SLEEPER':
      return 'text-indigo-700 bg-indigo-50';
    case 'HARD_SLEEPER':
      return 'text-teal-700 bg-teal-50';
    case 'HARD_SEAT':
      return 'text-amber-700 bg-amber-50';
    default:
      return 'text-slate-600 bg-slate-100';
  }
}

/** 脱敏手机号 */
export function maskPhone(phone?: string | null): string {
  if (!phone || phone.length !== 11) return phone ?? '--';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}
