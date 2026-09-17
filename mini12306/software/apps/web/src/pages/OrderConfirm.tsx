/** 确认订单：核对车次与席别、选择乘车人、提交下单 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { money, seatClassStyle, weekday } from '../lib/format';
import { cn } from '../lib/cn';
import { Empty, ErrorBox, Spinner, Tag, useToast } from '../components/ui';

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

interface ScheduleView {
  trainNo: string;
  trainType: string;
  fromStation: string;
  fromCity: string;
  toStation: string;
  toCity: string;
  runDate: string;
  departTime: string;
  arriveTime: string;
  durationText: string;
  mileageKm: number;
  scheduleId: number;
  scheduleStatus: string;
  scheduleStatusText: string;
  note: string | null;
  purchasable: boolean;
  seats: SeatItem[];
}

interface Passenger {
  id: number;
  name: string;
  idCardMasked: string;
  idCardSuffix: string;
  phone: string | null;
  passengerType: string;
  isDefault: boolean;
}

interface PassengerData {
  list: Passenger[];
  max: number;
}

interface OrderView {
  orderNo: string;
  status: string;
  statusText: string;
  totalAmountCents: number;
  expireAt: string;
}

/* ── 票种规则（与后端 BR-13 / BR-14 一致） ────────────────── */

const TICKET_DISCOUNT: Record<string, number> = { ADULT: 1, CHILD: 0.5, STUDENT: 0.75 };
const TICKET_LABEL: Record<string, string> = { ADULT: '成人票', CHILD: '儿童票', STUDENT: '学生票' };
const TICKET_TONE: Record<string, string> = {
  ADULT: 'bg-slate-100 text-slate-700',
  CHILD: 'bg-sky-50 text-sky-700',
  STUDENT: 'bg-violet-50 text-violet-700',
};
const MAX_TICKETS = 5;

function studentAllowed(seatClass: string): boolean {
  return seatClass === 'SECOND' || seatClass === 'HARD_SEAT';
}

/* ── 页面 ─────────────────────────────────────────────────── */

export default function OrderConfirm() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const scheduleIdParam = Number(searchParams.get('scheduleId') ?? '');
  const seatClass = searchParams.get('seatClass') ?? '';
  const date = searchParams.get('date') ?? '';
  const trainNo = searchParams.get('trainNo') ?? '';

  const [schedule, setSchedule] = useState<ScheduleView | null>(null);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [maxPassengers, setMaxPassengers] = useState(10);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const idemRef = useRef(newIdempotencyKey('order'));

  const paramsValid = Number.isInteger(scheduleIdParam) && scheduleIdParam > 0 && seatClass !== '' && trainNo !== '' && date !== '';

  useEffect(() => {
    if (!paramsValid) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      api.get<ScheduleView>(`/trains/${encodeURIComponent(trainNo)}/schedule?date=${encodeURIComponent(date)}`),
      api.get<PassengerData>('/passengers'),
    ])
      .then(([sch, ps]) => {
        if (cancelled) return;
        setSchedule(sch);
        setPassengers(ps.list ?? []);
        setMaxPassengers(ps.max ?? 10);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '订单信息加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paramsValid, trainNo, date, reloadKey]);

  const seat = useMemo(() => schedule?.seats.find((s) => s.seatClass === seatClass) ?? null, [schedule, seatClass]);
  const seatPrice = seat?.priceCents ?? 0;

  const selectedPassengers = useMemo(
    () => passengers.filter((p) => selected.includes(p.id)),
    [passengers, selected],
  );

  const hasChild = selectedPassengers.some((p) => p.passengerType === 'CHILD');
  const hasAdult = selectedPassengers.some((p) => p.passengerType === 'ADULT');
  const childWithoutAdult = hasChild && !hasAdult;
  const studentBlocked = !studentAllowed(seatClass);
  const cancelled = schedule?.scheduleStatus === 'CANCELLED';

  const totalCents = selectedPassengers.reduce(
    (sum, p) => sum + Math.round(seatPrice * (TICKET_DISCOUNT[p.passengerType] ?? 1)),
    0,
  );

  const overStock = seat !== null && selected.length > seat.available;
  const canSubmit =
    !loading && !submitting && selected.length > 0 && !childWithoutAdult && !overStock && !cancelled && seat !== null;

  useEffect(() => {
    idemRef.current = newIdempotencyKey('order');
  }, [scheduleIdParam, seatClass, selected.join(',')]);

  const toggle = (p: Passenger) => {
    if (p.passengerType === 'STUDENT' && studentBlocked) return;
    setSelected((prev) => {
      if (prev.includes(p.id)) return prev.filter((id) => id !== p.id);
      if (prev.length >= MAX_TICKETS) {
        toast.error(`单笔订单最多购买 ${MAX_TICKETS} 张车票`);
        return prev;
      }
      return [...prev, p.id];
    });
  };

  const submit = async () => {
    if (!canSubmit || !schedule) return;
    setSubmitting(true);
    try {
      const order = await api.post<OrderView>(
        '/orders',
        { scheduleId: scheduleIdParam, seatClass, passengerIds: selected },
        { 'Idempotency-Key': idemRef.current },
      );
      toast.success(`下单成功，订单号 ${order.orderNo}，请尽快完成支付`);
      navigate(`/order/pay/${order.orderNo}`);
    } catch (e: unknown) {
      toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '下单失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (!paramsValid) {
    return (
      <div className="card">
        <Empty
          title="订单参数不完整"
          hint="请从车次列表重新选择席别后再提交订单。"
          action={
            <Link to="/" className="btn-primary">
              返回首页
            </Link>
          }
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <Spinner label="正在加载车次与乘车人信息…" />
      </div>
    );
  }

  if (error || !schedule || !seat) {
    return (
      <ErrorBox
        message={error || '该车次当日不发售所选席别，请重新选择'}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <h1 className="text-lg">确认订单</h1>

      {/* 车次与席别 */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg font-semibold tnum">{schedule.trainNo}</span>
          <Tag className={cancelTone(schedule.scheduleStatus)}>{schedule.scheduleStatusText}</Tag>
          <span className="text-sm text-slate-600">
            {schedule.runDate} · {weekday(schedule.runDate)}
          </span>
          <span className="ml-auto text-xs text-[var(--fg-muted)]">
            里程 <span className="tnum">{schedule.mileageKm}</span> 公里 · 历时 {schedule.durationText}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <div className="text-2xl font-semibold tnum">{schedule.departTime}</div>
            <div className="text-sm text-slate-600">{schedule.fromStation}</div>
          </div>
          <span className="text-slate-300">→</span>
          <div>
            <div className="text-2xl font-semibold tnum">{schedule.arriveTime}</div>
            <div className="text-sm text-slate-600">{schedule.toStation}</div>
          </div>
          <div className="ml-auto text-right">
            <Tag className={seatClassStyle(seat.seatClass)}>{seat.seatClassLabel}</Tag>
            <div className="mt-2 text-xl font-semibold tnum text-brand-700">{money(seat.priceCents)}</div>
            <div className="text-xs text-[var(--fg-muted)]">
              余票 {seat.availableText} · 成人票单价，儿童 5 折 / 学生 7.5 折
            </div>
          </div>
        </div>

        {schedule.note && <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">运行提示：{schedule.note}</p>}
        {cancelled && <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">该车次已停运，无法购票。</p>}
      </section>

      {/* 乘车人 */}
      <section className="card">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-base">选择乘车人</h2>
          <span className="text-xs text-[var(--fg-muted)]">
            已选 <span className="tnum">{selected.length}</span> / {MAX_TICKETS} 人
          </span>
          <Link to="/passengers" className="ml-auto btn-sm btn-ghost">
            去添加乘车人
          </Link>
        </div>

        {passengers.length === 0 ? (
          <Empty
            title="还没有乘车人"
            hint={`请先添加乘车人（最多 ${maxPassengers} 人），实名核验由本地 Mock 服务完成。`}
            action={
              <Link to="/passengers" className="btn-primary">
                添加乘车人
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {passengers.map((p) => {
              const checked = selected.includes(p.id);
              const blocked = p.passengerType === 'STUDENT' && studentBlocked;
              const price = Math.round(seatPrice * (TICKET_DISCOUNT[p.passengerType] ?? 1));
              return (
                <li key={p.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-3', blocked && 'opacity-60')}>
                  <input
                    id={`pax-${p.id}`}
                    type="checkbox"
                    className="w-4 h-4 accent-brand-600 shrink-0"
                    checked={checked}
                    disabled={blocked}
                    onChange={() => toggle(p)}
                  />
                  <label htmlFor={`pax-${p.id}`} className={cn('min-w-0 flex-1 cursor-pointer', blocked && 'cursor-not-allowed')}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{p.name}</span>
                      <Tag className={TICKET_TONE[p.passengerType] ?? 'bg-slate-100 text-slate-600'}>
                        {TICKET_LABEL[p.passengerType] ?? p.passengerType}
                      </Tag>
                      {p.isDefault && <Tag className="bg-brand-50 text-brand-700">默认</Tag>}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--fg-muted)] tnum">
                      {p.idCardMasked}
                      {p.phone ? ` · ${p.phone}` : ''}
                    </span>
                    {blocked && (
                      <span className="mt-0.5 block text-xs text-red-600">
                        学生票仅限二等座或硬座，当前选择「{seat.seatClassLabel}」不可使用学生票
                      </span>
                    )}
                  </label>
                  <span className="text-sm font-medium tnum text-slate-900">{money(price)}</span>
                </li>
              );
            })}
          </ul>
        )}

        {(childWithoutAdult || overStock) && (
          <div className="px-5 pb-4 space-y-2">
            {childWithoutAdult && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2" role="alert">
                已勾选儿童票但未勾选成人票：儿童票需至少一名成人同行，请补充成人票。
              </p>
            )}
            {overStock && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2" role="alert">
                所选人数超过当前余票（{seat.availableText}），请减少乘车人。
              </p>
            )}
          </div>
        )}
      </section>

      {/* 购票须知 */}
      <section className="card p-5 text-xs text-[var(--fg-muted)] leading-relaxed space-y-1.5">
        <p>· 下单后座位将被锁定 15 分钟，请在订单支付页完成支付，超时订单自动关闭并释放余票。</p>
        <p>· 同一乘车人同一乘车日期仅可持有一张有效车票，重复购买将被拒绝。</p>
        <p>· 成人票按全价计费，儿童票 5 折，学生票 7.5 折（仅限二等座 / 硬座）。</p>
      </section>

      {/* 合计栏 */}
      <div className="sticky bottom-14 md:bottom-0 z-30 card px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-sm text-slate-600">
            乘车人 <span className="tnum font-medium text-slate-900">{selected.length}</span> 人
          </span>
          {selectedPassengers.length > 0 && (
            <span className="text-xs text-[var(--fg-muted)] truncate max-w-full">
              {selectedPassengers.map((p) => p.name).join('、')}
            </span>
          )}
          <span className="ml-auto text-sm text-slate-600">
            合计 <span className="text-lg font-semibold tnum text-brand-700">{money(totalCents)}</span>
          </span>
          <button type="button" className="btn-primary min-w-[7.5rem]" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? '提交中…' : '提交订单'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 车次运行状态徽标配色 */
function cancelTone(status: string): string {
  if (status === 'CANCELLED') return 'bg-slate-200 text-slate-600';
  if (status === 'DELAYED') return 'bg-amber-50 text-amber-700';
  return 'bg-emerald-50 text-emerald-700';
}
