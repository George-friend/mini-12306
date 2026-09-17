/** 订单详情：状态金额、车次、车票、支付流水、退改记录与退票/改签操作 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, qs } from '../lib/api';
import {
  countdown,
  dateTime,
  money,
  orderStatusTone,
  seatClassStyle,
  ticketStatusTone,
  weekday,
} from '../lib/format';
import { cn } from '../lib/cn';
import { ConfirmModal, Empty, ErrorBox, Modal, Spinner, Tag, useToast } from '../components/ui';

/* ── 接口类型 ─────────────────────────────────────────────── */

interface RefundRecord {
  refundNo: string;
  feeCents: number;
  refundCents: number;
  status: string;
  createdAt: string;
}

interface OrderItemView {
  id: number;
  passengerId: number;
  passengerName: string;
  idCardMasked: string;
  seatClass: string;
  seatClassLabel: string;
  ticketType: string;
  ticketTypeLabel: string;
  priceCents: number;
  priceYuan: string;
  seatNo: string;
  ticketStatus: string;
  ticketStatusText: string;
  changeCount: number;
  refunds: RefundRecord[];
}

interface PaymentView {
  paymentNo: string;
  type: string;
  amountCents: number;
  amountYuan: string;
  method: string;
  status: string;
  statusText: string;
  tradeNo: string | null;
  paidAt: string | null;
  failReason: string | null;
  createdAt: string;
}

interface OrderDetailData {
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
  minutesToDepart: number;
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
    scheduleStatus: string;
    scheduleStatusText: string;
  };
  items: OrderItemView[];
  payments: PaymentView[];
}

interface RefundPreviewItem {
  orderItemId: number;
  orderNo: string;
  passengerName: string;
  seatClass: string;
  priceCents: number;
  priceYuan: string;
  departAt: string;
  hoursBeforeDepart: number;
  feeRateBp: number;
  feeRateText: string;
  feeCents: number;
  refundCents: number;
  feeYuan: string;
  refundYuan: string;
}

interface RefundPreviewData {
  list: RefundPreviewItem[];
  totalFeeCents: number;
  totalRefundCents: number;
}

interface RefundSubmitData {
  refundNos: string[];
  totalFeeCents: number;
  totalRefundCents: number;
  totalFeeYuan: string;
  totalRefundYuan: string;
  providerMessage: string;
}

/* ── 文案映射 ─────────────────────────────────────────────── */

const PAYMENT_TYPE_LABEL: Record<string, string> = {
  PAY: '支付',
  REFUND: '退款',
  CHANGE_DIFF: '改签差价',
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  MOCK_BANK: 'Mock 银行卡',
  CASH: '现金（售票窗口）',
  ALIPAY: '支付宝',
  WECHAT: '微信支付',
};

const REFUND_STATUS_LABEL: Record<string, string> = {
  APPLYING: '退款中',
  SUCCESS: '退款成功',
  FAILED: '退款失败',
};

const CHANNEL_LABEL: Record<string, string> = {
  WEB: '网页购票',
  APP: '手机客户端',
  CLERK: '售票窗口',
};

/* ── 页面 ─────────────────────────────────────────────────── */

export default function OrderDetail() {
  const { orderNo = '' } = useParams<{ orderNo: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [order, setOrder] = useState<OrderDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [refundConfirmOpen, setRefundConfirmOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<RefundPreviewData | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get<OrderDetailData>(`/orders/${encodeURIComponent(orderNo)}`);
      setOrder(d);
    } catch (e: unknown) {
      setOrder(null);
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '订单加载失败');
    } finally {
      setLoading(false);
    }
  }, [orderNo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refundableItems = order ? order.items.filter((i) => i.ticketStatus === 'TICKETED') : [];
  const changeableItems = refundableItems.filter((i) => i.changeCount < 1);

  const doCancel = async () => {
    if (!order) return;
    setCancelling(true);
    try {
      await api.post(`/orders/${encodeURIComponent(order.orderNo)}/cancel`);
      toast.success('订单已取消，锁定座位已释放');
      setCancelOpen(false);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '取消失败');
    } finally {
      setCancelling(false);
    }
  };

  /* 退票：二次确认 → 试算 → 预览确认 → 提交 */
  const startRefundPreview = async () => {
    setRefundConfirmOpen(false);
    if (refundableItems.length === 0) {
      toast.error('当前没有可退票的车票');
      return;
    }
    setRefundOpen(true);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const d = await api.get<RefundPreviewData>(
        `/refunds/preview${qs({ orderItemIds: refundableItems.map((i) => i.id).join(',') })}`,
      );
      setPreview(d);
    } catch (e: unknown) {
      toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '退票试算失败');
      setRefundOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const submitRefund = async () => {
    if (!order || refundableItems.length === 0) return;
    setRefunding(true);
    try {
      const r = await api.post<RefundSubmitData>('/refunds', {
        orderItemIds: refundableItems.map((i) => i.id),
        reason: refundReason.trim() || '用户申请退票',
      });
      toast.success(`退票成功，退款 ${money(r.totalRefundCents)} 已原路退回`);
      setRefundOpen(false);
      setPreview(null);
      setRefundReason('');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '退票失败');
    } finally {
      setRefunding(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <Spinner label="正在加载订单详情…" />
      </div>
    );
  }

  if (error || !order) {
    return <ErrorBox message={error || '订单不存在'} onRetry={() => void load()} />;
  }

  const expireLeft = new Date(order.expireAt).getTime() - now;
  const refundTone: Record<string, string> = {
    APPLYING: 'bg-sky-50 text-sky-700',
    SUCCESS: 'bg-emerald-50 text-emerald-700',
    FAILED: 'bg-red-50 text-red-700',
  };

  return (
    <div className="space-y-5">
      {/* 头部操作 */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg">
            订单详情
            <span className="ml-2 text-sm font-normal text-[var(--fg-muted)] tnum">{order.orderNo}</span>
          </h1>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            {CHANNEL_LABEL[order.channel] ?? order.channel} · 下单时间 {dateTime(order.createdAt)}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {order.canPay && (
            <Link to={`/order/pay/${order.orderNo}`} className="btn-sm btn-primary">
              去支付
            </Link>
          )}
          {order.canRefund && refundableItems.length > 0 && (
            <button type="button" className="btn-sm btn-ghost" onClick={() => setRefundConfirmOpen(true)}>
              退票
            </button>
          )}
          {order.status === 'PAID' || order.status === 'PARTIAL_REFUNDED' ? (
            <button
              type="button"
              className="btn-sm btn-ghost"
              disabled={changeableItems.length === 0}
              title={changeableItems.length === 0 ? '没有可改签的车票（已改签过或状态不可改签）' : undefined}
              onClick={() => navigate(`/change/${order.orderNo}`)}
            >
              改签
            </button>
          ) : null}
          {order.canCancel && (
            <button type="button" className="btn-sm btn-danger" onClick={() => setCancelOpen(true)}>
              取消订单
            </button>
          )}
          <button type="button" className="btn-sm btn-ghost" onClick={() => void load()}>
            刷新
          </button>
        </div>
      </div>

      {/* ① 订单状态与金额 */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div>
            <div className="text-xs text-[var(--fg-muted)]">订单状态</div>
            <Tag className={cn('mt-1.5', orderStatusTone(order.status))}>{order.statusText}</Tag>
          </div>
          <div>
            <div className="text-xs text-[var(--fg-muted)]">订单金额</div>
            <div className="mt-0.5 text-xl font-semibold tnum text-slate-900">{money(order.totalAmountCents)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--fg-muted)]">已支付金额</div>
            <div className="mt-0.5 text-xl font-semibold tnum text-emerald-600">{money(order.paidAmountCents)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--fg-muted)]">乘车人数</div>
            <div className="mt-0.5 text-xl font-semibold tnum text-slate-900">{order.passengerCount}</div>
          </div>
          {order.status === 'PENDING_PAYMENT' && (
            <div className="ml-auto text-right">
              <div className="text-xs text-[var(--fg-muted)]">支付剩余时间</div>
              <div className="mt-0.5 text-lg font-semibold tnum text-amber-600">
                {expireLeft > 0 ? countdown(order.expireAt) : '已超时'}
              </div>
            </div>
          )}
        </div>
        {order.remark && <p className="mt-4 text-xs text-[var(--fg-muted)] bg-slate-50 rounded-lg px-3 py-2">备注：{order.remark}</p>}
      </section>

      {/* ② 车次信息 */}
      <section className="card">
        <h2 className="px-5 py-4 text-base border-b border-[var(--border)]">车次信息</h2>
        <div className="px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold tnum">{order.train.trainNo}</span>
            <Tag
              className={
                order.train.scheduleStatus === 'CANCELLED'
                  ? 'bg-slate-200 text-slate-600'
                  : order.train.scheduleStatus === 'DELAYED'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-emerald-50 text-emerald-700'
              }
            >
              {order.train.scheduleStatusText}
            </Tag>
          </div>
          <div className="flex items-center gap-3">
            <div>
              <div className="text-lg font-semibold tnum">{order.train.departTime}</div>
              <div className="text-sm text-slate-600">{order.train.fromStation}</div>
            </div>
            <span className="text-slate-300">→</span>
            <div>
              <div className="text-lg font-semibold tnum">{order.train.arriveTime}</div>
              <div className="text-sm text-slate-600">{order.train.toStation}</div>
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--fg-muted)]">乘车日期</div>
            <div className="mt-0.5 text-sm tnum">
              {order.train.runDate}（{weekday(order.train.runDate)}）
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--fg-muted)]">发车时间</div>
            <div className="mt-0.5 text-sm tnum">{order.train.departDateTimeText}</div>
          </div>
          <div className="ml-auto text-xs text-[var(--fg-muted)]">
            距发车 <span className="tnum text-slate-700">{order.minutesToDepart}</span> 分钟
          </div>
        </div>
      </section>

      {/* ③ 车票列表 */}
      <section className="card">
        <h2 className="px-5 py-4 text-base border-b border-[var(--border)]">车票列表</h2>
        {order.items.length === 0 ? (
          <Empty title="该订单没有有效车票" hint="车票可能已全部退票或改签。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse">
              <thead>
                <tr>
                  <th className="th">乘车人</th>
                  <th className="th">证件号</th>
                  <th className="th">席别</th>
                  <th className="th">座位号</th>
                  <th className="th">票种</th>
                  <th className="th text-right">票价</th>
                  <th className="th">票状态</th>
                  <th className="th text-right">改签次数</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((it) => (
                  <tr key={it.id}>
                    <td className="td font-medium text-slate-800">{it.passengerName}</td>
                    <td className="td tnum text-slate-600">{it.idCardMasked}</td>
                    <td className="td">
                      <Tag className={seatClassStyle(it.seatClass)}>{it.seatClassLabel}</Tag>
                    </td>
                    <td className="td tnum">{it.seatNo}</td>
                    <td className="td text-slate-600">{it.ticketTypeLabel}</td>
                    <td className="td text-right tnum text-slate-900">{money(it.priceCents)}</td>
                    <td className="td">
                      <Tag className={ticketStatusTone(it.ticketStatus)}>{it.ticketStatusText}</Tag>
                    </td>
                    <td className="td text-right tnum text-slate-600">{it.changeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ④ 支付流水 */}
      <section className="card">
        <h2 className="px-5 py-4 text-base border-b border-[var(--border)]">支付流水</h2>
        {order.payments.length === 0 ? (
          <Empty title="暂无支付流水" hint="订单发起支付后，此处会显示支付与退款流水。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse">
              <thead>
                <tr>
                  <th className="th">流水号</th>
                  <th className="th">类型</th>
                  <th className="th">支付方式</th>
                  <th className="th text-right">金额</th>
                  <th className="th">状态</th>
                  <th className="th">第三方单号</th>
                  <th className="th">完成时间</th>
                </tr>
              </thead>
              <tbody>
                {order.payments.map((p) => (
                  <tr key={p.paymentNo}>
                    <td className="td tnum text-slate-700">{p.paymentNo}</td>
                    <td className="td text-slate-600">{PAYMENT_TYPE_LABEL[p.type] ?? p.type}</td>
                    <td className="td text-slate-600">{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</td>
                    <td className="td text-right tnum text-slate-900">{money(p.amountCents)}</td>
                    <td className="td">
                      <Tag
                        className={
                          p.status === 'SUCCESS'
                            ? 'bg-emerald-50 text-emerald-700'
                            : p.status === 'PENDING'
                              ? 'bg-amber-50 text-amber-700'
                              : p.status === 'FAILED'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-slate-100 text-slate-600'
                        }
                      >
                        {p.statusText}
                      </Tag>
                      {p.failReason && <span className="ml-2 text-xs text-red-600">{p.failReason}</span>}
                    </td>
                    <td className="td tnum text-slate-500 break-all">{p.tradeNo ?? '--'}</td>
                    <td className="td tnum text-slate-600">{dateTime(p.paidAt ?? p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ⑤ 退改记录 */}
      <section className="card">
        <h2 className="px-5 py-4 text-base border-b border-[var(--border)]">退改记录</h2>
        {order.items.every((i) => i.refunds.length === 0 && i.changeCount === 0) ? (
          <Empty title="暂无退票或改签记录" hint="已支付车票可在开车前办理退票，每张车票仅可改签一次。" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {order.items.flatMap((it) =>
              it.refunds.map((r) => (
                <li key={r.refundNo} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
                  <Tag className="bg-slate-100 text-slate-600">退票</Tag>
                  <span className="font-medium text-slate-800">{it.passengerName}</span>
                  <span className="text-xs text-slate-500 tnum">{r.refundNo}</span>
                  <span className="text-xs text-slate-500">
                    手续费 <span className="tnum text-slate-700">{money(r.feeCents)}</span> · 退款{' '}
                    <span className="tnum text-emerald-600">{money(r.refundCents)}</span>
                  </span>
                  <Tag className={cn('ml-auto', refundTone[r.status] ?? 'bg-slate-100 text-slate-600')}>
                    {REFUND_STATUS_LABEL[r.status] ?? r.status}
                  </Tag>
                  <span className="text-xs text-slate-400 tnum">{dateTime(r.createdAt)}</span>
                </li>
              )),
            )}
            {order.items
              .filter((it) => it.changeCount > 0)
              .map((it) => (
                <li key={`change-${it.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
                  <Tag className="bg-violet-50 text-violet-700">改签</Tag>
                  <span className="font-medium text-slate-800">{it.passengerName}</span>
                  <span className="text-xs text-slate-500">
                    当前票状态「{it.ticketStatusText}」，累计改签 <span className="tnum">{it.changeCount}</span> 次
                  </span>
                  <span className="ml-auto text-xs text-slate-400">每张车票仅可改签一次</span>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* 取消订单二次确认 */}
      <ConfirmModal
        open={cancelOpen}
        title="取消订单"
        danger
        confirmText="确认取消"
        loading={cancelling}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => void doCancel()}
        content={
          <div className="space-y-2">
            <p>
              确认取消订单 <span className="tnum font-medium">{order.orderNo}</span>？
            </p>
            <p className="text-xs text-[var(--fg-muted)]">取消后锁定的座位立即释放，需重新下单购票，操作不可撤销。</p>
          </div>
        }
      />

      {/* 退票二次确认 */}
      <ConfirmModal
        open={refundConfirmOpen}
        title="确认退票"
        danger
        confirmText="下一步：查看退票费"
        onClose={() => setRefundConfirmOpen(false)}
        onConfirm={() => void startRefundPreview()}
        content={
          <div className="space-y-2">
            <p>
              将对本订单中 <span className="tnum font-medium">{refundableItems.length}</span> 张已出票车票办理退票：
              {refundableItems.map((i) => i.passengerName).join('、') || '--'}
            </p>
            <p className="text-xs text-[var(--fg-muted)]">
              退票手续费按开车前时间计算（8 天以上免收、48 小时以上 5%、24 小时以上 10%、不足 24 小时 20%，最低 2 元），
              下一步将展示每张车票的退票费试算结果，确认后不可撤销。
            </p>
          </div>
        }
      />

      {/* 退票费试算预览 */}
      <Modal
        open={refundOpen}
        title="退票费试算"
        width="max-w-2xl"
        onClose={() => {
          if (!refunding) setRefundOpen(false);
        }}
        footer={
          <>
            <button type="button" className="btn-ghost" disabled={refunding} onClick={() => setRefundOpen(false)}>
              返回
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={refunding || previewLoading || !preview || preview.list.length === 0}
              onClick={() => void submitRefund()}
            >
              {refunding ? '退票处理中…' : '确认退票'}
            </button>
          </>
        }
      >
        {previewLoading ? (
          <Spinner label="正在试算退票费…" />
        ) : !preview || preview.list.length === 0 ? (
          <Empty title="无可退车票" hint="请返回订单详情页确认车票状态。" />
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] border-collapse">
                <thead>
                  <tr>
                    <th className="th">乘车人</th>
                    <th className="th text-right">开车前</th>
                    <th className="th">费率</th>
                    <th className="th text-right">手续费</th>
                    <th className="th text-right">退款额</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.list.map((p) => (
                    <tr key={p.orderItemId}>
                      <td className="td">{p.passengerName}</td>
                      <td className="td text-right tnum">{p.hoursBeforeDepart} 小时</td>
                      <td className="td text-xs text-slate-600">{p.feeRateText}</td>
                      <td className="td text-right tnum text-amber-700">{money(p.feeCents)}</td>
                      <td className="td text-right tnum text-emerald-600">{money(p.refundCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1">
              <span className="text-slate-600">
                合计手续费 <span className="tnum font-medium text-amber-700">{money(preview.totalFeeCents)}</span>
              </span>
              <span className="text-slate-600">
                合计退款 <span className="tnum font-medium text-emerald-600">{money(preview.totalRefundCents)}</span>
              </span>
              <span className="ml-auto text-xs text-[var(--fg-muted)]">退款由 Mock 银行原路退回</span>
            </div>

            <div>
              <label className="label" htmlFor="refund-reason">
                退票原因（选填）
              </label>
              <input
                id="refund-reason"
                className="input"
                maxLength={100}
                placeholder="如：行程变更"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
