/** 车次管理：车次基础信息维护 + 批量生成运行日 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { addDays, durationText, money, today } from '../../lib/format';
import { ConfirmModal, Empty, ErrorBox, Field, Input, Modal, SectionTitle, Select, Spinner, Tag, useToast } from '../../components/ui';

interface TrainRow {
  id: number;
  trainNo: string;
  trainType: string;
  fromStation: string;
  toStation: string;
  departTime: string;
  arriveTime: string;
  durationMin: number;
  mileageKm: number;
  basePriceYuan: string;
  isActive: boolean;
  scheduleCount: number;
}

interface TrainListData {
  list: TrainRow[];
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

const TRAIN_TYPES = ['G', 'D', 'T', 'K', 'Z'] as const;

/** 车次类型徽标配色 */
const TYPE_TONE: Record<string, string> = {
  G: 'bg-brand-50 text-brand-700',
  D: 'bg-sky-50 text-sky-700',
  T: 'bg-violet-50 text-violet-700',
  K: 'bg-teal-50 text-teal-700',
  Z: 'bg-amber-50 text-amber-700',
};

interface TrainForm {
  trainNo: string;
  trainType: string;
  fromStationId: string;
  toStationId: string;
  departTime: string;
  arriveTime: string;
  durationMin: string;
  mileageKm: string;
  basePriceYuan: string;
}

const EMPTY_FORM: TrainForm = {
  trainNo: '',
  trainType: 'G',
  fromStationId: '',
  toStationId: '',
  departTime: '08:00',
  arriveTime: '12:00',
  durationMin: '240',
  mileageKm: '1000',
  basePriceYuan: '500.00',
};

/** 元字符串 → 分（四舍五入取整） */
function yuanToCents(input: string): number {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export default function Trains() {
  const toast = useToast();
  const [rows, setRows] = useState<TrainRow[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TrainRow | null>(null);
  const [form, setForm] = useState<TrainForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [genTarget, setGenTarget] = useState<TrainRow | null>(null);
  const [genStart, setGenStart] = useState(today());
  const [genEnd, setGenEnd] = useState(addDays(today(), 13));
  const [genError, setGenError] = useState('');
  const [genLoading, setGenLoading] = useState(false);

  const [removing, setRemoving] = useState<TrainRow | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [trains, stationData] = await Promise.all([
        api.get<TrainListData>('/admin/trains'),
        api.get<StationListData>('/stations'),
      ]);
      setRows(trains.list);
      setStations(stationData.list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toUpperCase();
    if (!kw) return rows;
    return rows.filter((t) => t.trainNo.includes(kw) || t.fromStation.includes(keyword.trim()) || t.toStation.includes(keyword.trim()));
  }, [rows, keyword]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, fromStationId: stations[0] ? String(stations[0].id) : '', toStationId: stations[1] ? String(stations[1].id) : '' });
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(t: TrainRow) {
    setEditing(t);
    setForm({
      trainNo: t.trainNo,
      trainType: t.trainType,
      fromStationId: '',
      toStationId: '',
      departTime: t.departTime,
      arriveTime: t.arriveTime,
      durationMin: String(t.durationMin),
      mileageKm: String(t.mileageKm),
      basePriceYuan: t.basePriceYuan,
    });
    setFormError('');
    setFormOpen(true);
  }

  async function submitForm() {
    const departTime = form.departTime.trim();
    const arriveTime = form.arriveTime.trim();
    const durationMin = Number.parseInt(form.durationMin, 10);
    const mileageKm = Number.parseInt(form.mileageKm, 10);
    const basePriceCents = yuanToCents(form.basePriceYuan);

    if (!/^\d{2}:\d{2}$/.test(departTime) || !/^\d{2}:\d{2}$/.test(arriveTime)) {
      setFormError('发车 / 到达时刻格式应为 HH:mm');
      return;
    }
    if (!Number.isInteger(durationMin) || durationMin <= 0 || !Number.isInteger(mileageKm) || mileageKm <= 0) {
      setFormError('历时与里程必须为正整数');
      return;
    }
    if (basePriceCents <= 0) {
      setFormError('基准价必须大于 0 元');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api.put<TrainRow>(`/admin/trains/${editing.id}`, {
          departTime,
          arriveTime,
          durationMin,
          mileageKm,
          basePriceCents,
          isActive: editing.isActive,
        });
        toast.success('车次已更新');
      } else {
        const trainNo = form.trainNo.trim().toUpperCase();
        if (!/^[A-Z0-9]{2,8}$/.test(trainNo)) {
          setFormError('车次号应为 2~8 位字母或数字，如 G101');
          setSaving(false);
          return;
        }
        if (!form.fromStationId || !form.toStationId) {
          setFormError('请选择出发站与到达站');
          setSaving(false);
          return;
        }
        if (form.fromStationId === form.toStationId) {
          setFormError('出发站与到达站不能相同');
          setSaving(false);
          return;
        }
        await api.post<TrainRow>('/admin/trains', {
          trainNo,
          trainType: form.trainType,
          fromStationId: Number(form.fromStationId),
          toStationId: Number(form.toStationId),
          departTime,
          arriveTime,
          durationMin,
          mileageKm,
          basePriceCents,
        });
        toast.success('车次已新增，可继续生成运行日');
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存失败';
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(t: TrainRow) {
    try {
      await api.put<TrainRow>(`/admin/trains/${t.id}`, { isActive: !t.isActive });
      toast.success(!t.isActive ? `车次 ${t.trainNo} 已启用` : `车次 ${t.trainNo} 已停用`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    }
  }

  async function submitGenerate() {
    if (!genTarget) return;
    if (genEnd < genStart) {
      setGenError('结束日期不能早于开始日期');
      return;
    }
    setGenLoading(true);
    setGenError('');
    try {
      const res = await api.post<{ created: number }>(`/admin/trains/${genTarget.id}/schedules`, { startDate: genStart, endDate: genEnd });
      toast.success(`${genTarget.trainNo} 已生成 ${res.created} 个运行日（含席别库存与票价）`);
      setGenTarget(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '生成失败';
      setGenError(msg);
      toast.error(msg);
    } finally {
      setGenLoading(false);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveLoading(true);
    try {
      await api.del<null>(`/admin/trains/${removing.id}`);
      toast.success('车次已删除');
      setRemoving(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setRemoveLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="车次管理"
        desc="维护车次号、发到时刻、里程与基准价；新增后可批量生成运行日与席别库存"
        extra={
          <div className="flex items-center gap-2">
            <Input
              className="w-36 sm:w-44"
              placeholder="车次号 / 车站"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              aria-label="搜索车次"
            />
            <button type="button" className="btn-primary btn-sm" onClick={openCreate} disabled={stations.length === 0}>
              新增车次
            </button>
          </div>
        }
      />

      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {stations.length === 0 && !loading && (
        <ErrorBox message="尚未维护车站字典，请先在「车站管理」中新增车站后再创建车次。" />
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner label="正在加载车次…" />
        ) : filtered.length === 0 ? (
          <Empty
            title={rows.length === 0 ? '暂无车次数据' : '没有匹配的车次'}
            hint={rows.length === 0 ? '请先新增车次，再为其批量生成运行日与席别库存' : '换一个车次号或站名关键字再试试'}
            action={
              rows.length === 0 ? (
                <button type="button" className="btn-primary btn-sm" onClick={openCreate} disabled={stations.length === 0}>
                  新增第一个车次
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px]">
              <thead>
                <tr>
                  <th className="th">车次号</th>
                  <th className="th">类型</th>
                  <th className="th">区间</th>
                  <th className="th">发车</th>
                  <th className="th">到达</th>
                  <th className="th">历时</th>
                  <th className="th">里程</th>
                  <th className="th">基准价</th>
                  <th className="th">运行日数</th>
                  <th className="th">状态</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/70">
                    <td className="td font-medium text-slate-800 tnum">{t.trainNo}</td>
                    <td className="td">
                      <Tag className={TYPE_TONE[t.trainType] ?? 'bg-slate-100 text-slate-600'}>{t.trainType}</Tag>
                    </td>
                    <td className="td text-slate-700 whitespace-nowrap">
                      {t.fromStation} → {t.toStation}
                    </td>
                    <td className="td tnum text-slate-600">{t.departTime}</td>
                    <td className="td tnum text-slate-600">{t.arriveTime}</td>
                    <td className="td text-slate-600 whitespace-nowrap">{durationText(t.durationMin)}</td>
                    <td className="td tnum text-slate-600">{t.mileageKm} km</td>
                    <td className="td tnum text-slate-800">{money(yuanToCents(t.basePriceYuan))}</td>
                    <td className="td tnum">
                      {t.scheduleCount > 0 ? (
                        <span className="text-slate-700">{t.scheduleCount}</span>
                      ) : (
                        <span className="text-amber-600">0（待生成）</span>
                      )}
                    </td>
                    <td className="td">
                      <Tag className={t.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}>
                        {t.isActive ? '启用' : '停用'}
                      </Tag>
                    </td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                        <button type="button" className="btn-sm btn-primary" onClick={() => setGenTarget(t)}>
                          生成运行日
                        </button>
                        <button type="button" className="btn-sm btn-ghost" onClick={() => openEdit(t)}>
                          编辑
                        </button>
                        <button type="button" className="btn-sm btn-ghost" onClick={() => void toggleActive(t)}>
                          {t.isActive ? '停用' : '启用'}
                        </button>
                        <button type="button" className="btn-sm btn-danger" onClick={() => setRemoving(t)}>
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={formOpen}
        title={editing ? `编辑车次 · ${editing.trainNo}` : '新增车次'}
        onClose={() => setFormOpen(false)}
        width="max-w-2xl"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => void submitForm()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="车次号" required hint={editing ? '车次号不可修改' : '如 G101 / K102'}>
            <Input
              value={form.trainNo}
              disabled={!!editing}
              maxLength={8}
              placeholder="G101"
              onChange={(e) => setForm({ ...form, trainNo: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="车次类型" required hint={editing ? '类型不可修改' : 'G/D 为动车组，其余为普速列车'}>
            <Select value={form.trainType} disabled={!!editing} onChange={(e) => setForm({ ...form, trainType: e.target.value })}>
              {TRAIN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          {!editing && (
            <>
              <Field label="出发站" required>
                <Select value={form.fromStationId} onChange={(e) => setForm({ ...form, fromStationId: e.target.value })}>
                  <option value="">请选择</option>
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}（{s.code}）
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="到达站" required>
                <Select value={form.toStationId} onChange={(e) => setForm({ ...form, toStationId: e.target.value })}>
                  <option value="">请选择</option>
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}（{s.code}）
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <Field label="发车时刻" required hint="格式 HH:mm">
            <Input value={form.departTime} placeholder="08:00" onChange={(e) => setForm({ ...form, departTime: e.target.value })} />
          </Field>
          <Field label="到达时刻" required hint="格式 HH:mm">
            <Input value={form.arriveTime} placeholder="12:28" onChange={(e) => setForm({ ...form, arriveTime: e.target.value })} />
          </Field>
          <Field label="历时（分钟）" required hint={Number.parseInt(form.durationMin, 10) > 0 ? durationText(Number.parseInt(form.durationMin, 10)) : undefined}>
            <Input type="number" min={1} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} />
          </Field>
          <Field label="里程（公里）" required>
            <Input type="number" min={1} value={form.mileageKm} onChange={(e) => setForm({ ...form, mileageKm: e.target.value })} />
          </Field>
          <Field label="基准价（元）" required hint={`提交为 ${yuanToCents(form.basePriceYuan)} 分（后端以分存储）`}>
            <Input type="number" min={0} step="0.01" value={form.basePriceYuan} onChange={(e) => setForm({ ...form, basePriceYuan: e.target.value })} />
          </Field>
        </div>
        {formError && <p className="mt-4 text-sm text-red-600">{formError}</p>}
      </Modal>

      <Modal
        open={!!genTarget}
        title={`批量生成运行日 · ${genTarget?.trainNo ?? ''}`}
        onClose={() => setGenTarget(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setGenTarget(null)} disabled={genLoading}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => void submitGenerate()} disabled={genLoading}>
              {genLoading ? '生成中…' : '生成运行日'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="开始日期" required>
            <Input type="date" value={genStart} onChange={(e) => setGenStart(e.target.value)} />
          </Field>
          <Field label="结束日期" required>
            <Input type="date" value={genEnd} onChange={(e) => setGenEnd(e.target.value)} />
          </Field>
        </div>
        <p className="mt-4 text-xs text-slate-500 leading-relaxed">
          将为区间内每个日期生成一个运行日，并按车次类型自动创建席别库存（含默认票价与定员）。已存在的运行日会自动跳过，单次最多 120 天。
        </p>
        {genError && <p className="mt-3 text-sm text-red-600">{genError}</p>}
      </Modal>

      <ConfirmModal
        open={!!removing}
        title="删除车次"
        danger
        confirmText="确认删除"
        loading={removeLoading}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
        content={
          <>
            确定删除车次 <b>{removing?.trainNo}</b>（{removing?.fromStation} → {removing?.toStation}）吗？
            <br />
            将同时删除其运行日与席别库存；若该车次已产生订单，后端会拒绝删除，建议改为「停用」。
          </>
        }
      />
    </div>
  );
}
