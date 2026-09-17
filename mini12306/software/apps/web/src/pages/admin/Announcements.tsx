/** 公告管理：发布 / 编辑 / 下架 / 删除公告，晚点与停运公告可联动运行日状态 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { ConfirmModal, Empty, ErrorBox, Field, Input, Modal, SectionTitle, Select, Spinner, Tag, useToast } from '../../components/ui';

interface Announcement {
  id: number;
  title: string;
  content: string;
  type: string;
  trainNo: string | null;
  runDate: string | null;
  status: string;
  publisherId: number | null;
  publishedAt: string | null;
  createdAt: string;
}

interface AnnouncementListData {
  list: Announcement[];
}

const TYPE_OPTIONS = [
  { value: 'SYSTEM', label: '系统公告' },
  { value: 'DELAY', label: '晚点通知' },
  { value: 'CANCEL', label: '停运通知' },
  { value: 'NOTICE', label: '出行提示' },
];

const TYPE_TONE: Record<string, string> = {
  SYSTEM: 'bg-brand-50 text-brand-700',
  DELAY: 'bg-amber-50 text-amber-700',
  CANCEL: 'bg-red-50 text-red-600',
  NOTICE: 'bg-sky-50 text-sky-700',
};

const STATUS_TONE: Record<string, string> = {
  PUBLISHED: 'bg-emerald-50 text-emerald-700',
  DRAFT: 'bg-slate-100 text-slate-600',
  OFFLINE: 'bg-slate-100 text-slate-500',
};

function typeText(t: string): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

function statusText(s: string): string {
  if (s === 'PUBLISHED') return '已发布';
  if (s === 'DRAFT') return '草稿';
  if (s === 'OFFLINE') return '已下架';
  return s;
}

interface PublishForm {
  title: string;
  content: string;
  type: string;
  trainNo: string;
  runDate: string;
  syncSchedule: boolean;
}

const EMPTY_FORM: PublishForm = { title: '', content: '', type: 'NOTICE', trainNo: '', runDate: '', syncSchedule: false };

interface EditForm {
  title: string;
  content: string;
  status: string;
}

export default function AdminAnnouncements() {
  const toast = useToast();
  const [rows, setRows] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [publishOpen, setPublishOpen] = useState(false);
  const [form, setForm] = useState<PublishForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<Announcement | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ title: '', content: '', status: 'PUBLISHED' });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [offlineTarget, setOfflineTarget] = useState<Announcement | null>(null);
  const [offlineLoading, setOfflineLoading] = useState(false);

  const [removing, setRemoving] = useState<Announcement | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<AnnouncementListData>('/admin/announcements');
      setRows(res.list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const syncVisible = form.type === 'DELAY' || form.type === 'CANCEL';

  async function submitPublish() {
    const title = form.title.trim();
    const content = form.content.trim();
    if (title.length < 2 || title.length > 60) {
      setFormError('标题需 2~60 个字符');
      return;
    }
    if (content.length < 2 || content.length > 500) {
      setFormError('正文需 2~500 个字符');
      return;
    }
    if (form.syncSchedule && !syncVisible) {
      setFormError('仅晚点 / 停运公告支持联动运行日状态');
      return;
    }
    if (form.syncSchedule && (!form.trainNo.trim() || !form.runDate)) {
      setFormError('联动运行日状态需同时填写车次号与运行日期');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api.post<Announcement>('/admin/announcements', {
        title,
        content,
        type: form.type,
        trainNo: form.trainNo.trim().toUpperCase(),
        runDate: form.runDate,
        syncSchedule: syncVisible ? form.syncSchedule : false,
      });
      toast.success(form.syncSchedule ? '公告已发布，并已同步更新该运行日状态' : '公告已发布');
      setPublishOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '发布失败';
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  function openEdit(a: Announcement) {
    setEditTarget(a);
    setEditForm({ title: a.title, content: a.content, status: a.status });
    setEditError('');
  }

  async function submitEdit() {
    if (!editTarget) return;
    if (editForm.title.trim().length < 2) {
      setEditError('标题至少 2 个字符');
      return;
    }
    if (editForm.content.trim().length < 2) {
      setEditError('正文至少 2 个字符');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      await api.put<Announcement>(`/admin/announcements/${editTarget.id}`, {
        title: editForm.title.trim(),
        content: editForm.content.trim(),
        status: editForm.status,
      });
      toast.success('公告已更新');
      setEditTarget(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '更新失败';
      setEditError(msg);
      toast.error(msg);
    } finally {
      setEditSaving(false);
    }
  }

  async function confirmOffline() {
    if (!offlineTarget) return;
    setOfflineLoading(true);
    try {
      await api.put<Announcement>(`/admin/announcements/${offlineTarget.id}`, { status: 'OFFLINE' });
      toast.success('公告已下架，旅客端将不再展示');
      setOfflineTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '下架失败');
    } finally {
      setOfflineLoading(false);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveLoading(true);
    try {
      await api.del<null>(`/admin/announcements/${removing.id}`);
      toast.success('公告已删除');
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
        title="公告管理"
        desc="发布系统公告、晚点 / 停运通知与出行提示；晚点与停运公告可联动更新对应运行日状态"
        extra={
          <div className="flex items-center gap-2">
            <button type="button" className="btn-sm btn-ghost" onClick={() => void load()} disabled={loading}>
              刷新
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => {
                setForm(EMPTY_FORM);
                setFormError('');
                setPublishOpen(true);
              }}
            >
              发布公告
            </button>
          </div>
        }
      />

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner label="正在加载公告…" />
        ) : rows.length === 0 ? (
          <Empty
            title="暂无公告"
            hint="点击右上角「发布公告」创建第一条系统公告或出行提示"
            action={
              <button type="button" className="btn-primary btn-sm" onClick={() => setPublishOpen(true)}>
                发布公告
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr>
                  <th className="th">标题</th>
                  <th className="th">类型</th>
                  <th className="th">关联车次</th>
                  <th className="th">运行日期</th>
                  <th className="th">状态</th>
                  <th className="th">发布时间</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/70">
                    <td className="td max-w-[22rem]">
                      <div className="font-medium text-slate-800 truncate" title={a.title}>
                        {a.title}
                      </div>
                      <div className="text-xs text-slate-500 truncate" title={a.content}>
                        {a.content}
                      </div>
                    </td>
                    <td className="td">
                      <Tag className={TYPE_TONE[a.type] ?? 'bg-slate-100 text-slate-600'}>{typeText(a.type)}</Tag>
                    </td>
                    <td className="td tnum text-slate-700">{a.trainNo || '--'}</td>
                    <td className="td tnum text-slate-700">{a.runDate || '--'}</td>
                    <td className="td">
                      <Tag className={STATUS_TONE[a.status] ?? 'bg-slate-100 text-slate-600'}>{statusText(a.status)}</Tag>
                    </td>
                    <td className="td text-xs text-slate-500 tnum">{dateTime(a.publishedAt ?? a.createdAt)}</td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                        <button type="button" className="btn-sm btn-ghost" onClick={() => openEdit(a)}>
                          编辑
                        </button>
                        {a.status === 'PUBLISHED' ? (
                          <button type="button" className="btn-sm btn-ghost" onClick={() => setOfflineTarget(a)}>
                            下架
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-sm btn-ghost"
                            onClick={async () => {
                              try {
                                await api.put<Announcement>(`/admin/announcements/${a.id}`, { status: 'PUBLISHED' });
                                toast.success('公告已重新发布');
                                await load();
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : '发布失败');
                              }
                            }}
                          >
                            重新发布
                          </button>
                        )}
                        <button type="button" className="btn-sm btn-danger" onClick={() => setRemoving(a)}>
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
        open={publishOpen}
        title="发布公告"
        onClose={() => setPublishOpen(false)}
        width="max-w-2xl"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setPublishOpen(false)} disabled={saving}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => void submitPublish()} disabled={saving}>
              {saving ? '发布中…' : '立即发布'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="标题" required hint={`${form.title.length}/60`}>
            <Input maxLength={60} value={form.title} placeholder="G101 因设备检修预计晚点 20 分钟" onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="正文" required hint={`${form.content.length}/500`}>
            <textarea
              className="input h-28 py-2 leading-relaxed resize-y"
              maxLength={500}
              value={form.content}
              placeholder="请填写面向旅客的完整说明，例如影响范围、办理方式与咨询渠道。"
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="公告类型" required>
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, syncSchedule: false })}>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="关联车次号（选填）" hint="如 G101">
              <Input maxLength={8} value={form.trainNo} placeholder="G101" onChange={(e) => setForm({ ...form, trainNo: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="运行日期（选填）">
              <Input type="date" value={form.runDate} onChange={(e) => setForm({ ...form, runDate: e.target.value })} />
            </Field>
          </div>

          {syncVisible && (
            <label className="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-slate-50 px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 accent-[var(--primary)]"
                checked={form.syncSchedule}
                onChange={(e) => setForm({ ...form, syncSchedule: e.target.checked })}
              />
              <span className="text-sm text-slate-700">
                同时更新该运行日状态
                <span className="block text-xs text-slate-500 mt-0.5">
                  勾选后，发布{form.type === 'CANCEL' ? '停运' : '晚点'}公告将把「车次号 + 运行日期」对应的运行日状态同步更新为
                  {form.type === 'CANCEL' ? '「停运」' : '「晚点」'}，需同时填写车次号与运行日期。
                </span>
              </span>
            </label>
          )}

          {formError && <p className="text-sm text-red-600">{formError}</p>}
        </div>
      </Modal>

      <Modal
        open={!!editTarget}
        title={`编辑公告 · #${editTarget?.id ?? ''}`}
        onClose={() => setEditTarget(null)}
        width="max-w-2xl"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setEditTarget(null)} disabled={editSaving}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => void submitEdit()} disabled={editSaving}>
              {editSaving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="标题" required>
            <Input maxLength={60} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
          </Field>
          <Field label="正文" required>
            <textarea
              className="input h-28 py-2 leading-relaxed resize-y"
              maxLength={500}
              value={editForm.content}
              onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
            />
          </Field>
          <Field label="发布状态" hint="选「已下架」可让公告在旅客端不再展示">
            <Select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
              <option value="PUBLISHED">已发布</option>
              <option value="DRAFT">草稿</option>
              <option value="OFFLINE">已下架</option>
            </Select>
          </Field>
          {editTarget && (
            <p className="text-xs text-slate-500">
              关联车次 {editTarget.trainNo || '--'} · 运行日期 {editTarget.runDate || '--'}（类型与关联信息发布后不可修改）
            </p>
          )}
          {editError && <p className="text-sm text-red-600">{editError}</p>}
        </div>
      </Modal>

      <ConfirmModal
        open={!!offlineTarget}
        title="下架公告"
        danger
        confirmText="确认下架"
        loading={offlineLoading}
        onClose={() => setOfflineTarget(null)}
        onConfirm={() => void confirmOffline()}
        content={
          <>
            确定下架公告 <b>{offlineTarget?.title}</b> 吗？下架后旅客端公告列表将不再展示，可随时重新发布。
          </>
        }
      />

      <ConfirmModal
        open={!!removing}
        title="删除公告"
        danger
        confirmText="确认删除"
        loading={removeLoading}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
        content={
          <>
            确定删除公告 <b>{removing?.title}</b> 吗？该操作不可恢复，如需保留记录请改用「下架」。
          </>
        }
      />
    </div>
  );
}
