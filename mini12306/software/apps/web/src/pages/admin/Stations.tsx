/** 车站管理：新增 / 编辑 / 删除车站字典 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { ConfirmModal, Empty, ErrorBox, Field, Input, Modal, SectionTitle, Select, Spinner, Tag, useToast } from '../../components/ui';

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

interface StationForm {
  code: string;
  name: string;
  city: string;
  province: string;
  pinyin: string;
  isActive: boolean;
}

const EMPTY_FORM: StationForm = { code: '', name: '', city: '', province: '', pinyin: '', isActive: true };

export default function Stations() {
  const toast = useToast();
  const [rows, setRows] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');

  const [editing, setEditing] = useState<Station | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<StationForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [removing, setRemoving] = useState<Station | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<StationListData>('/admin/stations');
      setRows(data.list);
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
    const kw = keyword.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((s) =>
      [s.code, s.name, s.city, s.province, s.pinyin].some((v) => v.toLowerCase().includes(kw)),
    );
  }, [rows, keyword]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(s: Station) {
    setEditing(s);
    setForm({ code: s.code, name: s.name, city: s.city, province: s.province, pinyin: s.pinyin, isActive: s.isActive });
    setFormError('');
    setFormOpen(true);
  }

  async function submitForm() {
    const name = form.name.trim();
    const city = form.city.trim();
    const province = form.province.trim();
    const pinyin = form.pinyin.trim();
    if (!editing && !/^[A-Za-z]{2,6}$/.test(form.code.trim())) {
      setFormError('电报码为 2~6 位英文字母');
      return;
    }
    if (name.length < 2 || city.length < 2 || province.length < 2 || pinyin.length < 1) {
      setFormError('站名 / 城市 / 省份至少 2 字，拼音至少 1 位');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api.put<Station>(`/admin/stations/${editing.id}`, { name, city, province, pinyin, isActive: form.isActive });
        toast.success('车站已更新');
      } else {
        await api.post<Station>('/admin/stations', { code: form.code.trim().toUpperCase(), name, city, province, pinyin });
        toast.success('车站已新增');
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

  async function confirmRemove() {
    if (!removing) return;
    setRemoveLoading(true);
    try {
      await api.del<null>(`/admin/stations/${removing.id}`);
      toast.success('车站已删除');
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
        title="车站管理"
        desc="维护车站电报码、站名与所属城市；被车次引用的车站不可删除"
        extra={
          <div className="flex items-center gap-2">
            <Input
              className="w-40 sm:w-52"
              placeholder="搜索电报码/站名/拼音"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              aria-label="搜索车站"
            />
            <button type="button" className="btn-primary btn-sm" onClick={openCreate}>
              新增车站
            </button>
          </div>
        }
      />

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner label="正在加载车站…" />
        ) : filtered.length === 0 ? (
          <Empty
            title={rows.length === 0 ? '暂无车站数据' : '没有匹配的车站'}
            hint={rows.length === 0 ? '请先新增车站，之后才能在车次管理中作为出发站 / 到达站引用' : '换一个关键字再试试'}
            action={
              rows.length === 0 ? (
                <button type="button" className="btn-primary btn-sm" onClick={openCreate}>
                  新增第一个车站
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  <th className="th">电报码</th>
                  <th className="th">站名</th>
                  <th className="th">城市</th>
                  <th className="th">省份</th>
                  <th className="th">拼音</th>
                  <th className="th">状态</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    <td className="td font-mono text-xs text-slate-700">{s.code}</td>
                    <td className="td font-medium text-slate-800">{s.name}</td>
                    <td className="td text-slate-600">{s.city}</td>
                    <td className="td text-slate-600">{s.province}</td>
                    <td className="td text-slate-500 font-mono text-xs">{s.pinyin}</td>
                    <td className="td">
                      <Tag className={s.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}>
                        {s.isActive ? '启用' : '停用'}
                      </Tag>
                    </td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" className="btn-sm btn-ghost" onClick={() => openEdit(s)}>
                          编辑
                        </button>
                        <button type="button" className="btn-sm btn-danger" onClick={() => setRemoving(s)}>
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
        title={editing ? `编辑车站 · ${editing.name}` : '新增车站'}
        onClose={() => setFormOpen(false)}
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
          <Field label="电报码" required hint={editing ? '电报码不可修改' : '2~6 位英文字母，如 VNP'}>
            <Input
              value={form.code}
              disabled={!!editing}
              placeholder="VNP"
              maxLength={6}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="站名" required>
            <Input value={form.name} placeholder="北京南" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="所属城市" required>
            <Input value={form.city} placeholder="北京" onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label="所属省份" required>
            <Input value={form.province} placeholder="北京市" onChange={(e) => setForm({ ...form, province: e.target.value })} />
          </Field>
          <Field label="拼音" required hint="用于拼音检索，全小写不带空格">
            <Input value={form.pinyin} placeholder="beijingnan" onChange={(e) => setForm({ ...form, pinyin: e.target.value })} />
          </Field>
          {editing && (
            <Field label="状态">
              <Select value={form.isActive ? 'true' : 'false'} onChange={(e) => setForm({ ...form, isActive: e.target.value === 'true' })}>
                <option value="true">启用</option>
                <option value="false">停用</option>
              </Select>
            </Field>
          )}
        </div>
        {formError && <p className="mt-4 text-sm text-red-600">{formError}</p>}
      </Modal>

      <ConfirmModal
        open={!!removing}
        title="删除车站"
        danger
        confirmText="确认删除"
        loading={removeLoading}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
        content={
          <>
            确定删除车站 <b>{removing?.name}</b>（{removing?.code}）吗？该操作不可恢复。
            <br />
            若该车站已被车次引用，后端将拒绝删除并提示引用数量。
          </>
        }
      />
    </div>
  );
}
