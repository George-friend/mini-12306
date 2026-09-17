/** 支付页：Mock 银行收银台、倒计时与支付结果轮询 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { countdown, dateTime, money, today } from '../lib/format';
import { cn } from '../lib/cn';
import { ErrorBox, Spinner, useToast } from '../components/ui';

/* ── 接口类型 ─────────────────────────────────────────────── */

interface OrderItem {
  id: number;
  passengerName: string;
  idCardMasked: string;
  seatClassLabel: string;
  ticketTypeLabel: string;
  priceCents: number;
  seatNo: string;
  ticketStatus: string;
  ticketStatusText: string;
}

interface PaymentRecord {
  paymentNo: string;
  type: string;
  amountCents: number;
  method: string;
  status: string;
  statusText: string;
  tradeNo: string | null;
  paidAt: string | null;
  failReason: string | null;
  createdAt: string;
}

interface OrderView {
  orderNo: string;
  channel: string;
  status: string;
  statusText: string;
  passengerCount: number;
  totalAmountCents: number;
  paidAmountCents: number;
  expireAt: string;
  paidAt: string | null;
  createdAt: string;
  canPay: boolean;
  canCancel: boolean;
  canRefund: boolean;
  remark: string | null;
  train: {
    trainNo: string;
    trainType: string;
    fromStation: string;
    toStation: string;
    runDate: string;
    departTime: string;
    arriveTime: string;
    departDateTimeText: string;
    scheduleStatusText: string;
  };
  items: OrderItem[];
  payments: PaymentRecord[];
}

interface PayCreateData {
  outTradeNo: string;
  tradeNo: string;
  payUrl: string;
  amountCents: number;
  amountYuan: string;
  expireAt: string;
}

interface PaymentStatusData {
  orderNo: string;
  orderStatus: string;
  expired: boolean;
  expireAt: string;
  payment: {
    paymentNo: string;
    outTradeNo: string;
    status: string;
    amountCents: number;
    tradeNo: string | null;
    paidAt: string | null;
    failReason: string | null;
  } | null;
}

interface SimulateData {
  callback: { code: number; message: string; data: unknown };
  order: OrderView;
}

/* ── 页面 ─────────────────────────────────────────────────── */

export default function Pay() {
  const { orderNo = '' } = useParams<{ orderNo: string }>();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [order, setOrder] = useState<OrderView | null>(null);
  const [payData, setPayData] = useState<PayCreateData | null>(null);
  const [payStatus, setPayStatus] = useState<PaymentStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [simulating, setSimulating] = useState<'' | 'SUCCESS' | 'FAILED'>('');
  const [polling, setPolling] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const payDataRef = useRef<PayCreateData | null>(null);

  const applyPayData = useCallback((d: PayCreateData | null) => {
    payDataRef.current = d;
    setPayData(d);
  }, []);

  /* 订单详情 */
  const loadOrder = useCallback(async () => {
    if (!orderNo) return;
    try {
      const d = await api.get<OrderView>(`/orders/${encodeURIComponent(orderNo)}`);
      setOrder(d);
      setError('');
      setPolling(d.status === 'PENDING_PAYMENT' && new Date(d.expireAt).getTime() > Date.now());
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '订单加载失败');
    } finally {
      setLoading(false);
    }
  }, [orderNo]);

  useEffect(() => {
    setLoading(true);
    void loadOrder();
  }, [loadOrder]);

  /* 每秒刷新倒计时 */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* 预创建支付单（Mock 银行侧需要支付单才能模拟回调） */
  const ensurePayment = useCallback(
    async (silent: boolean): Promise<PayCreateData | null> => {
      if (payDataRef.current) return payDataRef.current;
      try {
        const d = await api.post<PayCreateData>(`/orders/${encodeURIComponent(orderNo)}/pay`);
        applyPayData(d);
        return d;
      } catch (e: unknown) {
        if (!silent) {
          toastRef.current.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '支付单创建失败');
        }
        return null;
      }
    },
    [orderNo, applyPayData],
  );

  useEffect(() => {
    if (!order || !order.canPay) return;
    void ensurePayment(true);
  }, [order, ensurePayment]);

  /* 每 2 秒轮询支付状态，PAID 后停止 */
  useEffect(() => {
    if (!polling || !orderNo) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await api.get<PaymentStatusData>(`/payments/${encodeURIComponent(orderNo)}`);
        if (cancelled) return;
        setPayStatus(d);
        if (d.orderStatus === 'PAID') {
          setPolling(false);
          toastRef.current.success('支付成功，车票已出票');
          void loadOrder();
        } else if (d.expired || d.orderStatus !== 'PENDING_PAYMENT') {
          setPolling(false);
          void loadOrder();
        }
      } catch {
        /* 轮询失败静默重试，不打断页面 */
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [polling, orderNo, loadOrder]);

  /* 打开 Mock 银行收银台 */
  const openCashier = async () => {
    if (payDataRef.current) {
      window.open(payDataRef.current.payUrl, '_blank', 'noopener');
      return;
    }
    setCreating(true);
    try {
      const d = await ensurePayment(false);
      if (d) window.open(d.payUrl, '_blank', 'noopener');
    } finally {
      setCreating(false);
    }
  };

  /* 演示：模拟支付结果 */
  const simulate = async (action: 'SUCCESS' | 'FAILED') => {
    setSimulating(action);
    try {
      const pay = await ensurePayment(false);
      if (!pay) return;
      const r = await api.post<SimulateData>(`/payments/${encodeURIComponent(orderNo)}/simulate`, { action });
      if (action === 'SUCCESS') {
        toastRef.current.success(r.callback?.message || '支付成功，车票已出票');
      } else {
        toastRef.current.error(r.callback?.message || '支付失败已记录');
      }
      await loadOrder();
      const s = await api.get<PaymentStatusData>(`/payments/${encodeURIComponent(orderNo)}`);
      setPayStatus(s);
    } catch (e: unknown) {
      toastRef.current.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '模拟支付失败');
    } finally {
      setSimulating('');
    }
  };

  if (loading) {
    return (
      <div className="card">
        <Spinner label="正在加载订单…" />
      </div>
    );
  }

  if (error || !order) {
    return <ErrorBox message={error || '订单不存在'} onRetry={() => void loadOrder()} />;
  }

  const expireMs = new Date(order.expireAt).getTime();
  const expired = order.status === 'PENDING_PAYMENT' && (expireMs <= now || payStatus?.expired === true);
  const paid = order.status === 'PAID';

  /* 支付成功态 */
  if (paid) {
    return (
      <div className="space-y-5">
        <section className="card p-6 sm:p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-2xl">✓</div>
          <h1 className="mt-4 text-xl">支付成功，车票已出票</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            订单号 <span className="tnum">{order.orderNo}</span>
            {order.paidAt ? ` · 支付时间 ${dateTime(order.paidAt)}` : ''}
          </p>
          <p className="mt-5 text-3xl font-semibold tnum text-brand-700">{money(order.paidAmountCents || order.totalAmountCents)}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to={`/orders/${order.orderNo}`} className="btn-primary">
              查看订单详情
            </Link>
            <Link to="/orders" className="btn-ghost">
              返回我的订单
            </Link>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-base mb-3">出票信息</h2>
          <ul className="divide-y divide-slate-100">
            {order.items.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-medium text-slate-800">{it.passengerName}</span>
                <span className="text-xs text-[var(--fg-muted)] tnum">{it.idCardMasked}</span>
                <span className="badge bg-slate-100 text-slate-600">{it.seatClassLabel}</span>
                <span className="badge bg-slate-100 text-slate-600">{it.ticketTypeLabel}</span>
                <span className="ml-auto text-slate-700 tnum">{it.seatNo}</span>
                <span className="text-slate-900 tnum">{money(it.priceCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  /* 超时态 */
  if (expired) {
    const reorderDate = order.train.runDate >= today() ? order.train.runDate : today();
    return (
      <div className="space-y-5">
        <section className="card p-6 sm:p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-2xl">!</div>
          <h1 className="mt-4 text-xl">订单已超时关闭</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            订单号 <span className="tnum">{order.orderNo}</span> · 超过支付时限（{dateTime(order.expireAt)}），锁定的座位已释放。
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to={`/trains?from=${encodeURIComponent(order.train.fromStation)}&to=${encodeURIComponent(order.train.toStation)}&date=${reorderDate}`}
              className="btn-primary"
            >
              重新选择车次下单
            </Link>
            <Link to="/orders" className="btn-ghost">
              返回我的订单
            </Link>
          </div>
        </section>
      </div>
    );
  }

  /* 其它不可支付状态 */
  if (order.status !== 'PENDING_PAYMENT') {
    return (
      <div className="space-y-5">
        <section className="card p-6 sm:p-8 text-center">
          <h1 className="text-xl">订单当前状态：{order.statusText}</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            订单号 <span className="tnum">{order.orderNo}</span>，该订单无需继续支付。
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to={`/orders/${order.orderNo}`} className="btn-primary">
              查看订单详情
            </Link>
            <Link to="/orders" className="btn-ghost">
              返回我的订单
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const latestPayment = payStatus?.payment ?? order.payments[order.payments.length - 1] ?? null;

  return (
    <div className="space-y-5">
      <h1 className="text-lg">订单支付</h1>

      {/* 金额与倒计时 */}
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs text-[var(--fg-muted)]">应付金额</div>
            <div className="mt-1 text-3xl font-semibold tnum text-brand-700">{money(order.totalAmountCents)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[var(--fg-muted)]">支付剩余时间</div>
            <div className="mt-1 text-xl font-semibold tnum text-amber-600" role="timer" aria-live="off">
              {countdown(order.expireAt)}
            </div>
            <div className="text-xs text-slate-400 tnum">截止 {dateTime(order.expireAt)}</div>
          </div>
        </div>
        <div className="mt-4 h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden>
          <div
            className="h-full bg-brand-600 transition-[width] duration-1000"
            style={{ width: `${progressPercent(order.createdAt, order.expireAt, now)}%` }}
          />
        </div>
      </section>

      {/* 订单摘要 */}
      <section className="card">
        <h2 className="px-5 py-4 text-base border-b border-[var(--border)]">订单摘要</h2>
        <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2">
          <SummaryItem label="订单号" value={<span className="tnum">{order.orderNo}</span>} />
          <SummaryItem
            label="车次"
            value={
              <span>
                <span className="tnum">{order.train.trainNo}</span> {order.train.fromStation} → {order.train.toStation}
              </span>
            }
          />
          <SummaryItem
            label="乘车日期与时刻"
            value={<span className="tnum">{order.train.runDate} {order.train.departTime} 开 · {order.train.arriveTime} 到</span>}
          />
          <SummaryItem label="席别与人数" value={<span>{order.items[0]?.seatClassLabel ?? '--'} · {order.passengerCount} 人</span>} />
          <SummaryItem
            label="乘车人"
            value={<span>{order.items.map((i) => i.passengerName).join('、') || '--'}</span>}
          />
          <SummaryItem label="下单时间" value={<span className="tnum">{dateTime(order.createdAt)}</span>} />
        </dl>
      </section>

      {/* 支付操作 */}
      <section className="card p-5">
        <h2 className="text-base">支付方式</h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)] leading-relaxed">
          本系统对接本地 Mock 银行通道：点击下方按钮打开 Mock 银行收银台，在收银台内选择「支付成功 / 支付失败」，
          银行会以 HMAC-SHA256 签名异步回调商户服务端完成结算，页面每 2 秒轮询一次支付结果。
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className="btn-primary" disabled={creating} onClick={() => void openCashier()}>
            {creating ? '正在创建支付单…' : '前往 Mock 银行收银台'}
          </button>
          <button type="button" className="btn-ghost" disabled={simulating !== ''} onClick={() => void simulate('SUCCESS')}>
            {simulating === 'SUCCESS' ? '处理中…' : '模拟支付成功'}
          </button>
          <button type="button" className="btn-danger" disabled={simulating !== ''} onClick={() => void simulate('FAILED')}>
            {simulating === 'FAILED' ? '处理中…' : '模拟支付失败'}
          </button>
          <Link to={`/orders/${order.orderNo}`} className="btn-ghost">
            订单详情
          </Link>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-1">
          <p>
            商户单号：
            <span className="tnum">{payStatus?.payment?.outTradeNo ?? payData?.outTradeNo ?? '尚未创建'}</span>
          </p>
          <p>
            支付单状态：
            <span className={cn('badge ml-1', latestPayment?.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
              {latestPayment?.status ?? '未创建'}
            </span>
            {polling && <span className="ml-2 text-slate-400">轮询中…</span>}
          </p>
          {latestPayment?.failReason && <p className="text-red-600">失败原因：{latestPayment.failReason}</p>}
        </div>
      </section>
    </div>
  );
}

/* ── 局部小组件与工具 ─────────────────────────────────────── */

function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--fg-muted)]">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
    </div>
  );
}

/** 支付剩余时间进度（0-100） */
function progressPercent(createdAt: string, expireAt: string, now: number): number {
  const start = new Date(createdAt).getTime();
  const end = new Date(expireAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const ratio = (end - now) / (end - start);
  return Math.max(0, Math.min(100, ratio * 100));
}
