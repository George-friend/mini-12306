/** 售票窗口（售票员 / 管理员）：左侧旅客与订单检索，右侧窗口代客购票 + 现金收银 + 代客退票 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, newIdempotencyKey, qs } from '../../lib/api';
import { dateTime, durationText, money, orderStatusTone, seatClassStyle, ticketStatusTone, today } from '../../lib/format';
import { ConfirmModal, Empty, ErrorBox, Field, Input, Select, Spinner, Tag, useToast } from '../../components/ui';
import { cn } from '../../lib/cn';

/* ── 接口响应类型 ───────────────────────────────────────── */

interface ClerkUser {
  id: number;
  username: string;
  realName: string;
  phone: string;
  idCardMasked: string;
  status: string;
  isVerified: boolean;
}

interface PassengerRow {
  id: number;
  name: string;
  idCardMasked: string;
  passengerType: string;
}

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
  paidAt: string | null;
}

interface CounterOrder {
  orderNo: string;
  channel: string;
  status: string;
  statusText: string;
  passengerCount: number;
  totalAmountCents: number;
  totalAmountYuan: string;
  paidAmountCents: number;
  expireAt: string;
  paidAt: string | null;
  createdAt: string;
  canPay: boolean;
  canRefund: boolean;
  remark: string | null;
  user?: OrderUser;
  train: OrderTrain;
  items: OrderItem[];
  payments: OrderPayment[];
}

interface SearchData {
  users: ClerkUser[];
  orders: CounterOrder[];
}

interface PassengerListData {
  list: PassengerRow[];
}

interface Station {
  id: number;
  code: string;
  name: string;
  city: string;
  province: string;
  pinyin: string;
  isActive: boolean;
}

interface StationListData {
  list: Station[];
}

interface TrainSearchSeat {
  seatClass: string;
  seatClassLabel: string;
  priceCents: number;
  priceYuan: string;
  total: number;
  available: number;
  availableText: string;
}

interface TrainSearchItem {
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
  seats: TrainSearchSeat[];
}

interface TrainSearchData {
  from: { id: number; name: string; city: string };
  to: { id: number; name: string; city: string };
  runDate: string;
  total: number;
  list: TrainSearchItem[];
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

interface RefundResult {
  refundNos: string[];
  totalFeeCents: number;
  totalRefundCents: number;
  totalRefundYuan: string;
  providerMessage: string;
  orders: CounterOrder[];
}

const PASSENGER_TYPE_TEXT: Record<string, string> = { ADULT: '成人', CHILD: '儿童', STUDENT: '学生' };
const MAX_PASSENGERS = 5;

/* ── 页面 ───────────────────────────────────────────────── */

export default function Counter() {
  const toast = useToast();

  /* 左栏：检索 */
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const [users, setUsers] = useState<ClerkUser[]>([]);
  const [orders, setOrders] = useState<CounterOrder[]>([]);
  const [expandOrder, setExpandOrder] = useState<string | null>(null);

  const [selectedUser, setSelectedUser] = useState<ClerkUser | null>(null);
  const [passengers, setPassengers] = useState<PassengerRow[]>([]);
  const [passengersLoading, setPassengersLoading] = useState(false);
  const [passengerError, setPassengerError] = useState('');
  const [selectedPassengerIds, setSelectedPassengerIds] = useState<number[]>([]);

  /* 右栏：购票 */
  const [stations, setStations] = useState<Station[]>([]);
  const [stationsError, setStationsError] = useState('');
  const [travelDate, setTravelDate] = useState(today());
  const [fromStation, setFromStation] = useState('');
  const [toStation, setToStation] = useState('');
  const [trainQuerying, setTrainQuerying] = useState(false);
  const [trainError, setTrainError] = useState('');
  const [trainResult, setTrainResult] = useState<TrainSearchData | null>(null);

  const [selectedTrain, setSelectedTrain] = useState<TrainSearchItem | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<TrainSearchSeat | null>(null);

  const [idemKey, setIdemKey] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdOrder, setCreatedOrder] = useState<CounterOrder | null>(null);
  const [cashing, setCashing] = useState(false);

  /* 代客退票 */
  const [refundTarget, setRefundTarget] = useState<CounterOrder | null>(null);
  const [refundItemIds, setRefundItemIds] = useState<number[]>([]);
  const [refundPreview, setRefundPreview] = useState<RefundPreviewData | null>(null);
  const [refundPreviewLoading, setRefundPreviewLoading] = useState(false);
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  /* 初始化：车站字典 + 默认站点 */
  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<StationListData>('/stations');
        setStations(res.list);
        if (res.list.length >= 2) {
          setFromStation(res.list[0].name);
          setToStation(res.list[1].name);
        }
      } catch (e) {
        setStationsError(e instanceof Error ? e.message : '车站字典加载失败');
      }
    })();
  }, []);

  /* 幂等键：选择变化时重新生成，保证同一笔下单重试命中幂等 */
  useEffect(() => {
    if (!selectedUser || !selectedTrain || !selectedSeat || selectedPassengerIds.length === 0) {
      setIdemKey('');
      return;
    }
    setIdemKey(newIdempotencyKey('clerk'));
  }, [selectedUser, selectedTrain, selectedSeat, selectedPassengerIds]);

  const loadPassengers = useCallback(async (userId: number) => {
    setPassengersLoading(true);
    setPassengerError('');
    try {
      const res = await api.get<PassengerListData>(`/clerk/users/${userId}/passengers`);
      setPassengers(res.list);
    } catch (e) {
      setPassengerError(e instanceof Error ? e.message : '乘车人加载失败');
      setPassengers([]);
    } finally {
      setPassengersLoading(false);
    }
  }, []);

  const runSearch = useCallback(
    async (kw: string) => {
      if (!kw.trim()) {
        toast.error('请输入检索关键字（订单号 / 证件号 / 手机号 / 姓名）');
        return;
      }
      setSearching(true);
      setSearchError('');
      try {
        const res = await api.get<SearchData>(`/clerk/orders/search${qs({ keyword: kw.trim() })}`);
        setUsers(res.users);
        setOrders(res.orders);
        setSearched(true);
        setExpandOrder(null);
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : '检索失败');
        setUsers([]);
        setOrders([]);
        setSearched(true);
      } finally {
        setSearching(false);
      }
    },
    [toast],
  );

  function pickUser(u: ClerkUser) {
    setSelectedUser(u);
    setSelectedPassengerIds([]);
    setPassengers([]);
    void loadPassengers(u.id);
  }

  async function queryTrains() {
    if (!fromStation || !toStation) {
      toast.error('请选择出发站与到达站');
      return;
    }
    if (fromStation === toStation) {
      toast.error('出发站与到达站不能相同');
      return;
    }
    setTrainQuerying(true);
    setTrainError('');
    setSelectedTrain(null);
    setSelectedSeat(null);
    try {
      const res = await api.get<TrainSearchData>(`/trains/search${qs({ date: travelDate, from: fromStation, to: toStation })}`);
      setTrainResult(res);
    } catch (e) {
      setTrainError(e instanceof Error ? e.message : '查询失败');
      setTrainResult(null);
    } finally {
      setTrainQuerying(false);
    }
  }

  function togglePassenger(id: number) {
    setSelectedPassengerIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_PASSENGERS) {
        toast.error(`单笔订单最多选择 ${MAX_PASSENGERS} 名乘车人`);
        return prev;
      }
      return [...prev, id];
    });
  }

  const selectedPassengers = useMemo(
    () => passengers.filter((p) => selectedPassengerIds.includes(p.id)),
    [passengers, selectedPassengerIds],
  );

  async function createCounterOrder() {
    if (!selectedUser) {
      toast.error('请先在左栏选择代客购票的旅客');
      return;
    }
    if (!selectedTrain || !selectedSeat) {
      toast.error('请先选择车次与席别');
      return;
    }
    if (selectedPassengerIds.length === 0) {
      toast.error('请至少选择 1 名乘车人');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      const key = idemKey || newIdempotencyKey('clerk');
      setIdemKey(key);
      const res = await api.post<CounterOrder>(
        '/clerk/orders',
        {
          userId: selectedUser.id,
          scheduleId: selectedTrain.scheduleId,
          seatClass: selectedSeat.seatClass,
          passengerIds: selectedPassengerIds,
          remark: `窗口代客购票（${selectedTrain.trainNo} ${selectedTrain.runDate} ${selectedSeat.seatClassLabel}）`,
        },
        { 'Idempotency-Key': key },
      );
      setCreatedOrder(res);
      toast.success(`窗口订单 ${res.orderNo} 已创建，请收银后确认出票`);
      void runSearch(keyword);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '下单失败';
      setCreateError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function payCash(orderNo: string) {
    setCashing(true);
    try {
      const res = await api.post<CounterOrder>(`/clerk/orders/${orderNo}/pay-cash`);
      setCreatedOrder(res);
      toast.success(`现金收银完成，${res.orderNo} 已出票（${money(res.totalAmountCents)}）`);
      setOrders((prev) => prev.map((o) => (o.orderNo === res.orderNo ? res : o)));
      if (keyword.trim()) void runSearch(keyword);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '收银失败');
    } finally {
      setCashing(false);
    }
  }

  function openRefund(order: CounterOrder) {
    setRefundTarget(order);
    setRefundItemIds([]);
    setRefundPreview(null);
  }

  const refundableItems = useMemo(
    () => (refundTarget ? refundTarget.items.filter((it) => it.ticketStatus === 'TICKETED') : []),
    [refundTarget],
  );

  async function previewRefund() {
    if (refundItemIds.length === 0) {
      toast.error('请勾选需要退票的车票');
      return;
    }
    setRefundPreviewLoading(true);
    try {
      const res = await api.get<RefundPreviewData>(`/refunds/preview${qs({ orderItemIds: refundItemIds.join(',') })}`);
      setRefundPreview(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '退票试算失败');
      setRefundPreview(null);
    } finally {
      setRefundPreviewLoading(false);
    }
  }

  async function submitRefund() {
    if (refundItemIds.length === 0) return;
    setRefundSubmitting(true);
    try {
      const res = await api.post<RefundResult>('/refunds', {
        orderItemIds: refundItemIds,
        reason: '窗口代客退票',
      });
      toast.success(`代客退票成功，退款 ￥${res.totalRefundYuan} 已原路退回`);
      setRefundTarget(null);
      setRefundPreview(null);
      setRefundItemIds([]);
      const refunded = res.orders[0];
      if (refunded) {
        setOrders((prev) => prev.map((o) => (o.orderNo === refunded.orderNo ? refunded : o)));
        setCreatedOrder((prev) => (prev && prev.orderNo === refunded.orderNo ? refunded : prev));
      }
      if (keyword.trim()) void runSearch(keyword);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '退票失败');
    } finally {
      setRefundSubmitting(false);
    }
  }

  const canSubmitOrder = !!selectedUser && !!selectedTrain && !!selectedSeat && selectedPassengerIds.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      {/* ── 左栏：检索 ─────────────────────────────── */}
      <section className="card p-5 space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg">检索</h2>
            <p className="text-xs text-[var(--fg-muted)] mt-1">按订单号 / 证件号 / 手机号 / 姓名定位旅客与订单</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="订单号 / 证件号 / 手机号 / 姓名"
            value={keyword}
            aria-label="检索关键字"
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch(keyword);
            }}
          />
          <button type="button" className="btn-primary shrink-0" onClick={() => void runSearch(keyword)} disabled={searching}>
            {searching ? '检索中…' : '检索'}
          </button>
        </div>

        {searchError && <ErrorBox message={searchError} onRetry={() => void runSearch(keyword)} />}

        {searching ? (
          <Spinner label="正在检索旅客与订单…" />
        ) : !searched ? (
          <Empty title="请输入关键字后检索" hint="支持完整订单号、身份证号、手机号，或姓名 / 用户名的一部分" />
        ) : (
          <>
            <div>
              <h3 className="text-sm font-medium text-slate-800 mb-2">命中旅客（{users.length} 人）</h3>
              {users.length === 0 ? (
                <p className="text-sm text-slate-500 py-3">未命中旅客，请核对证件号后 4 位或手机号</p>
              ) : (
                <div className="rounded-lg border border-[var(--border)] divide-y divide-slate-100 max-h-64 overflow-y-auto">
                  {users.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => pickUser(u)}
                      className={cn(
                        'w-full text-left px-4 py-3 flex items-center justify-between gap-3 transition-colors',
                        selectedUser?.id === u.id ? 'bg-brand-50' : 'hover:bg-slate-50',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-800 truncate">
                          {u.username}
                          <span className="ml-2 text-slate-600">{u.realName}</span>
                        </span>
                        <span className="block text-xs text-slate-500 tnum mt-0.5">
                          {u.phone} · {u.idCardMasked}
                        </span>
                      </span>
                      <span className="shrink-0 flex items-center gap-2">
                        {!u.isVerified && <Tag className="bg-amber-50 text-amber-700">未实名</Tag>}
                        <Tag className={u.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}>
                          {u.status === 'ACTIVE' ? '正常' : '已冻结'}
                        </Tag>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-medium text-slate-800 mb-2">命中订单（{orders.length} 笔）</h3>
              {orders.length === 0 ? (
                <p className="text-sm text-slate-500 py-3">未命中订单，可使用完整订单号精确检索</p>
              ) : (
                <div className="rounded-lg border border-[var(--border)] divide-y divide-slate-100 max-h-80 overflow-y-auto">
                  {orders.map((o) => {
                    const open = expandOrder === o.orderNo;
                    return (
                      <div key={o.orderNo}>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setExpandOrder(open ? null : o.orderNo)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="font-mono text-xs text-slate-800 truncate">{o.orderNo}</span>
                            <Tag className={orderStatusTone(o.status)}>{o.statusText}</Tag>
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span className="tnum">
                              {o.train.trainNo} · {o.train.runDate} {o.train.departTime}
                            </span>
                            <span>
                              {o.train.fromStation} → {o.train.toStation}
                            </span>
                            <span className="tnum text-slate-700">{money(o.totalAmountCents)}</span>
                            {o.channel === 'CLERK' && <span className="text-violet-600">窗口单</span>}
                          </span>
                        </button>
                        {open && (
                          <div className="px-4 pb-3 bg-slate-50/70">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="text-left py-1.5 font-normal">乘车人</th>
                                  <th className="text-left py-1.5 font-normal">席别</th>
                                  <th className="text-left py-1.5 font-normal">座位号</th>
                                  <th className="text-left py-1.5 font-normal">票价</th>
                                  <th className="text-left py-1.5 font-normal">票状态</th>
                                </tr>
                              </thead>
                              <tbody>
                                {o.items.map((it) => (
                                  <tr key={it.id} className="border-t border-slate-200/70">
                                    <td className="py-1.5 text-slate-700">
                                      {it.passengerName}
                                      <span className="ml-2 text-slate-400 font-mono">{it.idCardMasked}</span>
                                    </td>
                                    <td className="py-1.5">
                                      <Tag className={seatClassStyle(it.seatClass)}>{it.seatClassLabel}</Tag>
                                    </td>
                                    <td className="py-1.5 tnum text-slate-600">{it.seatNo}</td>
                                    <td className="py-1.5 tnum text-slate-700">{money(it.priceCents)}</td>
                                    <td className="py-1.5">
                                      <Tag className={ticketStatusTone(it.ticketStatus)}>{it.ticketStatusText}</Tag>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div className="mt-2 flex items-center justify-between gap-3">
                              <span className="text-[11px] text-slate-500">
                                下单 {dateTime(o.createdAt)} · 支付 {dateTime(o.paidAt)} · 备注 {o.remark || '--'}
                              </span>
                              {o.items.some((it) => it.ticketStatus === 'TICKETED') && (
                                <button type="button" className="btn-sm btn-danger shrink-0" onClick={() => openRefund(o)}>
                                  代客退票
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-medium text-slate-800 mb-2">
                乘车人（{selectedUser ? `${selectedUser.realName} 的乘车人` : '请先选择旅客'}，已选 {selectedPassengerIds.length}/{MAX_PASSENGERS}）
              </h3>
              {!selectedUser ? (
                <p className="text-sm text-slate-500 py-3">在上方「命中旅客」中点击一位旅客以加载其乘车人</p>
              ) : passengersLoading ? (
                <Spinner label="正在加载乘车人…" />
              ) : passengerError ? (
                <ErrorBox message={passengerError} onRetry={() => void loadPassengers(selectedUser.id)} />
              ) : passengers.length === 0 ? (
                <p className="text-sm text-slate-500 py-3">该旅客尚未添加乘车人，请引导其先在旅客端「乘车人」页面完成添加</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {passengers.map((p) => {
                    const checked = selectedPassengerIds.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={cn(
                          'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors',
                          checked ? 'border-brand-300 bg-brand-50' : 'border-[var(--border)] bg-white hover:bg-slate-50',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-[var(--primary)]"
                          checked={checked}
                          onChange={() => togglePassenger(p.id)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm text-slate-800 truncate">
                            {p.name}
                            <span className="ml-2 text-xs text-slate-500">{PASSENGER_TYPE_TEXT[p.passengerType] ?? p.passengerType}</span>
                          </span>
                          <span className="block text-[11px] text-slate-400 font-mono">{p.idCardMasked}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── 右栏：窗口代客购票 ─────────────────────── */}
      <section className="card p-5 space-y-4">
        <div>
          <h2 className="text-lg">窗口代客购票</h2>
          <p className="text-xs text-[var(--fg-muted)] mt-1">
            选择旅客与乘车人 → 查询车次席别 → 生成窗口订单（渠道 CLERK）→ 现金收银并出票
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-slate-50 px-4 py-3 text-sm">
          {selectedUser ? (
            <span className="text-slate-700">
              代客对象：<b>{selectedUser.realName}</b>（{selectedUser.username} · {selectedUser.phone}）
              <span className="ml-2 text-brand-700">已选 {selectedPassengerIds.length} 名乘车人</span>
            </span>
          ) : (
            <span className="text-amber-700">尚未选择旅客，请先在左栏「命中旅客」中点击一位旅客</span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="乘车日期" required>
            <Input type="date" value={travelDate} min={today()} onChange={(e) => setTravelDate(e.target.value)} />
          </Field>
          <Field label="出发站" required>
            <Select value={fromStation} onChange={(e) => setFromStation(e.target.value)}>
              <option value="">请选择</option>
              {stations.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="到达站" required>
            <Select value={toStation} onChange={(e) => setToStation(e.target.value)}>
              <option value="">请选择</option>
              {stations.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" className="btn-primary" onClick={() => void queryTrains()} disabled={trainQuerying}>
            {trainQuerying ? '查询中…' : '查询车次'}
          </button>
          <span className="text-xs text-slate-500">票价以元展示，实际按分结算</span>
        </div>

        {stationsError && <ErrorBox message={`${stationsError}（车站下拉不可用，请刷新页面重试）`} />}
        {trainError && <ErrorBox message={trainError} onRetry={() => void queryTrains()} />}

        {trainQuerying ? (
          <Spinner label="正在查询车次…" />
        ) : trainResult && trainResult.list.length === 0 ? (
          <Empty
            title={`${trainResult.runDate} ${trainResult.from.name} → ${trainResult.to.name} 无车次`}
            hint="请更换日期或站点；若该日期尚未生成运行日，请管理员在「运行日与库存」中批量生成"
          />
        ) : trainResult ? (
          <div className="space-y-3">
            <div className="text-xs text-slate-500">
              共 {trainResult.total} 个车次（{trainResult.runDate} {trainResult.from.name} → {trainResult.to.name}）
            </div>
            {trainResult.list.map((t) => (
              <div
                key={t.scheduleId}
                className={cn(
                  'rounded-xl border p-4 transition-colors',
                  selectedTrain?.scheduleId === t.scheduleId ? 'border-brand-400 bg-brand-50/40' : 'border-[var(--border)] bg-white',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-base font-semibold tnum text-slate-900">{t.trainNo}</span>
                    <Tag className="bg-slate-100 text-slate-600">{t.trainType}</Tag>
                    <span className="text-sm text-slate-700 tnum">
                      {t.departTime} → {t.arriveTime}
                    </span>
                    <span className="text-xs text-slate-500">{durationText(t.durationMin)}</span>
                  </div>
                  <Tag
                    className={
                      t.scheduleStatus === 'NORMAL'
                        ? 'bg-emerald-50 text-emerald-700'
                        : t.scheduleStatus === 'DELAYED'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-red-50 text-red-600'
                    }
                  >
                    {t.scheduleStatusText}
                  </Tag>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {t.fromStation} → {t.toStation} · {t.mileageKm} km · 最低 {money(t.minPriceCents)}
                  {t.note ? ` · ${t.note}` : ''}
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {t.seats.map((s) => {
                    const disabled = s.available <= 0 || !t.purchasable;
                    const active = selectedTrain?.scheduleId === t.scheduleId && selectedSeat?.seatClass === s.seatClass;
                    return (
                      <button
                        key={s.seatClass}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          setSelectedTrain(t);
                          setSelectedSeat(s);
                        }}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-left transition-colors',
                          active
                            ? 'border-brand-500 bg-brand-50'
                            : disabled
                              ? 'border-[var(--border)] bg-slate-50 opacity-60 cursor-not-allowed'
                              : 'border-[var(--border)] bg-white hover:border-brand-300 hover:bg-brand-50/40',
                        )}
                      >
                        <span className="block text-xs text-slate-600">{s.seatClassLabel}</span>
                        <span className="block text-sm font-medium tnum text-slate-900 mt-0.5">{money(s.priceCents)}</span>
                        <span className={cn('block text-[11px] mt-0.5', s.available > 0 ? 'text-emerald-600' : 'text-slate-400')}>
                          余票 {s.available <= 0 ? '无票' : `${s.available} 张`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="请先查询车次" hint="选择乘车日期与出发 / 到达站后点击「查询车次」，可查看各席别余票与票价" />
        )}

        <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
          <div className="text-sm font-medium text-slate-800">下单确认</div>
          <div className="text-xs text-slate-600 space-y-1">
            <div>旅客：{selectedUser ? `${selectedUser.realName}（${selectedUser.username}）` : '未选择'}</div>
            <div>
              车次：{selectedTrain ? `${selectedTrain.trainNo} ${selectedTrain.runDate} ${selectedTrain.departTime}` : '未选择'}
              {selectedTrain && `（${selectedTrain.fromStation} → ${selectedTrain.toStation}）`}
            </div>
            <div>
              席别：{selectedSeat ? `${selectedSeat.seatClassLabel} · ${money(selectedSeat.priceCents)}/张` : '未选择'}
            </div>
            <div>
              乘车人：
              {selectedPassengers.length === 0 ? '未选择' : selectedPassengers.map((p) => p.name).join('、')}
            </div>
            {selectedSeat && selectedPassengerIds.length > 0 && (
              <div className="text-slate-800">
                预估计应付：<b className="tnum">{money(selectedSeat.priceCents * selectedPassengerIds.length)}</b>
                <span className="text-slate-400">（按成人票价估算，儿童 / 学生票由后端按票种折扣计算）</span>
              </div>
            )}
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <button type="button" className="btn-primary w-full" disabled={!canSubmitOrder || creating} onClick={() => void createCounterOrder()}>
            {creating ? '正在创建订单…' : '生成窗口订单（待收银）'}
          </button>
        </div>

        {createdOrder && (
          <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-slate-900">窗口订单</div>
              <div className="flex items-center gap-2">
                <Tag className={orderStatusTone(createdOrder.status)}>{createdOrder.statusText}</Tag>
                <Tag className="bg-violet-50 text-violet-700">渠道 CLERK（窗口）</Tag>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-slate-400">订单号</div>
                <div className="mt-0.5 font-mono text-xs text-slate-800 break-all">{createdOrder.orderNo}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">应收金额</div>
                <div className="mt-0.5 text-base font-semibold tnum text-slate-900">{money(createdOrder.totalAmountCents)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">车次</div>
                <div className="mt-0.5 text-slate-700 tnum">
                  {createdOrder.train.trainNo} {createdOrder.train.runDate} {createdOrder.train.departTime}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">乘车人数</div>
                <div className="mt-0.5 text-slate-700 tnum">{createdOrder.passengerCount} 人</div>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-white divide-y divide-slate-100">
              {createdOrder.items.map((it) => (
                <div key={it.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-700">
                    {it.passengerName}
                    <span className="ml-2 text-slate-400">{it.seatClassLabel}</span>
                    <span className="ml-2 tnum text-slate-600">{it.seatNo}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tnum text-slate-800">{money(it.priceCents)}</span>
                    <Tag className={ticketStatusTone(it.ticketStatus)}>{it.ticketStatusText}</Tag>
                  </span>
                </div>
              ))}
            </div>
            {createdOrder.remark && <p className="text-xs text-slate-500">备注：{createdOrder.remark}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={createdOrder.status !== 'PENDING_PAYMENT' || cashing}
                onClick={() => void payCash(createdOrder.orderNo)}
              >
                {cashing ? '收银中…' : `现金收银并出票（${money(createdOrder.totalAmountCents)}）`}
              </button>
              {createdOrder.items.some((it) => it.ticketStatus === 'TICKETED') && (
                <button type="button" className="btn-danger" onClick={() => openRefund(createdOrder)}>
                  代客退票
                </button>
              )}
              {createdOrder.status !== 'PENDING_PAYMENT' && (
                <span className="text-xs text-slate-500">当前状态「{createdOrder.statusText}」，无需再次收银</span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              提示：订单保留支付时限为系统参数 order.pay_timeout_minutes，超时后自动释放锁票；请及时完成现金收银。
            </p>
          </div>
        )}
      </section>

      {/* 代客退票：先试算再确认 */}
      <ConfirmModal
        open={!!refundTarget && !!refundPreview}
        title="代客退票确认"
        danger
        confirmText={refundSubmitting ? '处理中…' : '确认退票'}
        loading={refundSubmitting}
        onClose={() => {
          setRefundPreview(null);
        }}
        onConfirm={() => void submitRefund()}
        content={
          refundPreview && (
            <div className="space-y-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left py-1 font-normal">乘车人</th>
                    <th className="text-left py-1 font-normal">票面价</th>
                    <th className="text-left py-1 font-normal">退票费</th>
                    <th className="text-left py-1 font-normal">实退</th>
                  </tr>
                </thead>
                <tbody>
                  {refundPreview.list.map((r) => (
                    <tr key={r.orderItemId} className="border-t border-slate-200">
                      <td className="py-1.5 text-slate-700">
                        {r.passengerName}
                        <span className="block text-[11px] text-slate-400">
                          开车前 {r.hoursBeforeDepart} 小时 · {r.feeRateText}
                        </span>
                      </td>
                      <td className="py-1.5 tnum">{money(r.priceCents)}</td>
                      <td className="py-1.5 tnum text-amber-700">{money(r.feeCents)}</td>
                      <td className="py-1.5 tnum text-emerald-700">{money(r.refundCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-sm text-slate-800">
                合计退票费 <b className="tnum">{money(refundPreview.totalFeeCents)}</b>，实退{' '}
                <b className="tnum text-emerald-700">{money(refundPreview.totalRefundCents)}</b>
              </div>
              <p className="text-xs text-slate-500">
                退票原因将记录为「窗口代客退票」。退款按原支付渠道退回，现金收银订单将由窗口现场退还现金。
              </p>
            </div>
          )
        }
      />

      {/* 代客退票：勾选车票 */}
      {refundTarget && !refundPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="选择退票车票">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setRefundTarget(null)} />
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-pop max-h-[86vh] flex flex-col">
            <div className="flex items-center justify-between px-6 h-14 border-b border-[var(--border)]">
              <h3 className="text-base">代客退票 · {refundTarget.orderNo}</h3>
              <button type="button" aria-label="关闭" className="text-slate-400 hover:text-slate-700 text-xl leading-none" onClick={() => setRefundTarget(null)}>
                ×
              </button>
            </div>
            <div className="px-6 py-5 overflow-y-auto space-y-3">
              <p className="text-sm text-slate-700">勾选需要退票的车票（仅「已出票」状态可退）：</p>
              {refundableItems.length === 0 ? (
                <p className="text-sm text-amber-700">该订单没有可退车票（可能已退票、已改签或尚未出票）</p>
              ) : (
                <div className="rounded-lg border border-[var(--border)] divide-y divide-slate-100">
                  {refundableItems.map((it) => {
                    const checked = refundItemIds.includes(it.id);
                    return (
                      <label key={it.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-[var(--primary)]"
                          checked={checked}
                          onChange={() =>
                            setRefundItemIds((prev) => (prev.includes(it.id) ? prev.filter((x) => x !== it.id) : [...prev, it.id]))
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-slate-800">
                            {it.passengerName}
                            <span className="ml-2 text-xs text-slate-500">{it.seatClassLabel}</span>
                            <span className="ml-2 text-xs tnum text-slate-500">{it.seatNo}</span>
                          </span>
                          <span className="block text-[11px] text-slate-400 font-mono">{it.idCardMasked}</span>
                        </span>
                        <span className="text-sm tnum text-slate-800">{money(it.priceCents)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-6 h-16 flex items-center justify-end gap-3 border-t border-[var(--border)]">
              <button type="button" className="btn-ghost" onClick={() => setRefundTarget(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={refundItemIds.length === 0 || refundPreviewLoading}
                onClick={() => void previewRefund()}
              >
                {refundPreviewLoading ? '试算中…' : '退票试算'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
