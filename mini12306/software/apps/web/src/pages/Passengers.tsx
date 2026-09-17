/** 乘车人管理：列表、新增/编辑弹窗与删除二次确认 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { cn } from '../lib/cn';
import { ConfirmModal, Empty, ErrorBox, Field, Input, Modal, Select, Spinner, Tag, useToast } from '../components/ui';

/* ── 接口类型 ─────────────────────────────────────────────── */

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

interface FormState {
  name: string;
  idCardNo: string;
  phone: string;
  passengerType: string;
  isDefault: boolean;
}

type FieldKey = keyof FormState;

const INITIAL_FORM: FormState = { name: '', idCardNo: '', phone: '', passengerType: 'ADULT', isDefault: false };

const TYPE_LABEL: Record<string, string> = { ADULT: '成人票', CHILD: '儿童票', STUDENT: '学生票' };
const TYPE_TONE: Record<string, string> = {
  ADULT: 'bg-slate-100 text-slate-700',
  CHILD: 'bg-sky-50 text-sky-700',
  STUDENT: 'bg-violet-50 text-violet-700',
};

/* ── 校验（与后端规则一致） ───────────────────────────────── */

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

function validateIdCardNo(input: string): string {
  const v = input.trim().toUpperCase();
  if (!v) return '请填写身份证号';
  if (!/^\d{17}[\dX]$/.test(v)) return '身份证号必须为 18 位，末位可为 X';
  const y = Number(v.slice(6, 10));
  const m = Number(v.slice(10, 12));
  const d = Number(v.slice(12, 14));
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '身份证号中的出生日期不合法';
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += Number(v[i]) * WEIGHTS[i];
  if (CHECK_CODES[sum % 11] !== v[17]) return '身份证号校验位不正确，请核对后重新输入';
  return '';
}

/* ── 页面 ─────────────────────────────────────────────────── */

export default function Passengers() {
  const toast = useToast();

  const [list, setList] = useState<Passenger[]>([]);
  const [max, setMax] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState<Passenger | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Passenger | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get<PassengerData>('/passengers');
      setList(d.list ?? []);
      setMax(d.max ?? 10);
    } catch (e: unknown) {
      setList([]);
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '乘车人加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const isEdit = editing !== null;

  const errors = useMemo(() => {
    const e: Partial<Record<FieldKey, string>> = {};
    const name = form.name.trim();
    if (!name) e.name = '请填写姓名';
    else if (name.length < 2 || name.length > 20) e.name = '姓名长度需为 2-20 个字符';
    if (!isEdit) {
      const idErr = validateIdCardNo(form.idCardNo);
      if (idErr) e.idCardNo = idErr;
    }
    const phone = form.phone.trim();
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) e.phone = '手机号格式不正确（应为 1 开头的 11 位数字）';
    return e;
  }, [form, isEdit]);

  const showError = (key: FieldKey): string | undefined => (touched[key] || submitted ? errors[key] : undefined);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...INITIAL_FORM, isDefault: list.length === 0 });
    setTouched({});
    setSubmitted(false);
    setModalOpen(true);
  };

  const openEdit = (p: Passenger) => {
    setEditing(p);
    setForm({ name: p.name, idCardNo: '', phone: p.phone ?? '', passengerType: p.passengerType, isDefault: p.isDefault });
    setTouched({});
    setSubmitted(false);
    setModalOpen(true);
  };

  const save = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) {
      toast.error('表单填写有误，请检查标红项');
      return;
    }
    setSaving(true);
    try {
      if (isEdit && editing) {
        await api.put(`/passengers/${editing.id}`, {
          name: form.name.trim(),
          phone: form.phone.trim(),
          passengerType: form.passengerType,
          isDefault: form.isDefault,
        });
        toast.success('乘车人信息已更新');
      } else {
        await api.post('/passengers', {
          name: form.name.trim(),
          idCardNo: form.idCardNo.trim().toUpperCase(),
          phone: form.phone.trim(),
          passengerType: form.passengerType,
          isDefault: form.isDefault,
        });
        toast.success('乘车人已添加');
      }
      setModalOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e: unknown) {
      toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del(`/passengers/${deleteTarget.id}`);
      toast.success('乘车人已删除');
      setDeleteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (e: unknown) {
      toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const reachLimit = list.length >= max;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg">乘车人管理</h1>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            已添加 <span className="tnum font-medium text-slate-700">{list.length}</span> / 上限{' '}
            <span className="tnum">{max}</span> 人 · 证件号加密存储、界面脱敏
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-sm btn-ghost" onClick={() => setReloadKey((k) => k + 1)}>
            刷新
          </button>
          <button type="button" className="btn-sm btn-primary" disabled={reachLimit} onClick={openCreate}>
            {reachLimit ? `已达上限（${max} 人）` : '新增乘车人'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card">
          <Spinner label="正在加载乘车人…" />
        </div>
      ) : error ? (
        <ErrorBox message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : list.length === 0 ? (
        <div className="card">
          <Empty
            title="还没有乘车人"
            hint="添加乘车人后即可为其购票，单笔订单最多可同时为 5 人购票，每张车票需对应一位乘车人。"
            action={
              <button type="button" className="btn-primary" onClick={openCreate}>
                添加第一位乘车人
              </button>
            }
          />
        </div>
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th">姓名</th>
                  <th className="th">证件号</th>
                  <th className="th">手机号</th>
                  <th className="th">票种</th>
                  <th className="th">默认</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td className="td font-medium text-slate-800">{p.name}</td>
                    <td className="td tnum text-slate-600">{p.idCardMasked}</td>
                    <td className="td tnum text-slate-600">{p.phone ?? '--'}</td>
                    <td className="td">
                      <Tag className={TYPE_TONE[p.passengerType] ?? 'bg-slate-100 text-slate-600'}>
                        {TYPE_LABEL[p.passengerType] ?? p.passengerType}
                      </Tag>
                    </td>
                    <td className="td">
                      {p.isDefault ? <Tag className="bg-brand-50 text-brand-700">默认</Tag> : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="td text-right whitespace-nowrap">
                      <button type="button" className="btn-sm btn-ghost" onClick={() => openEdit(p)}>
                        编辑
                      </button>
                      <button type="button" className="btn-sm btn-danger ml-2" onClick={() => setDeleteTarget(p)}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片 */}
          <ul className="md:hidden space-y-3">
            {list.map((p) => (
              <li key={p.id} className="card p-4">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">{p.name}</span>
                  <Tag className={TYPE_TONE[p.passengerType] ?? 'bg-slate-100 text-slate-600'}>
                    {TYPE_LABEL[p.passengerType] ?? p.passengerType}
                  </Tag>
                  {p.isDefault && <Tag className="bg-brand-50 text-brand-700">默认</Tag>}
                </div>
                <dl className="mt-2.5 space-y-1 text-xs text-[var(--fg-muted)]">
                  <div className="flex justify-between gap-3">
                    <dt>证件号</dt>
                    <dd className="tnum text-slate-600">{p.idCardMasked}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>手机号</dt>
                    <dd className="tnum text-slate-600">{p.phone ?? '--'}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn-sm btn-ghost flex-1" onClick={() => openEdit(p)}>
                    编辑
                  </button>
                  <button type="button" className="btn-sm btn-danger flex-1" onClick={() => setDeleteTarget(p)}>
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <p className="text-xs text-[var(--fg-muted)]">
            提示：存在未完成车票（待支付 / 已出票 / 退票中）的乘车人无法删除；如需变更证件号，请删除后重新添加。
            <Link to="/" className="ml-1 text-brand-700 hover:underline">
              去查询车次
            </Link>
          </p>
        </>
      )}

      {/* 新增 / 编辑 */}
      <Modal
        open={modalOpen}
        title={isEdit ? '编辑乘车人' : '新增乘车人'}
        onClose={() => {
          if (!saving) setModalOpen(false);
        }}
        footer={
          <>
            <button type="button" className="btn-ghost" disabled={saving} onClick={() => setModalOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="姓名" required hint="与证件一致的姓名" error={showError('name')}>
            <Input
              id="pax-name"
              aria-label="姓名"
              placeholder="如 张三"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            />
          </Field>

          <Field
            label="身份证号"
            required={!isEdit}
            hint={isEdit ? '证件号不可修改，如需变更请删除后重新添加' : '18 位，系统将校验出生日期与校验位'}
            error={showError('idCardNo')}
          >
            <Input
              id="pax-idcard"
              aria-label="身份证号"
              placeholder={isEdit ? `已绑定 ${editing?.idCardMasked ?? ''}` : '18 位身份证号'}
              disabled={isEdit}
              value={isEdit ? '' : form.idCardNo}
              onChange={(e) => setForm({ ...form, idCardNo: e.target.value })}
              onBlur={() => setTouched((t) => ({ ...t, idCardNo: true }))}
            />
          </Field>

          <Field label="手机号" hint="选填，用于接收行程通知" error={showError('phone')}>
            <Input
              id="pax-phone"
              aria-label="手机号"
              inputMode="numeric"
              placeholder="选填，11 位手机号"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
            />
          </Field>

          <Field label="票种" required hint="票种会按证件号年龄自动校正：未满 6 周岁免票、6-14 周岁为儿童票">
            <Select
              id="pax-type"
              aria-label="票种"
              value={form.passengerType}
              onChange={(e) => setForm({ ...form, passengerType: e.target.value })}
            >
              <option value="ADULT">成人票（全价）</option>
              <option value="CHILD">儿童票（5 折）</option>
              <option value="STUDENT">学生票（7.5 折，仅限二等座 / 硬座）</option>
            </Select>
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 accent-brand-600"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            设为默认乘车人
          </label>
        </div>
      </Modal>

      {/* 删除二次确认 */}
      <ConfirmModal
        open={deleteTarget !== null}
        title="删除乘车人"
        danger
        confirmText="确认删除"
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void doDelete()}
        content={
          <div className="space-y-2">
            <p>
              确认删除乘车人「<span className="font-medium">{deleteTarget?.name}</span>」（
              <span className="tnum">{deleteTarget?.idCardMasked}</span>）？
            </p>
            <p className="text-xs text-[var(--fg-muted)]">删除后该乘车人的历史订单不受影响，但需重新添加才能为其购票。</p>
          </div>
        }
      />

      <div className={cn('text-xs text-[var(--fg-muted)]', reachLimit && 'text-amber-600')}>
        {reachLimit ? `当前已添加 ${list.length} 人，达到上限 ${max} 人，如需继续添加请先删除部分乘车人。` : ''}
      </div>
    </div>
  );
}
