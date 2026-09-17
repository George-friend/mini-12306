/** 订单管理：全量订单检索 + 订单详情（车票 / 支付流水 / 退改记录） */
import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { dateTime, maskPhone, money, orderStatusTone, seatClassStyle, ticketStatusTone } from '../../lib/format';
import { Empty, ErrorBox, Input, Modal, Pagination, SectionTitle, Select, Spinner, Tag } from '../../components/ui';

interface OrderUser {
  id: number;
  username: string;
  realName: string;
  phone: string;
}

interface OrderTrain {
  trainNo: string;
  trainType: string;
  fromStation: string;
  toStation: string;
  runDate: string;
  departTime: string;
  arriveTime: string;
  departDateTime: string;
  departDateTimeText: string;
  scheduleId: number;
  scheduleStatus: string;
  scheduleStatusText: string;
}

interface OrderItemRefund {
  refundNo: string;
  feeCents: number;
  refundCents: number;
  status: string;
  createdAt: string;
}

interface OrderItem {
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
  refunds: OrderItemRefund[];
}

interface OrderPayment {
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

interface AdminOrder {
  orderNo: string;
  channel: string;
  status: string;
  statusText: string;
  passengerCount: number;
  totalAmountCents: number;
  totalAmountYuan: string;
  paidAmountCents: number;
  paidAmountYuan: string;
  expireAt: string;
  paidAt: string | null;
  createdAt: string;
  canPay: boolean;
  canCancel: boolean;
  minutesToDepart: number;
  canRefund: boolean;
  remark: string | null;
  user?: OrderUser;
  train: OrderTrain;
  items: OrderItem[];
  payments: OrderPayment[];
}

interface AdminOrderListData {
  total: number;
  page: number;
  pageSize: number;
  list: AdminOrder[];
}

const STATUS_FILTERS = [
  { value: '', label: '全部状态' },
  { value: 'PENDING_PAYMENT', label: '待支付' },
  { value: 'PAID', label: '已支付' },
  { value: 'PARTIAL_REFUNDED', label: '部分退票' },
  { value: 'REFUNDED', label: '已退票' },
  { value: 'CHANGED', label: '已改签' },
  { value: 'CANCELLED', label: '已取消' },
  { value: 'EXPIRED', label: '已过期' },
];

const CHANNEL_TEXT: Record<string, string> = { WEB: '网上', APP: '手机', CLERK: '窗口' };
const PAYMENT_TYPE_TEXT: Record<string, string> = { PAY: '支付', REFUND: '退款', CHANGE_DIFF: '改签差价' };
const PAYMENT_METHOD_TEXT: Record<string, string> = { MOCK_BANK: 'Mock 银行', CASH: '现金', BALANCE: '余额' };

export default function AdminOrders() {
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [data, setData] = useState<AdminOrderListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<AdminOrder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<AdminOrderListData>(`/admin/orders${qs({ status, keyword: keyword.trim(), page, pageSize })}`);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [status, keyword, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const list = data?.list ?? [];

  return (
    <div className="space-y-5">
      <SectionTitle
        title="订单管理"
        desc="支持按订单状态与关键字（订单号 / 用户名 / 真实姓名）检索，点击任意行查看订单详情"
        extra={
          <button type="button" className="btn-sm btn-ghost" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        }
      />

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">订单状态</span>
          <Select
            className="w-40"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="label">关键字</span>
          <Input
            className="w-56"
            placeholder="订单号 / 用户名 / 真实姓名"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="block">
          <span className="label">每页条数</span>
          <Select
            className="w-24"
            value={String(pageSize)}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
          </Select>
        </label>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => {
            setStatus('');
            setKeyword('');
            setPage(1);
          }}
        >
          重置筛选
        </button>
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner label="正在加载订单…" />
        ) : list.length === 0 ? (
          <Empty
            title="没有匹配的订单"
            hint={keyword || status ? '尝试放宽筛选条件，或清空关键字后重新检索' : '当前系统尚无订单，可在售票窗口或旅客端下单后查看'}
            action={
              (keyword || status) ? (
                <button
                  type="button"
                  className="btn-sm btn-ghost"
                  onClick={() => {
                    setStatus('');
                    setKeyword('');
                    setPage(1);
                  }}
                >
                  清空筛选条件
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr>
                  <th className="th">订单号</th>
                  <th className="th">用户</th>
                  <th className="th">车次与日期</th>
                  <th className="th">乘车人数</th>
                  <th className="th">金额</th>
                  <th className="th">状态</th>
                  <th className="th">下单时间</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr
                    key={o.orderNo}
                    tabIndex={0}
                    role="button"
                    aria-label={`查看订单 ${o.orderNo} 详情`}
                    className="hover:bg-brand-50/40 cursor-pointer"
                    onClick={() => setDetail(o)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetail(o);
                      }
                    }}
                  >
                    <td className="td">
                      <span className="font-mono text-xs text-slate-800">{o.orderNo}</span>
                      <span className="ml-2 text-[11px] text-slate-400">{CHANNEL_TEXT[o.channel] ?? o.channel}</span>
                    </td>
                    <td className="td">
                      <div className="text-slate-800">{o.user?.username ?? '--'}</div>
                      <div className="text-xs text-slate-500">{o.user?.realName ?? '--'}</div>
                    </td>
                    <td className="td">
                      <div className="text-slate-800 tnum">
                        {o.train.trainNo} · {o.train.runDate} {o.train.departTime}
                      </div>
                      <div className="text-xs text-slate-500">
                        {o.train.fromStation} → {o.train.toStation}
                      </div>
                    </td>
                    <td className="td tnum text-slate-700">{o.passengerCount} 人</td>
                    <td className="td tnum font-medium text-slate-800">{money(o.totalAmountCents)}</td>
                    <td className="td">
                      <Tag className={orderStatusTone(o.status)}>{o.statusText}</Tag>
                    </td>
                    <td className="td text-xs text-slate-500 tnum">{dateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(p) => setPage(p)} />
        )}
      </div>

      <Modal open={!!detail} title={`订单详情 · ${detail?.orderNo ?? ''}`} onClose={() => setDetail(null)} width="max-w-3xl">
        {detail && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-slate-400">订单状态</div>
                <div className="mt-1">
                  <Tag className={orderStatusTone(detail.status)}>{detail.statusText}</Tag>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">购买渠道</div>
                <div className="mt-1 text-slate-700">{CHANNEL_TEXT[detail.channel] ?? detail.channel}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">订单金额</div>
                <div className="mt-1 text-slate-800 tnum">{money(detail.totalAmountCents)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">实付金额</div>
                <div className="mt-1 text-slate-800 tnum">{money(detail.paidAmountCents)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">下单时间</div>
                <div className="mt-1 text-slate-700 tnum">{dateTime(detail.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">支付时间</div>
                <div className="mt-1 text-slate-700 tnum">{dateTime(detail.paidAt)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">支付截止</div>
                <div className="mt-1 text-slate-700 tnum">{dateTime(detail.expireAt)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">距发车</div>
                <div className="mt-1 text-slate-700 tnum">{detail.minutesToDepart} 分钟</div>
              </div>
            </div>

            <section>
              <h4 className="text-sm font-medium text-slate-800 mb-2">下单用户</h4>
              <div className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm text-slate-700 flex flex-wrap gap-x-6 gap-y-1">
                <span>用户名：{detail.user?.username ?? '--'}</span>
                <span>真实姓名：{detail.user?.realName ?? '--'}</span>
                <span>手机号：{maskPhone(detail.user?.phone)}</span>
              </div>
            </section>

            <section>
              <h4 className="text-sm font-medium text-slate-800 mb-2">车次信息</h4>
              <div className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm text-slate-700 flex flex-wrap gap-x-6 gap-y-1">
                <span className="tnum">
                  {detail.train.trainNo}（{detail.train.trainType}）
                </span>
                <span>
                  {detail.train.fromStation} → {detail.train.toStation}
                </span>
                <span className="tnum">
                  {detail.train.runDate} {detail.train.departTime} - {detail.train.arriveTime}
                </span>
                <span>运行状态：{detail.train.scheduleStatusText}</span>
                <span className="text-slate-400">运行日 ID {detail.train.scheduleId}</span>
              </div>
            </section>

            <section>
              <h4 className="text-sm font-medium text-slate-800 mb-2">车票列表（{detail.items.length} 张）</h4>
              <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead>
                    <tr>
                      <th className="th">乘车人</th>
                      <th className="th">席别</th>
                      <th className="th">票种</th>
                      <th className="th">座位号</th>
                      <th className="th">票价</th>
                      <th className="th">票状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((it) => (
                      <tr key={it.id}>
                        <td className="td">
                          <div className="text-slate-800">{it.passengerName}</div>
                          <div className="text-xs text-slate-400 font-mono">{it.idCardMasked}</div>
                        </td>
                        <td className="td">
                          <Tag className={seatClassStyle(it.seatClass)}>{it.seatClassLabel}</Tag>
                        </td>
                        <td className="td text-slate-600">{it.ticketTypeLabel}</td>
                        <td className="td tnum text-slate-700">{it.seatNo}</td>
                        <td className="td tnum text-slate-800">{money(it.priceCents)}</td>
                        <td className="td">
                          <Tag className={ticketStatusTone(it.ticketStatus)}>{it.ticketStatusText}</Tag>
                          {it.changeCount > 0 && <span className="ml-2 text-[11px] text-violet-600">已改签 {it.changeCount} 次</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h4 className="text-sm font-medium text-slate-800 mb-2">支付流水（{detail.payments.length} 条）</h4>
              {detail.payments.length === 0 ? (
                <p className="text-sm text-slate-500">暂无支付流水</p>
              ) : (
                <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr>
                        <th className="th">流水号</th>
                        <th className="th">类型</th>
                        <th className="th">金额</th>
                        <th className="th">方式</th>
                        <th className="th">状态</th>
                        <th className="th">时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.payments.map((p) => (
                        <tr key={p.paymentNo}>
                          <td className="td font-mono text-xs text-slate-600">{p.paymentNo}</td>
                          <td className="td text-slate-700">{PAYMENT_TYPE_TEXT[p.type] ?? p.type}</td>
                          <td className="td tnum text-slate-800">{money(p.amountCents)}</td>
                          <td className="td text-slate-600">{PAYMENT_METHOD_TEXT[p.method] ?? p.method}</td>
                          <td className="td">
                            <Tag
                              className={
                                p.status === 'SUCCESS'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : p.status === 'PENDING'
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-slate-100 text-slate-500'
                              }
                            >
                              {p.statusText}
                            </Tag>
                            {p.failReason && <span className="ml-2 text-[11px] text-red-500">{p.failReason}</span>}
                          </td>
                          <td className="td text-xs text-slate-500 tnum">{dateTime(p.paidAt ?? p.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h4 className="text-sm font-medium text-slate-800 mb-2">退改记录</h4>
              {detail.items.every((it) => it.refunds.length === 0) ? (
                <p className="text-sm text-slate-500">暂无退票记录（改签信息见车票列表的「已改签」标记）</p>
              ) : (
                <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead>
                      <tr>
                        <th className="th">退票单号</th>
                        <th className="th">乘车人</th>
                        <th className="th">退票费</th>
                        <th className="th">实退金额</th>
                        <th className="th">状态</th>
                        <th className="th">申请时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.flatMap((it) =>
                        it.refunds.map((r) => (
                          <tr key={r.refundNo}>
                            <td className="td font-mono text-xs text-slate-600">{r.refundNo}</td>
                            <td className="td text-slate-700">{it.passengerName}</td>
                            <td className="td tnum text-slate-700">{money(r.feeCents)}</td>
                            <td className="td tnum text-slate-800">{money(r.refundCents)}</td>
                            <td className="td">
                              <Tag className={r.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}>{r.status}</Tag>
                            </td>
                            <td className="td text-xs text-slate-500 tnum">{dateTime(r.createdAt)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {detail.remark && <p className="text-xs text-slate-500">订单备注：{detail.remark}</p>}
            {detail.user && detail.user.phone.length === 11 && (
              <p className="text-xs text-slate-400">提示：手机号已按脱敏规则展示，如需完整号码请通过售票窗口按证件号核验。</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
