/** 系统设置：按分组展示运行参数，逐行修改并保存（修改实时生效并记录审计日志） */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { Empty, ErrorBox, Input, SectionTitle, Select, Spinner, Tag, useToast } from '../../components/ui';
import { cn } from '../../lib/cn';

interface SettingRow {
  key: string;
  value: string;
  valueType: string;
  description: string;
  groupName: string;
  updatedBy: number | null;
  updatedAt: string;
}

interface SettingListData {
  list: SettingRow[];
}

const GROUP_LABEL: Record<string, string> = {
  order: '订单与支付',
  ticket: '车票与退票',
  auth: '认证与登录',
  user: '用户与乘车人',
  sms: '短信通知',
  system: '系统通用',
};

const GROUP_DESC: Record<string, string> = {
  order: '下单张数、待支付订单上限与支付时限',
  ticket: '购票截止时间与退票费规则',
  auth: '登录失败锁定与实名核验策略',
  user: '乘车人数量上限等账号级限制',
  sms: '验证码有效期与重发间隔',
};

const VALUE_TYPE_LABEL: Record<string, string> = { INT: '整数', BOOL: '布尔', STRING: '文本' };

export default function Settings() {
  const toast = useToast();
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<SettingListData>('/admin/settings');
      setRows(res.list);
      const init: Record<string, string> = {};
      res.list.forEach((s) => {
        init[s.key] = s.value;
      });
      setDrafts(init);
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

  const groups = useMemo(() => {
    const map = new Map<string, SettingRow[]>();
    rows.forEach((r) => {
      const list = map.get(r.groupName) ?? [];
      list.push(r);
      map.set(r.groupName, list);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  async function save(row: SettingRow) {
    const value = (drafts[row.key] ?? row.value).trim();
    if (row.valueType === 'INT' && !/^\d+$/.test(value)) {
      toast.error(`${row.description}：必须为非负整数`);
      return;
    }
    if (row.valueType === 'BOOL' && !['true', 'false'].includes(value)) {
      toast.error(`${row.description}：必须为 true 或 false`);
      return;
    }
    if (value === row.value) {
      toast.info('参数值未发生变化');
      return;
    }
    setSavingKey(row.key);
    try {
      const updated = await api.put<SettingRow>(`/admin/settings/${encodeURIComponent(row.key)}`, { value });
      toast.success('已保存，立即生效');
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, ...updated, value: updated.value ?? value } : r)));
      setDrafts((prev) => ({ ...prev, [row.key]: updated.value ?? value }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) return <Spinner label="正在加载系统参数…" />;
  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="系统设置"
        desc="以下参数控制支付时限、退票费下限、购票截止时间等业务规则"
        extra={
          <button type="button" className="btn-sm btn-ghost" onClick={() => void load()}>
            重新加载
          </button>
        }
      />

      <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 leading-relaxed">
        提示：这些参数控制<strong>支付时限、退票费下限、购票截止时间</strong>等核心业务规则，修改后<strong>实时生效</strong>（无需重启服务），
        每次修改都会写入审计日志（动作 <code className="font-mono text-xs">UPDATE_SETTING</code>）。
      </div>

      {groups.length === 0 ? (
        <div className="card">
          <Empty title="暂无可配置参数" hint="系统参数表为空，请确认后端初始化脚本已执行" />
        </div>
      ) : (
        groups.map(([groupName, list]) => (
          <section key={groupName} className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-end justify-between gap-4">
              <div>
                <h3 className="text-base">{GROUP_LABEL[groupName] ?? groupName}</h3>
                <p className="text-xs text-[var(--fg-muted)] mt-1">{GROUP_DESC[groupName] ?? '分组参数'}</p>
              </div>
              <span className="text-xs text-slate-400">组标识 {groupName}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr>
                    <th className="th">参数说明</th>
                    <th className="th">参数 key</th>
                    <th className="th w-64">当前值</th>
                    <th className="th">最近更新</th>
                    <th className="th text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => {
                    const draft = drafts[row.key] ?? row.value;
                    const dirty = draft.trim() !== row.value;
                    return (
                      <tr key={row.key} className="hover:bg-slate-50/70">
                        <td className="td">
                          <div className="text-slate-800">{row.description}</div>
                          <div className="mt-1">
                            <Tag className="bg-slate-100 text-slate-600">{VALUE_TYPE_LABEL[row.valueType] ?? row.valueType}</Tag>
                          </div>
                        </td>
                        <td className="td">
                          <code className="font-mono text-xs text-slate-600">{row.key}</code>
                        </td>
                        <td className="td">
                          {row.valueType === 'BOOL' ? (
                            <Select
                              className="w-32"
                              aria-label={row.description}
                              value={draft === 'true' ? 'true' : 'false'}
                              onChange={(e) => setDrafts((prev) => ({ ...prev, [row.key]: e.target.value }))}
                            >
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </Select>
                          ) : row.valueType === 'INT' ? (
                            <Input
                              type="number"
                              min={0}
                              className="w-32"
                              aria-label={row.description}
                              value={draft}
                              onChange={(e) => setDrafts((prev) => ({ ...prev, [row.key]: e.target.value }))}
                            />
                          ) : (
                            <Input
                              className="w-full"
                              aria-label={row.description}
                              value={draft}
                              onChange={(e) => setDrafts((prev) => ({ ...prev, [row.key]: e.target.value }))}
                            />
                          )}
                          {dirty && <p className="mt-1 text-[11px] text-amber-600">已修改，尚未保存</p>}
                        </td>
                        <td className="td text-xs text-slate-500 tnum">
                          {dateTime(row.updatedAt)}
                          <div className="text-[11px] text-slate-400">{row.updatedBy ? `操作人 ID ${row.updatedBy}` : '系统初始化'}</div>
                        </td>
                        <td className="td">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              className={cn('btn-sm', dirty ? 'btn-primary' : 'btn-ghost')}
                              disabled={!dirty || savingKey === row.key}
                              onClick={() => void save(row)}
                            >
                              {savingKey === row.key ? '保存中…' : '保存'}
                            </button>
                            <button
                              type="button"
                              className="btn-sm btn-ghost"
                              disabled={!dirty}
                              onClick={() => setDrafts((prev) => ({ ...prev, [row.key]: row.value }))}
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
          </section>
        ))
      )}
    </div>
  );
}
