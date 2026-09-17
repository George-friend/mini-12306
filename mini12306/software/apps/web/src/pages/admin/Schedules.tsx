/** 运行日与库存：按日期检索运行日，调整正晚点状态与席别票价 / 定员 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { addDays, seatClassStyle, today } from '../../lib/format';
import { ConfirmModal, Empty, ErrorBox, Field, Input, Modal, SectionTitle, Select, Spinner, Tag, useToast } from '../../components/ui';
import { cn } from '../../lib/cn';

interface InventoryRow {
  id: number;
  seatClass: string;
  seatClassLabel: string;
  priceCents: number;
  priceYuan: string;
  totalCount: number;
  soldCount: number;
  lockedCount: number;
  available: number;
}

interface ScheduleRow {
  id: number;
  trainNo: string;
  route: string;
  departTime: string;
  runDate: string;
  status: string;
  delayMinutes: number;
  note: string | null;
  inventory: InventoryRow[];
}

interface ScheduleListData {
  runDate: string;
  list: ScheduleRow[];
}

const STATUS_OPTIONS = [
  { value: 'NORMAL', label: '正点' },
  { value: 'DELAYED', label: '晚点' },
  { value: 'CANCELLED', label: '停运' },
];

function statusTone(status: string): string {
  if (status === 'NORMAL') return 'bg-emerald-50 text-emerald-700';
  if (status === 'DELAYED') return 'bg-amber-50 text-amber-700';
  return 'bg-red-50 text-red-600';
}

function statusText(s: ScheduleRow): string {
  if (s.status === 'DELAYED') return `晚点${s.delayMinutes}分`;
  if (s.status === 'CANCELLED') return '停运';
  return '正点';
}

interface InventoryDraft {
  priceYuan: string;
  totalCount: string;
}

interface StatusForm {
  status: string;
  delayMinutes: string;
  note: string;
}

/** 元字符串 → 分（四舍五入取整） */
function yuanToCents(input: string): number {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export default function Schedules() {
  const toast = useToast();
  const startDate = today();
  const dateOptions = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(startDate, i)), [startDate]);

  const [date, setDate] = useState(startDate);
  const [trainNo, setTrainNo] = useState('');
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const [drafts, setDrafts] = useState<Record<number, InventoryDraft>>({});
  const [savingInv, setSavingInv] = useState<number | null>(null);

  const [statusTarget, setStatusTarget] = useState<ScheduleRow | null>(null);
  const [statusForm, setStatusForm] = useState<StatusForm>({ status: 'NORMAL', delayMinutes: '0', note: '' });
  const [statusError, setStatusError] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<ScheduleRow | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const load = useCallback(
    async (d: string, kw: string) => {
      setLoading(true);
      setError('');
      try {
        const res = await api.get<ScheduleListData>(`/admin/schedules?date=${encodeURIComponent(d)}&trainNo=${encodeURIComponent(kw.trim())}`);
        setRows(res.list);
        const init: Record<number, InventoryDraft> = {};
        res.list.forEach((s) =>
          s.inventory.forEach((i) => {
            init[i.id] = { priceYuan: i.priceYuan, totalCount: String(i.totalCount) };
          }),
        );
        setDrafts(init);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败');
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(date, trainNo);
  }, [date, trainNo, load]);

  const summary = useMemo(() => {
    const inv = rows.flatMap((r) => r.inventory);
    return {
      trainCount: rows.length,
      totalSeats: inv.reduce((s, i) => s + i.totalCount, 0),
      sold: inv.reduce((s, i) => s + i.soldCount, 0),
      locked: inv.reduce((s, i) => s + i.lockedCount, 0),
      abnormal: rows.filter((r) => r.status !== 'NORMAL').length,
    };
  }, [rows]);

  function shiftDate(days: number) {
    const next = addDays(date, days);
    if (next < startDate || next > dateOptions[dateOptions.length - 1]) return;
    setDate(next);
  }

  function setDraft(id: number, patch: Partial<InventoryDraft>) {
    setDrafts((prev) => {
      const base: InventoryDraft = prev[id] ?? { priceYuan: '', totalCount: '' };
      return { ...prev, [id]: { ...base, ...patch } };
    });
  }

  async function saveInventory(inv: InventoryRow) {
    const draft = drafts[inv.id];
    if (!draft) return;
    const priceCents = yuanToCents(draft.priceYuan);
    const totalCount = Number.parseInt(draft.totalCount, 10);
    if (priceCents <= 0) {
      toast.error('票价必须大于 0 元');
      return;
    }
    if (!Number.isInteger(totalCount) || totalCount < 0) {
      toast.error('定员必须为非负整数');
      return;
    }
    if (priceCents === inv.priceCents && totalCount === inv.totalCount) {
      toast.info('未检测到修改');
      return;
    }
    setSavingInv(inv.id);
    try {
      await api.put<InventoryRow>(`/admin/inventory/${inv.id}`, { priceCents, totalCount });
      toast.success(`${inv.seatClassLabel} 已保存：票价 ￥${(priceCents / 100).toFixed(2)}、定员 ${totalCount}`);
      await load(date, trainNo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingInv(null);
    }
  }

  function openStatus(s: ScheduleRow) {
    setStatusTarget(s);
    setStatusForm({ status: s.status, delayMinutes: String(s.delayMinutes), note: s.note ?? '' });
    setStatusError('');
  }

  async function submitStatus() {
    if (!statusTarget) return;
    const delayMinutes = Number.parseInt(statusForm.delayMinutes, 10);
    if (!Number.isInteger(delayMinutes) || delayMinutes < 0) {
      setStatusError('晚点分钟数必须为非负整数');
      return;
    }
    setStatusSaving(true);
    setStatusError('');
    try {
      await api.put<ScheduleRow>(`/admin/schedules/${statusTarget.id}`, {
        status: statusForm.status,
        delayMinutes: statusForm.status === 'DELAYED' ? delayMinutes : 0,
        note: statusForm.note.slice(0, 200),
      });
      toast.success(`${statusTarget.trainNo}（${statusTarget.runDate}）运行日状态已更新`);
      setStatusTarget(null);
      await load(date, trainNo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '更新失败';
      setStatusError(msg);
      toast.error(msg);
    } finally {
      setStatusSaving(false);
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelLoading(true);
    try {
      await api.put<ScheduleRow>(`/admin/schedules/${cancelTarget.id}`, {
        status: 'CANCELLED',
        delayMinutes: 0,
        note: cancelTarget.note ?? '管理员手动停运',
      });
      toast.success(`${cancelTarget.trainNo}（${cancelTarget.runDate}）已停运，建议同时发布停运公告`);
      setCancelTarget(null);
      await load(date, trainNo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '停运失败');
    } finally {
      setCancelLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="运行日与库存"
        desc={`可维护今天起 14 天内的运行日（${startDate} ~ ${dateOptions[dateOptions.length - 1]}）；票价以元输入、以分提交`}
        extra={
          <button type="button" className="btn-sm btn-ghost" onClick={() => void load(date, trainNo)} disabled={loading}>
            刷新
          </button>
        }
      />

      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-sm btn-ghost" onClick={() => shiftDate(-1)} disabled={date <= startDate}>
            ← 前一天
          </button>
          <Field label="运行日期">
            <Input
              type="date"
              className="w-40"
              value={date}
              min={startDate}
              max={dateOptions[dateOptions.length - 1]}
              onChange={(e) => setDate(e.target.value || startDate)}
            />
          </Field>
          <button
            type="button"
            className="btn-sm btn-ghost mt-5"
            onClick={() => shiftDate(1)}
            disabled={date >= dateOptions[dateOptions.length - 1]}
          >
            后一天 →
          </button>
          <Field label="车次号关键字">
            <Input
              className="w-40"
              placeholder="如 G1"
              value={trainNo}
              onChange={(e) => setTrainNo(e.target.value.toUpperCase())}
              aria-label="车次号关键字"
            />
          </Field>
          <button type="button" className="btn-sm btn-primary mt-5" onClick={() => setDate(startDate)}>
            回到今天
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {dateOptions.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDate(d)}
              className={cn(
                'shrink-0 px-2.5 h-8 rounded-lg text-xs tnum border transition-colors',
                d === date ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-[var(--border)] hover:bg-slate-50',
              )}
            >
              {d.slice(5)}
            </button>
          ))}
        </div>

        {!loading && !error && rows.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 border-t border-[var(--border)] pt-3">
            <span>
              运行日 <b className="tnum text-slate-700">{summary.trainCount}</b> 个
            </span>
            <span>
              定员合计 <b className="tnum text-slate-700">{summary.totalSeats}</b>
            </span>
            <span>
              已售 <b className="tnum text-slate-700">{summary.sold}</b>
            </span>
            <span>
              已锁定 <b className="tnum text-slate-700">{summary.locked}</b>
            </span>
            <span>
              非正点 <b className={cn('tnum', summary.abnormal > 0 ? 'text-amber-600' : 'text-slate-700')}>{summary.abnormal}</b> 个
            </span>
          </div>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load(date, trainNo)} />}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner label="正在加载运行日…" />
        ) : rows.length === 0 ? (
          <Empty
            title={`${date} 暂无运行日`}
            hint="请前往「车次管理」为该车次批量生成运行日，或切换其他日期查看。"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <th className="th w-10" aria-label="展开" />
                  <th className="th">车次号</th>
                  <th className="th">区间</th>
                  <th className="th">发车时刻</th>
                  <th className="th">状态</th>
                  <th className="th">备注</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const isOpen = expanded === s.id;
                  return (
                    <Fragment key={s.id}>
                      <tr className="hover:bg-slate-50/70">
                        <td className="td">
                          <button
                            type="button"
                            className="w-6 h-6 rounded-md border border-[var(--border)] text-slate-500 hover:bg-slate-100"
                            aria-expanded={isOpen}
                            aria-label={isOpen ? '收起席别库存' : '展开席别库存'}
                            onClick={() => setExpanded(isOpen ? null : s.id)}
                          >
                            {isOpen ? '−' : '+'}
                          </button>
                        </td>
                        <td className="td font-medium text-slate-800 tnum">{s.trainNo}</td>
                        <td className="td text-slate-700 whitespace-nowrap">{s.route}</td>
                        <td className="td tnum text-slate-600">{s.departTime}</td>
                        <td className="td">
                          <Tag className={statusTone(s.status)}>{statusText(s)}</Tag>
                        </td>
                        <td className="td text-slate-500 max-w-[14rem] truncate" title={s.note ?? ''}>
                          {s.note || '--'}
                        </td>
                        <td className="td">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <button type="button" className="btn-sm btn-ghost" onClick={() => openStatus(s)}>
                              修改状态
                            </button>
                            {s.status === 'CANCELLED' ? (
                              <button
                                type="button"
                                className="btn-sm btn-ghost"
                                onClick={() => {
                                  setStatusTarget(s);
                                  setStatusForm({ status: 'NORMAL', delayMinutes: '0', note: '' });
                                  setStatusError('');
                                }}
                              >
                                恢复正点
                              </button>
                            ) : (
                              <button type="button" className="btn-sm btn-danger" onClick={() => setCancelTarget(s)}>
                                停运
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td className="td" colSpan={7}>
                            <div className="text-xs text-slate-500 mb-2">
                              {s.trainNo} · {s.runDate} · {s.route} · 席别库存（行内编辑后点击「保存」提交）
                            </div>
                            <div className="bg-white rounded-lg border border-[var(--border)] overflow-x-auto">
                              <table className="w-full min-w-[720px]">
                                <thead>
                                  <tr>
                                    <th className="th">席别</th>
                                    <th className="th">票价（元）</th>
                                    <th className="th">定员</th>
                                    <th className="th">已售</th>
                                    <th className="th">已锁定</th>
                                    <th className="th">余票</th>
                                    <th className="th text-right">操作</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {s.inventory.map((inv) => {
                                    const draft = drafts[inv.id] ?? { priceYuan: inv.priceYuan, totalCount: String(inv.totalCount) };
                                    const dirty = yuanToCents(draft.priceYuan) !== inv.priceCents || Number.parseInt(draft.totalCount, 10) !== inv.totalCount;
                                    const floorCount = inv.soldCount + inv.lockedCount;
                                    return (
                                      <tr key={inv.id}>
                                        <td className="td">
                                          <Tag className={seatClassStyle(inv.seatClass)}>{inv.seatClassLabel}</Tag>
                                        </td>
                                        <td className="td">
                                          <Input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            className="w-28 h-8"
                                            value={draft.priceYuan}
                                            aria-label={`${inv.seatClassLabel} 票价（元）`}
                                            onChange={(e) => setDraft(inv.id, { priceYuan: e.target.value })}
                                          />
                                        </td>
                                        <td className="td">
                                          <Input
                                            type="number"
                                            min={floorCount}
                                            className="w-24 h-8"
                                            value={draft.totalCount}
                                            aria-label={`${inv.seatClassLabel} 定员`}
                                            onChange={(e) => setDraft(inv.id, { totalCount: e.target.value })}
                                          />
                                          <span className="ml-2 text-[11px] text-slate-400">≥ {floorCount}</span>
                                        </td>
                                        <td className="td tnum text-slate-600">{inv.soldCount}</td>
                                        <td className="td tnum text-slate-600">{inv.lockedCount}</td>
                                        <td className={cn('td tnum font-medium', inv.available > 0 ? 'text-emerald-600' : 'text-slate-400')}>
                                          {inv.available}
                                        </td>
                                        <td className="td">
                                          <div className="flex items-center justify-end gap-2">
                                            <button
                                              type="button"
                                              className="btn-sm btn-primary"
                                              disabled={!dirty || savingInv === inv.id}
                                              onClick={() => void saveInventory(inv)}
                                            >
                                              {savingInv === inv.id ? '保存中…' : '保存'}
                                            </button>
                                            <button
                                              type="button"
                                              className="btn-sm btn-ghost"
                                              disabled={!dirty}
                                              onClick={() => setDraft(inv.id, { priceYuan: inv.priceYuan, totalCount: String(inv.totalCount) })}
                                            >
                                              还原
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!statusTarget}
        title={`修改运行日状态 · ${statusTarget?.trainNo ?? ''}`}
        onClose={() => setStatusTarget(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setStatusTarget(null)} disabled={statusSaving}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => void submitStatus()} disabled={statusSaving}>
              {statusSaving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="运行状态" required>
            <Select value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {statusForm.status === 'DELAYED' && (
            <Field label="晚点分钟数" required hint="将展示为「晚点 N 分」">
              <Input
                type="number"
                min={0}
                value={statusForm.delayMinutes}
                onChange={(e) => setStatusForm({ ...statusForm, delayMinutes: e.target.value })}
              />
            </Field>
          )}
          <Field label="备注" hint="最多 200 字，将展示在旅客端车次卡片上">
            <Input maxLength={200} value={statusForm.note} onChange={(e) => setStatusForm({ ...statusForm, note: e.target.value })} />
          </Field>
          <p className="text-xs text-slate-500 leading-relaxed">
            运行日为「停运」时该车次不可购票；如需同步告知旅客，请到「公告管理」发布晚点 / 停运公告。
          </p>
          {statusError && <p className="text-sm text-red-600">{statusError}</p>}
        </div>
      </Modal>

      <ConfirmModal
        open={!!cancelTarget}
        title="停运运行日"
        danger
        confirmText="确认停运"
        loading={cancelLoading}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => void confirmCancel()}
        content={
          <>
            确定将 <b>{cancelTarget?.trainNo}</b>（{cancelTarget?.runDate} {cancelTarget?.departTime}）设为「停运」吗？
            <br />
            停运后该运行日不可继续购票，已购票旅客需人工办理退票或改签。
          </>
        }
      />
    </div>
  );
}
