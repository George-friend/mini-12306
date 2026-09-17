/** 我的订单：状态分页筛选、订单卡片与常用操作 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, qs } from '../lib/api';
import { dateTime, money, orderStatusTone, weekday } from '../lib/format';
import { cn } from '../lib/cn';
import { ConfirmModal, Empty, ErrorBox, Pagination, Spinner, Tag, useToast } from '../components/ui';

/* ── 接口类型 ─────────────────────────────────────────────── */

interface OrderItem {
  id: number;
  passengerName: string;
  idCardMasked: string;
  seatClassLabel: string;
  ticketTypeLabel: string;
  seatNo: string;
  priceCents: number;
  ticketStatusText: string;
}

interface OrderSummary {
  orderNo: string;
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
    scheduleStatus: string;
    scheduleStatusText: string;
  };
  items: OrderItem[];
}

interface OrderListData {
  total: number;
  page: number;
  pageSize: number;
  list: OrderSummary[];
}

/* ── 常量 ─────────────────────────────────────────────────── */

const TABS = [
  { value: '', label: '全部' },
  { value: 'PENDING_PAYMENT', label: '待支付' },
  { value: 'PAID', label: '已支付' },
  { value: 'REFUNDED', label: '已退票' },
  { value: 'CHANGED', label: '已改签' },
  { value: 'CANCELLED', label: '已取消' },
];

const PAGE_SIZE = 10;

/* ── 页面 ─────────────────────────────────────────────────── */

export default function Orders() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const status = searchParams.get('status') ?? '';
  const page = Math.max(Number(searchParams.get('page') ?? '1') || 1, 1);

  const [data, setData] = useState<OrderListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [cancelTarget, setCancelTarget] = useState<OrderSummary | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get<OrderListData>(`/orders${qs({ status, page, pageSize: PAGE_SIZE })}`);
      setData(d);
    } catch (e: unknown) {
      setData(null);
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '订单加载失败');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const switchTab = (value: string) => {
    const p = new URLSearchParams();
    if (value) p.set('status', value);
    setSearchParams(p);
  };

  const goPage = (p: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(p));
    setSearchParams(next);
  };

  const doCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.post(`/orders/${encodeURIComponent(cancelTarget.orderNo)}/cancel`);
      toast.success('订单已取消，锁定座位已释放');
      setCancelTarget(null);
      setReloadKey((k) => k + 1);
    } catch (e: unknown) {
      toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '取消失败');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg">我的订单</h1>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">共 {data?.total ?? 0} 笔订单，可按状态筛选并查看详情。</p>
        </div>
        <Link to="/" className="btn-sm btn-ghost">
          继续购票
        </Link>
      </div>

      {/* 状态 tab */}
      <div className="card p-1.5">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="订单状态">
          {TABS.map((t) => {
            const active = status === t.value;
            return (
              <button
                key={t.value || 'all'}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  'whitespace-nowrap px-4 h-9 rounded-lg text-sm transition-colors',
                  active ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-600 hover:bg-slate-100',
                )}
                onClick={() => switchTab(t.value)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="card">
          <Spinner label="正在加载订单…" />
        </div>
      ) : error ? (
        <ErrorBox message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !data || data.list.length === 0 ? (
        <div className="card">
          <Empty
            title={status ? '该状态下暂无订单' : '还没有订单'}
            hint="可以先在首页查询车次，选择席别后提交订单。"
            action={
              <Link to="/" className="btn-primary">
                去查询车次
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <ul className="space-y-4">
            {data.list.map((o) => (
              <li key={o.orderNo}>
                <article className="card p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="text-xs text-[var(--fg-muted)]">
                      订单号 <span className="tnum text-slate-700">{o.orderNo}</span>
                    </span>
                    <span className="text-xs text-[var(--fg-muted)] tnum">下单 {dateTime(o.createdAt)}</span>
                    <Tag className={cn('ml-auto', orderStatusTone(o.status))}>{o.statusText}</Tag>
                  </div>

                  <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold tnum">{o.train.trainNo}</span>
                        <span className="text-sm text-slate-700">
                          {o.train.fromStation} <span className="text-slate-300">→</span> {o.train.toStation}
                        </span>
                        {o.train.scheduleStatus !== 'NORMAL' && (
                          <Tag className={o.train.scheduleStatus === 'CANCELLED' ? 'bg-slate-200 text-slate-600' : 'bg-amber-50 text-amber-700'}>
                            {o.train.scheduleStatusText}
                          </Tag>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-600 tnum">
                        {o.train.runDate}（{weekday(o.train.runDate)}） {o.train.departTime} 开 · {o.train.arriveTime} 到
                      </p>
                      <p className="mt-1 text-xs text-[var(--fg-muted)]">
                        乘车人：{o.items.map((i) => `${i.passengerName}（${i.seatClassLabel} ${i.seatNo}）`).join('、') || '--'}
                      </p>
                    </div>

                    <div className="text-right">
                      <div className="text-xs text-[var(--fg-muted)]">{o.passengerCount} 张车票</div>
                      <div className="text-xl font-semibold tnum text-slate-900">{money(o.totalAmountCents)}</div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    {o.canPay && (
                      <Link to={`/order/pay/${o.orderNo}`} className="btn-sm btn-primary">
                        去支付
                      </Link>
                    )}
                    {o.canCancel && (
                      <button type="button" className="btn-sm btn-danger" onClick={() => setCancelTarget(o)}>
                        取消订单
                      </button>
                    )}
                    <Link to={`/orders/${o.orderNo}`} className="btn-sm btn-ghost">
                      查看详情
                    </Link>
                    {o.status === 'PENDING_PAYMENT' && !o.canPay && (
                      <span className="text-xs text-amber-600">已超过支付时限，订单将在刷新后自动关闭</span>
                    )}
                    {o.remark && <span className="ml-auto text-xs text-slate-400 truncate max-w-[18rem]">{o.remark}</span>}
                  </div>
                </article>
              </li>
            ))}
          </ul>

          <div className="card">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={goPage} />
          </div>
        </>
      )}

      <ConfirmModal
        open={cancelTarget !== null}
        title="取消订单"
        danger
        confirmText="确认取消"
        loading={cancelling}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => void doCancel()}
        content={
          <div className="space-y-2">
            <p>
              确认取消订单 <span className="tnum font-medium">{cancelTarget?.orderNo}</span>？
            </p>
            <p className="text-xs text-[var(--fg-muted)]">
              订单取消后锁定的座位将立即释放，需重新下单才能购票，此操作不可撤销。
            </p>
          </div>
        }
      />
    </div>
  );
}
