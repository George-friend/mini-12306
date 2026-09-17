/** 车次列表：条件回显、筛选与排序、车次卡片与席别选择 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { addDays, money, seatClassStyle, today, weekday } from '../lib/format';
import { cn } from '../lib/cn';
import { Empty, ErrorBox, Spinner } from '../components/ui';

/* ── 接口类型 ─────────────────────────────────────────────── */

interface SeatItem {
  seatClass: string;
  seatClassLabel: string;
  priceCents: number;
  priceYuan: string;
  total: number;
  available: number;
  availableText: string;
}

interface TrainItem {
  trainId: number;
  trainNo: string;
  trainType: string;
  fromStation: string;
  fromCity: string;
  toStation: string;
  toCity: string;
  runDate: string;
  departTime: string;
  arriveTime: string;
  departDateTime: string;
  durationMin: number;
  durationText: string;
  mileageKm: number;
  minPriceCents: number;
  minPriceYuan: string;
  scheduleId: number;
  scheduleStatus: string;
  scheduleStatusText: string;
  delayMinutes: number;
  note: string | null;
  purchasable: boolean;
  seats: SeatItem[];
}

interface SearchData {
  from: { id: number; name: string; city: string };
  to: { id: number; name: string; city: string };
  runDate: string;
  total: number;
  list: TrainItem[];
}

/* ── 常量 ─────────────────────────────────────────────────── */

const MAX_DAYS = 14;

const TRAIN_TYPES = [
  { value: '', label: '不限' },
  { value: 'G', label: 'G 高铁' },
  { value: 'D', label: 'D 动车' },
  { value: 'T', label: 'T 特快' },
  { value: 'K', label: 'K 快速' },
  { value: 'Z', label: 'Z 直达' },
];

const SEAT_CLASSES = [
  { value: '', label: '不限' },
  { value: 'BUSINESS', label: '商务座' },
  { value: 'FIRST', label: '一等座' },
  { value: 'SECOND', label: '二等座' },
  { value: 'STANDING', label: '无座' },
  { value: 'SOFT_SLEEPER', label: '软卧' },
  { value: 'HARD_SLEEPER', label: '硬卧' },
  { value: 'HARD_SEAT', label: '硬座' },
];

const TIME_RANGES = [
  { value: '', label: '不限', from: '', to: '' },
  { value: '00:00-06:00', label: '凌晨 00:00 - 06:00', from: '00:00', to: '06:00' },
  { value: '06:00-12:00', label: '上午 06:00 - 12:00', from: '06:00', to: '12:00' },
  { value: '12:00-18:00', label: '下午 12:00 - 18:00', from: '12:00', to: '18:00' },
  { value: '18:00-24:00', label: '晚间 18:00 - 24:00', from: '18:00', to: '24:00' },
];

const SORTS = [
  { value: 'departTime', label: '发车时间（早 → 晚）' },
  { value: 'duration', label: '历时（短 → 长）' },
  { value: 'price', label: '票价（低 → 高）' },
];

const TYPE_TONE: Record<string, string> = {
  G: 'bg-brand-50 text-brand-700',
  D: 'bg-sky-50 text-sky-700',
  T: 'bg-teal-50 text-teal-700',
  K: 'bg-amber-50 text-amber-700',
  Z: 'bg-violet-50 text-violet-700',
};

/** 余票文案配色 */
function availableTone(text: string, available: number): string {
  if (available <= 0) return 'text-slate-400';
  if (text === '有票') return 'text-emerald-600';
  if (available < 10) return 'text-amber-600';
  return 'text-slate-600';
}

/* ── 页面 ─────────────────────────────────────────────────── */

export default function TrainList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const date = searchParams.get('date') ?? '';

  const [trainType, setTrainType] = useState('');
  const [seatClass, setSeatClass] = useState('');
  const [timeRange, setTimeRange] = useState('');
  const [sortBy, setSortBy] = useState('departTime');
  const [filterOpen, setFilterOpen] = useState(false);

  const [data, setData] = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const todayStr = today();
  const maxDate = addDays(todayStr, MAX_DAYS - 1);

  const range = useMemo(() => TIME_RANGES.find((t) => t.value === timeRange) ?? TIME_RANGES[0], [timeRange]);

  const queryString = qs({
    from,
    to,
    date: date || todayStr,
    trainType,
    seatClass,
    departFrom: range.from,
    departTo: range.to,
    sortBy,
  });

  useEffect(() => {
    if (!from || !to) {
      setData(null);
      setError('');
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get<SearchData>(`/trains/search${queryString}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : '车次查询失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryString, from, to, reloadKey]);

  const shiftDate = (delta: number) => {
    const base = date || todayStr;
    const next = addDays(base, delta);
    if (next < todayStr || next > maxDate) return;
    const p = new URLSearchParams(searchParams);
    p.set('date', next);
    setSearchParams(p);
  };

  const setDateQuick = (value: string) => {
    const p = new URLSearchParams(searchParams);
    p.set('date', value);
    setSearchParams(p);
  };

  const resetFilters = () => {
    setTrainType('');
    setSeatClass('');
    setTimeRange('');
    setSortBy('departTime');
  };

  const canPrev = (date || todayStr) > todayStr;
  const canNext = (date || todayStr) < maxDate;

  if (!from || !to) {
    return (
      <div className="card">
        <Empty
          title="尚未指定查询条件"
          hint="请先在首页选择出发站、到达站与乘车日期。"
          action={
            <Link to="/" className="btn-primary">
              返回首页查询
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 条件回显 + 日期切换 */}
      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg">
              <span className="truncate">{from}</span>
              <span className="text-slate-300">→</span>
              <span className="truncate">{to}</span>
            </div>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              {date || todayStr} · {weekday(date || todayStr)}
              {data ? ` · 共 ${data.total} 个车次` : ''}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" className="btn-sm btn-ghost h-9" disabled={!canPrev} onClick={() => shiftDate(-1)}>
              前一天
            </button>
            <input
              type="date"
              aria-label="乘车日期"
              className="input w-[10.5rem] h-9"
              value={date || todayStr}
              min={todayStr}
              max={maxDate}
              onChange={(e) => {
                if (!e.target.value) return;
                setDateQuick(e.target.value);
              }}
            />
            <button type="button" className="btn-sm btn-ghost h-9" disabled={!canNext} onClick={() => shiftDate(1)}>
              后一天
            </button>
            <div className="flex gap-1" role="group" aria-label="快捷日期">
              {[0, 1, 2].map((offset) => {
                const value = addDays(todayStr, offset);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={(date || todayStr) === value}
                    className={cn('btn-sm h-9', (date || todayStr) === value ? 'btn-primary' : 'btn-ghost')}
                    onClick={() => setDateQuick(value)}
                  >
                    {offset === 0 ? '今天' : offset === 1 ? '明天' : '后天'}
                  </button>
                );
              })}
            </div>
            <Link to="/" className="btn-sm btn-ghost h-9">
              修改条件
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        {/* 筛选 */}
        <aside className="lg:sticky lg:top-20">
          <div className="card">
            <button
              type="button"
              className="lg:hidden w-full flex items-center justify-between px-4 h-12 text-sm"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((v) => !v)}
            >
              <span>筛选与排序</span>
              <span className="text-slate-400">{filterOpen ? '收起 ▲' : '展开 ▼'}</span>
            </button>
            <div className={cn('px-4 pb-4', filterOpen ? 'block' : 'hidden lg:block')}>
              <div className="hidden lg:flex items-center justify-between pt-4">
                <h2 className="text-sm font-medium">筛选与排序</h2>
                <button type="button" className="text-xs text-brand-700 hover:underline" onClick={resetFilters}>
                  重置
                </button>
              </div>

              <fieldset className="mt-4">
                <legend className="label">车次类型</legend>
                <div className="flex flex-wrap gap-1.5">
                  {TRAIN_TYPES.map((t) => (
                    <button
                      key={t.value || 'all'}
                      type="button"
                      aria-pressed={trainType === t.value}
                      className={cn('btn-sm', trainType === t.value ? 'btn-primary' : 'btn-ghost')}
                      onClick={() => setTrainType(t.value)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="mt-4">
                <legend className="label">发车时段</legend>
                <div className="space-y-1.5">
                  {TIME_RANGES.map((t) => (
                    <label key={t.value || 'all'} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="depart-range"
                        className="accent-brand-600"
                        checked={timeRange === t.value}
                        onChange={() => setTimeRange(t.value)}
                      />
                      {t.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="mt-4">
                <label className="label" htmlFor="filter-seat">
                  席别
                </label>
                <select id="filter-seat" className="input" value={seatClass} onChange={(e) => setSeatClass(e.target.value)}>
                  {SEAT_CLASSES.map((s) => (
                    <option key={s.value || 'all'} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-4">
                <label className="label" htmlFor="filter-sort">
                  排序方式
                </label>
                <select id="filter-sort" className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </aside>

        {/* 车次列表 */}
        <section className="min-w-0 space-y-4">
          {loading ? (
            <div className="card">
              <Spinner label="正在查询车次…" />
            </div>
          ) : error ? (
            <ErrorBox
              message={error}
              onRetry={() => {
                setReloadKey((k) => k + 1);
              }}
            />
          ) : !data || data.list.length === 0 ? (
            <div className="card">
              <Empty
                title="当日无符合条件车次"
                hint="可尝试切换乘车日期、放宽筛选条件，或更换出发/到达车站。"
                action={
                  <button type="button" className="btn-ghost" onClick={resetFilters}>
                    清空筛选条件
                  </button>
                }
              />
            </div>
          ) : (
            data.list.map((t) => {
              const cancelled = t.scheduleStatus === 'CANCELLED';
              const delayed = t.scheduleStatus === 'DELAYED';
              return (
                <article
                  key={t.scheduleId}
                  className={cn('card overflow-hidden', cancelled && 'bg-slate-50 opacity-70')}
                >
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-slate-50/60">
                    <span className="text-base font-semibold tnum">{t.trainNo}</span>
                    <span className={cn('badge', TYPE_TONE[t.trainType] ?? 'bg-slate-100 text-slate-600')}>{t.trainType} 字头</span>
                    <span
                      className={cn(
                        'badge',
                        cancelled
                          ? 'bg-slate-200 text-slate-600'
                          : delayed
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700',
                      )}
                    >
                      {t.scheduleStatusText}
                    </span>
                    {t.note && <span className="text-xs text-[var(--fg-muted)] truncate max-w-full">{t.note}</span>}
                    <span className="ml-auto text-xs text-[var(--fg-muted)]">
                      里程 <span className="tnum">{t.mileageKm}</span> 公里
                    </span>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 py-4 sm:gap-4">
                    <div className="min-w-0">
                      <div className="text-xl sm:text-2xl font-semibold tnum">{t.departTime}</div>
                      <div className="mt-0.5 text-sm text-slate-600 truncate">{t.fromStation}</div>
                    </div>
                    <div className="text-center text-xs text-[var(--fg-muted)]">
                      <div className="tnum">{t.durationText}</div>
                      <div className="mt-1 flex items-center gap-1 text-slate-300">
                        <span className="hidden sm:inline">━━━━</span>
                        <span aria-hidden>›</span>
                        <span className="hidden sm:inline">━━━━</span>
                      </div>
                    </div>
                    <div className="min-w-0 text-right">
                      <div className="text-xl sm:text-2xl font-semibold tnum">{t.arriveTime}</div>
                      <div className="mt-0.5 text-sm text-slate-600 truncate">{t.toStation}</div>
                    </div>
                  </div>

                  <ul className="border-t border-slate-100">
                    {t.seats.map((s) => {
                      const soldOut = s.available <= 0;
                      const disabled = cancelled || soldOut;
                      return (
                        <li
                          key={s.seatClass}
                          className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-slate-100 last:border-b-0"
                        >
                          <span className={cn('badge', seatClassStyle(s.seatClass))}>{s.seatClassLabel}</span>
                          <span className={cn('text-xs tnum', availableTone(s.availableText, s.available))}>
                            余票：{s.availableText}
                          </span>
                          <span className="ml-auto text-sm font-medium tnum text-slate-900">{money(s.priceCents)}</span>
                          <button
                            type="button"
                            className="btn-sm btn-primary w-[4.5rem]"
                            disabled={disabled}
                            onClick={() =>
                              navigate(
                                `/order/confirm?scheduleId=${t.scheduleId}&seatClass=${s.seatClass}` +
                                  `&date=${encodeURIComponent(t.runDate)}&trainNo=${encodeURIComponent(t.trainNo)}`,
                              )
                            }
                          >
                            {cancelled ? '停运' : soldOut ? '无票' : '选择'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
