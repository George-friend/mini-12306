/** 改签：选择目标日期与车次、差价试算与提交 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, qs } from '../lib/api';
import { addDays, money, seatClassStyle, today, weekday } from '../lib/format';
import { cn } from '../lib/cn';
import { Empty, ErrorBox, Modal, Spinner, Tag, useToast } from '../components/ui';

/* ── 接口类型 ─────────────────────────────────────────────── */

interface OrderItemView {
  id: number;
  passengerName: string;
  idCardMasked: string;
  seatClass: string;
  seatClassLabel: string;
  ticketType: string;
  ticketTypeLabel: string;
  priceCents: number;
  seatNo: string;
  ticketStatus: string;
  ticketStatusText: string;
  changeCount: number;
}

interface OrderDetailData {
  orderNo: string;
  status: string;
  statusText: string;
  train: {
    trainNo: string;
    trainType: string;
    fromStation: string;
    toStation: string;
    runDate: string;
    departTime: string;
    arriveTime: string;
  };
  items: OrderItemView[];
}

interface SeatItem {
  seatClass: string;
  seatClassLabel: string;
  priceCents: number;
  total: number;
  available: number;
  availableText: string;
}

interface TrainSearchItem {
  trainNo: string;
  trainType: string;
  fromStation: string;
  toStation: string;
  runDate: string;
  departTime: string;
  arriveTime: string;
  durationText: string;
  minPriceCents: number;
  scheduleId: number;
  scheduleStatus: string;
  scheduleStatusText: string;
  purchasable: boolean;
  seats: SeatItem[];
}

interface SearchData {
  runDate: string;
  total: number;
  list: TrainSearchItem[];
}

interface ChangePreviewItem {
  orderItemId: number;
  passengerName: string;
  fromSeatClass: string;
  toSeatClass: string;
  fromPriceCents: number;
  toPriceCents: number;
  diffCents: number;
  diffType: 'PAY' | 'REFUND' | 'NONE';
  feeCents: number;
  refundCents: number;
  payableCents: number;
  fromPriceYuan: string;
  toPriceYuan: string;
  diffYuan: string;
  feeYuan: string;
  refundYuan: string;
  payableYuan: string;
}

interface ChangePreviewData {
  toScheduleId: number;
  toTrainNo: string;
  toRunDate: string;
  toDepartTime: string;
  toSeatClass: string;
  targetAvailable: number;
  list: ChangePreviewItem[];
  totalPayableCents: number;
  totalRefundCents: number;
  totalFeeCents: number;
}

interface ChangeSubmitData {
  changeNos: string[];
  newOrderNo: string;
  totalPayableCents: number;
  totalRefundCents: number;
  providerMessage: string;
}

/* ── 常量 ─────────────────────────────────────────────────── */

const MAX_DAYS = 14;

const DIFF_LABEL: Record<string, string> = {
  PAY: '补收差价',
  REFUND: '退还差价',
  NONE: '无差价',
};

const DIFF_TONE: Record<string, string> = {
  PAY: 'bg-amber-50 text-amber-700',
  REFUND: 'bg-emerald-50 text-emerald-700',
  NONE: 'bg-slate-100 text-slate-600',
};

/* ── 页面 ─────────────────────────────────────────────────── */

export default function ChangeTicket() {
  const { orderNo = '' } = useParams<{ orderNo: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [order, setOrder] = useState<OrderDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [targetDate, setTargetDate] = useState('');
  const [trains, setTrains] = useState<TrainSearchItem[]>([]);
  const [trainLoading, setTrainLoading] = useState(false);
  const [trainError, setTrainError] = useState('');
  const [trainReloadKey, setTrainReloadKey] = useState(0);
  const [targetScheduleId, setTargetScheduleId] = useState<number | null>(null);
  const [targetSeatClass, setTargetSeatClass] = useState('');

  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [preview, setPreview] = useState<ChangePreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [successOrderNo, setSuccessOrderNo] = useState('');

  const searchReqRef = useRef(0);
  const previewReqRef = useRef(0);

  const todayStr = today();
  const maxDate = addDays(todayStr, MAX_DAYS - 1);

  /* 订单详情 */
  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get<OrderDetailData>(`/orders/${encodeURIComponent(orderNo)}`);
      setOrder(d);
      const initialDate = d.train.runDate >= todayStr && d.train.runDate <= maxDate ? d.train.runDate : todayStr;
      setTargetDate(initialDate);
      const changeable = d.items.filter((i) => i.ticketStatus === 'TICKETED' && i.changeCount < 1);
      setSelectedIds(changeable.map((i) => i.id));
      setTargetSeatClass(changeable[0]?.seatClass ?? '');
    } catch (e: unknown) {
      setOrder(null);
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '订单加载失败');
    } finally {
      setLoading(false);
    }
  }, [orderNo, todayStr, maxDate]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  const changeableItems = useMemo(
    () => (order ? order.items.filter((i) => i.ticketStatus === 'TICKETED' && i.changeCount < 1) : []),
    [order],
  );
  const blockedItems = useMemo(
    () => (order ? order.items.filter((i) => !(i.ticketStatus === 'TICKETED' && i.changeCount < 1)) : []),
    [order],
  );

  const blockReason = (it: OrderItemView): string => {
    if (it.changeCount >= 1) return '该车票已改签过一次，每张车票仅可改签一次';
    if (it.ticketStatus === 'LOCKED') return '订单尚未支付，车票未出票，无法改签';
    if (it.ticketStatus === 'REFUNDING') return '该车票正在退票中，无法改签';
    if (it.ticketStatus === 'REFUNDED') return '该车票已退票，无法改签';
    if (it.ticketStatus === 'CHANGED') return '该车票已改签，无法再次改签';
    if (it.ticketStatus === 'CANCELLED') return '该车票已取消，无法改签';
    return `当前状态「${it.ticketStatusText}」不可改签`;
  };

  /* 查询目标车次 */
  useEffect(() => {
    if (!order || !targetDate || changeableItems.length === 0) return undefined;
    const id = searchReqRef.current + 1;
    searchReqRef.current = id;
    setTrainLoading(true);
    setTrainError('');
    api
      .get<SearchData>(
        `/trains/search${qs({ from: order.train.fromStation, to: order.train.toStation, date: targetDate })}`,
      )
      .then((d) => {
        if (searchReqRef.current !== id) return;
        setTrains(d.list ?? []);
      })
      .catch((e: unknown) => {
        if (searchReqRef.current !== id) return;
        setTrains([]);
        setTrainError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '车次查询失败');
      })
      .finally(() => {
        if (searchReqRef.current === id) setTrainLoading(false);
      });
    return undefined;
  }, [order, targetDate, changeableItems.length, trainReloadKey]);

  /* 车次列表变化后校正选中的车次与席别 */
  useEffect(() => {
    if (trains.length === 0) {
      setTargetScheduleId(null);
      return;
    }
    const exists = trains.some((t) => t.scheduleId === targetScheduleId && t.purchasable);
    if (!exists) {
      const first = trains.find((t) => t.purchasable) ?? null;
      setTargetScheduleId(first ? first.scheduleId : null);
      if (first && !first.seats.some((s) => s.seatClass === targetSeatClass)) {
        const preferred = first.seats.find((s) => s.available > 0) ?? first.seats[0] ?? null;
        setTargetSeatClass(preferred ? preferred.seatClass : '');
      }
    }
  }, [trains, targetScheduleId, targetSeatClass]);

  const selectedTrain = useMemo(() => trains.find((t) => t.scheduleId === targetScheduleId) ?? null, [trains, targetScheduleId]);

  /* 换乘席别可用性：切换车次时若席别不存在则自动回退 */
  useEffect(() => {
    if (!selectedTrain) return;
    if (targetSeatClass && selectedTrain.seats.some((s) => s.seatClass === targetSeatClass)) return;
    const preferred = selectedTrain.seats.find((s) => s.available > 0) ?? selectedTrain.seats[0] ?? null;
    setTargetSeatClass(preferred ? preferred.seatClass : '');
  }, [selectedTrain, targetSeatClass]);

  const canPreview = selectedIds.length > 0 && targetScheduleId !== null && targetSeatClass !== '';

  /* 差价试算 */
  useEffect(() => {
    if (!canPreview || targetScheduleId === null) {
      setPreview(null);
      setPreviewError('');
      return undefined;
    }
    const id = previewReqRef.current + 1;
    previewReqRef.current = id;
    setPreviewLoading(true);
    setPreviewError('');
    api
      .post<ChangePreviewData>('/changes/preview', {
        orderItemIds: selectedIds,
        toScheduleId: targetScheduleId,
        toSeatClass: targetSeatClass,
      })
      .then((d) => {
        if (previewReqRef.current === id) setPreview(d);
      })
      .catch((e: unknown) => {
        if (previewReqRef.current !== id) return;
        setPreview(null);
        setPreviewError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '差价试算失败');
      })
      .finally(() => {
        if (previewReqRef.current === id) setPreviewLoading(false);
      });
    return undefined;
  }, [canPreview, selectedIds, targetScheduleId, targetSeatClass]);

  const toggleItem = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const overCapacity = preview !== null && preview.targetAvailable < selectedIds.length;
  const canSubmit =
    canPreview && preview !== null && preview.list.length > 0 && !overCapacity && !previewLoading && !submitting;

  const submit = async () => {
    if (!canSubmit || targetScheduleId === null) return;
    setSubmitting(true);
    try {
      const r = await api.post<ChangeSubmitData>('/changes', {
        orderItemIds: selectedIds,
        toScheduleId: targetScheduleId,
        toSeatClass: targetSeatClass,
      });
      setSuccessOrderNo(r.newOrderNo);
      toast.success(r.totalPayableCents > 0 ? `改签成功，已补收差价 ${money(r.totalPayableCents)}` : '改签成功');
      await loadOrder();
    } catch (e: unknown) {
      toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '改签失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <Spinner label="正在加载订单信息…" />
      </div>
    );
  }

  if (error || !order) {
    return <ErrorBox message={error || '订单不存在'} onRetry={() => void loadOrder()} />;
  }

  return (
    <div className="space-y-5 pb-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg">
            车票改签
            <span className="ml-2 text-sm font-normal text-[var(--fg-muted)] tnum">{order.orderNo}</span>
          </h1>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            原车次 <span className="tnum">{order.train.trainNo}</span> {order.train.fromStation} → {order.train.toStation} ·{' '}
            {order.train.runDate}（{weekday(order.train.runDate)}） {order.train.departTime} 开
          </p>
        </div>
        <Link to={`/orders/${order.orderNo}`} className="btn-sm btn-ghost">
          返回订单详情
        </Link>
      </div>

      {changeableItems.length === 0 ? (
        <div className="card">
          <Empty
            title="没有可改签的车票"
            hint="仅「已出票」且未改签过的车票可以办理改签；已改签、已退票或未支付的车票不可改签。"
            action={
              <Link to={`/orders/${order.orderNo}`} className="btn-primary">
                返回订单详情
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {/* 选择车票 */}
          <section className="card">
            <h2 className="px-5 py-4 text-base border-b border-[var(--border)]">选择待改签车票</h2>
            <ul className="divide-y divide-slate-100">
              {changeableItems.map((it) => (
                <li key={it.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <input
                    id={`chg-${it.id}`}
                    type="checkbox"
                    className="w-4 h-4 accent-brand-600"
                    checked={selectedIds.includes(it.id)}
                    onChange={() => toggleItem(it.id)}
                  />
                  <label htmlFor={`chg-${it.id}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                      {it.passengerName}
                      <Tag className={seatClassStyle(it.seatClass)}>{it.seatClassLabel}</Tag>
                      <span className="text-xs font-normal text-slate-500">{it.ticketTypeLabel}</span>
                      <span className="text-xs font-normal text-slate-500 tnum">{it.seatNo}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--fg-muted)] tnum">
                      {it.idCardMasked} · 原票价 {money(it.priceCents)}
                    </span>
                  </label>
                </li>
              ))}
              {blockedItems.map((it) => (
                <li key={it.id} className="flex flex-wrap items-center gap-3 px-5 py-3 opacity-60">
                  <span className="w-4 h-4" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                      {it.passengerName}
                      <Tag className={seatClassStyle(it.seatClass)}>{it.seatClassLabel}</Tag>
                      <Tag className="bg-slate-100 text-slate-600">{it.ticketStatusText}</Tag>
                    </span>
                    <span className="mt-0.5 block text-xs text-red-600">{blockReason(it)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* 选择目标车次 */}
          <section className="card">
            <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
              <h2 className="text-base">选择目标车次</h2>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <label className="text-xs text-[var(--fg-muted)]" htmlFor="change-date">
                  目标日期
                </label>
                <input
                  id="change-date"
                  type="date"
                  className="input w-[10.5rem] h-9"
                  value={targetDate}
                  min={todayStr}
                  max={maxDate}
                  onChange={(e) => {
                    if (e.target.value) setTargetDate(e.target.value);
                  }}
                />
                {[0, 1, 2].map((offset) => {
                  const value = addDays(todayStr, offset);
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={targetDate === value}
                      className={cn('btn-sm h-9', targetDate === value ? 'btn-primary' : 'btn-ghost')}
                      onClick={() => setTargetDate(value)}
                    >
                      {offset === 0 ? '今天' : offset === 1 ? '明天' : '后天'}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-5 py-4">
              <p className="text-xs text-[var(--fg-muted)]">
                查询区间：{order.train.fromStation} → {order.train.toStation} · {targetDate}（{weekday(targetDate)}） · 可改签日期范围{' '}
                {todayStr} ~ {maxDate}
              </p>

              {trainLoading ? (
                <Spinner label="正在查询目标车次…" />
              ) : trainError ? (
                <div className="mt-3">
                  <ErrorBox message={trainError} onRetry={() => setTrainReloadKey((k) => k + 1)} />
                </div>
              ) : trains.length === 0 ? (
                <Empty title="该日期无可改签车次" hint="可尝试切换其它日期，或联系售票窗口办理。" />
              ) : (
                <ul className="mt-3 space-y-2">
                  {trains.map((t) => {
                    const active = t.scheduleId === targetScheduleId;
                    return (
                      <li key={t.scheduleId}>
                        <button
                          type="button"
                          aria-pressed={active}
                          disabled={!t.purchasable}
                          className={cn(
                            'w-full text-left rounded-xl border px-4 py-3 transition-colors',
                            active ? 'border-brand-500 bg-brand-50/60' : 'border-[var(--border)] hover:bg-slate-50',
                            !t.purchasable && 'opacity-50 cursor-not-allowed',
                          )}
                          onClick={() => setTargetScheduleId(t.scheduleId)}
                        >
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <span className="text-base font-semibold tnum">{t.trainNo}</span>
                            <span
                              className={cn(
                                'badge',
                                t.scheduleStatus === 'CANCELLED'
                                  ? 'bg-slate-200 text-slate-600'
                                  : t.scheduleStatus === 'DELAYED'
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-emerald-50 text-emerald-700',
                              )}
                            >
                              {t.scheduleStatusText}
                            </span>
                            <span className="text-sm text-slate-700 tnum">
                              {t.departTime} 开 → {t.arriveTime} 到
                            </span>
                            <span className="text-xs text-[var(--fg-muted)]">历时 {t.durationText}</span>
                            <span className="ml-auto text-sm font-medium tnum text-slate-900">
                              最低 {money(t.minPriceCents)}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {t.seats.map((s) => (
                              <span key={s.seatClass} className={cn('badge', seatClassStyle(s.seatClass))}>
                                {s.seatClassLabel} · {s.availableText}
                              </span>
                            ))}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {selectedTrain && (
              <div className="px-5 pb-4">
                <label className="label" htmlFor="change-seat">
                  目标席别
                </label>
                <select
                  id="change-seat"
                  className="input max-w-xs"
                  value={targetSeatClass}
                  onChange={(e) => setTargetSeatClass(e.target.value)}
                >
                  <option value="">请选择席别</option>
                  {selectedTrain.seats.map((s) => (
                    <option key={s.seatClass} value={s.seatClass}>
                      {s.seatClassLabel}（余票 {s.availableText}，{money(s.priceCents)} 起）
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>

          {/* 差价试算 */}
          <section className="card">
            <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
              <h2 className="text-base">差价试算</h2>
              {preview && (
                <span className="text-xs text-[var(--fg-muted)]">
                  目标：{preview.toTrainNo} · {preview.toRunDate} {preview.toDepartTime} 开 · 余票 {preview.targetAvailable} 张
                </span>
              )}
            </div>

            {!canPreview ? (
              <Empty title="请先选择车票、目标车次与席别" hint="选择完成后系统会自动试算差价。" />
            ) : previewLoading ? (
              <Spinner label="正在试算差价…" />
            ) : previewError ? (
              <div className="p-5">
                <ErrorBox message={previewError} />
              </div>
            ) : !preview || preview.list.length === 0 ? (
              <Empty title="暂无试算结果" hint="请调整目标车次或席别后重试。" />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[48rem] border-collapse">
                    <thead>
                      <tr>
                        <th className="th">乘车人</th>
                        <th className="th">席别变更</th>
                        <th className="th text-right">原价</th>
                        <th className="th text-right">新价</th>
                        <th className="th text-right">差价</th>
                        <th className="th">处理方式</th>
                        <th className="th text-right">退差手续费</th>
                        <th className="th text-right">实退 / 补收</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.list.map((p) => (
                        <tr key={p.orderItemId}>
                          <td className="td font-medium text-slate-800">{p.passengerName}</td>
                          <td className="td text-xs text-slate-600">
                            {seatLabel(p.fromSeatClass)} → {seatLabel(p.toSeatClass)}
                          </td>
                          <td className="td text-right tnum">{money(p.fromPriceCents)}</td>
                          <td className="td text-right tnum">{money(p.toPriceCents)}</td>
                          <td className="td text-right tnum">{money(p.diffCents)}</td>
                          <td className="td">
                            <Tag className={DIFF_TONE[p.diffType] ?? DIFF_TONE.NONE}>{DIFF_LABEL[p.diffType] ?? p.diffType}</Tag>
                          </td>
                          <td className="td text-right tnum text-amber-700">
                            {p.diffType === 'REFUND' ? money(p.feeCents) : '--'}
                          </td>
                          <td className="td text-right tnum">
                            {p.diffType === 'PAY' ? (
                              <span className="text-amber-700">补收 {money(p.payableCents)}</span>
                            ) : p.diffType === 'REFUND' ? (
                              <span className="text-emerald-600">退还 {money(p.refundCents)}</span>
                            ) : (
                              <span className="text-slate-500">无差价</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="px-5 py-4 border-t border-[var(--border)] flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <span className="text-slate-600">
                    合计退差手续费 <span className="tnum font-medium text-amber-700">{money(preview.totalFeeCents)}</span>
                  </span>
                  <span className="text-slate-600">
                    合计补收 <span className="tnum font-medium text-amber-700">{money(preview.totalPayableCents)}</span>
                  </span>
                  <span className="text-slate-600">
                    合计退还 <span className="tnum font-medium text-emerald-600">{money(preview.totalRefundCents)}</span>
                  </span>
                  {overCapacity && (
                    <span className="text-xs text-red-600" role="alert">
                      目标席别余票不足（剩余 {preview.targetAvailable} 张），请减少改签张数或更换席别。
                    </span>
                  )}
                </div>
              </>
            )}
          </section>

          {/* 提交栏 */}
          <div className="sticky bottom-14 md:bottom-0 z-30 card px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="text-sm text-slate-600">
                改签 <span className="tnum font-medium text-slate-900">{selectedIds.length}</span> 张
              </span>
              <span className="text-sm text-slate-600">
                {preview && preview.totalRefundCents > 0 ? (
                  <>
                    应退 <span className="text-lg font-semibold tnum text-emerald-600">{money(preview.totalRefundCents)}</span>
                  </>
                ) : (
                  <>
                    应补 <span className="text-lg font-semibold tnum text-brand-700">{money(preview?.totalPayableCents ?? 0)}</span>
                  </>
                )}
              </span>
              <span className="text-xs text-[var(--fg-muted)]">差价由 Mock 银行即时结算</span>
              <button type="button" className="ml-auto btn-primary min-w-[7.5rem]" disabled={!canSubmit} onClick={() => void submit()}>
                {submitting ? '提交中…' : '确认改签'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* 改签成功 */}
      <Modal
        open={successOrderNo !== ''}
        title="改签成功"
        width="max-w-md"
        onClose={() => setSuccessOrderNo('')}
        footer={
          <>
            <Link to="/orders" className="btn-ghost">
              返回我的订单
            </Link>
            <button type="button" className="btn-primary" onClick={() => navigate(`/orders/${successOrderNo}`)}>
              查看新订单
            </button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-slate-700">
          <p>改签已完成，系统已生成新的订单：</p>
          <p className="text-base font-semibold tnum text-brand-700">{successOrderNo}</p>
          <p className="text-xs text-[var(--fg-muted)]">
            原订单中的车票状态已变更为「已改签」，可在新订单中查看新车次、新座位与电子车票信息。
          </p>
        </div>
      </Modal>
    </div>
  );
}

/* ── 工具 ─────────────────────────────────────────────────── */

const SEAT_LABEL: Record<string, string> = {
  BUSINESS: '商务座',
  FIRST: '一等座',
  SECOND: '二等座',
  SOFT_SLEEPER: '软卧',
  HARD_SLEEPER: '硬卧',
  HARD_SEAT: '硬座',
  STANDING: '无座',
};

function seatLabel(seatClass: string): string {
  return SEAT_LABEL[seatClass] ?? seatClass;
}
