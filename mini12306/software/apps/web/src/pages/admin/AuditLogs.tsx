/** 审计日志：后台关键操作留痕检索，detail 为 JSON 可展开查看 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { Empty, ErrorBox, Input, Pagination, SectionTitle, Select, Spinner, Tag } from '../../components/ui';

interface AuditLog {
  id: number;
  actorId: number | null;
  actorName: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

interface AuditLogListData {
  total: number;
  page: number;
  pageSize: number;
  list: AuditLog[];
}

const ROLE_TONE: Record<string, string> = {
  ADMIN: 'bg-brand-50 text-brand-700',
  CLERK: 'bg-violet-50 text-violet-700',
  PASSENGER: 'bg-slate-100 text-slate-600',
  SYSTEM: 'bg-teal-50 text-teal-700',
};

const ROLE_TEXT: Record<string, string> = { ADMIN: '管理员', CLERK: '售票员', PASSENGER: '旅客', SYSTEM: '系统' };

const TARGET_TEXT: Record<string, string> = {
  order: '订单',
  user: '用户',
  train: '车次',
  station: '车站',
  schedule: '运行日',
  inventory: '库存',
  announcement: '公告',
  setting: '系统参数',
  job: '定时任务',
  passenger: '乘车人',
};

/** 常用动作快捷筛选 */
const ACTION_SHORTCUTS = ['UPDATE_SETTING', 'UPDATE_INVENTORY', 'UPDATE_SCHEDULE', 'CREATE_TRAIN', 'UPDATE_USER_STATUS', 'RESET_PASSWORD'];

/** 截断展示 JSON，同时尽量可读 */
function truncateDetail(detail: string | null, max = 64): string {
  if (!detail) return '--';
  return detail.length > max ? `${detail.slice(0, max)}…` : detail;
}

/** 尝试格式化 JSON，解析失败时原样返回 */
function prettyJson(detail: string | null): string {
  if (!detail) return '（无详情）';
  try {
    return JSON.stringify(JSON.parse(detail) as unknown, null, 2);
  } catch {
    return detail;
  }
}

export default function AuditLogs() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [data, setData] = useState<AuditLogListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<AuditLogListData>(`/admin/audit-logs${qs({ action: action.trim(), page, pageSize })}`);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [action, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const list = data?.list ?? [];

  return (
    <div className="space-y-5">
      <SectionTitle
        title="审计日志"
        desc="记录后台关键操作（新增 / 修改 / 删除 / 状态变更 / 收银等），按时间倒序展示"
        extra={
          <button type="button" className="btn-sm btn-ghost" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        }
      />

      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="label">动作关键字</span>
            <Input
              className="w-56"
              placeholder="如 UPDATE_SETTING"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
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
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </Select>
          </label>
          <button
            type="button"
            className="btn-sm btn-ghost"
            onClick={() => {
              setAction('');
              setPage(1);
            }}
          >
            清空关键字
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 mr-1">快捷筛选：</span>
          {ACTION_SHORTCUTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                setAction(a);
                setPage(1);
              }}
              className={`px-2 h-7 rounded-md text-xs border transition-colors ${
                action === a ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-[var(--border)] hover:bg-slate-50'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner label="正在加载审计日志…" />
        ) : list.length === 0 ? (
          <Empty
            title="没有匹配的审计日志"
            hint={action.trim() ? '请检查动作关键字（区分大小写，如 UPDATE_SETTING），或清空后查看全部' : '后台还没有产生审计记录'}
            action={
              action.trim() ? (
                <button type="button" className="btn-sm btn-ghost" onClick={() => setAction('')}>
                  查看全部日志
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr>
                  <th className="th">时间</th>
                  <th className="th">操作人</th>
                  <th className="th">角色</th>
                  <th className="th">动作</th>
                  <th className="th">目标类型</th>
                  <th className="th">目标 ID</th>
                  <th className="th">IP</th>
                  <th className="th">详情</th>
                </tr>
              </thead>
              <tbody>
                {list.map((log) => {
                  const isOpen = expanded === log.id;
                  return (
                    <Fragment key={log.id}>
                      <tr className="hover:bg-slate-50/70">
                        <td className="td text-xs text-slate-500 tnum whitespace-nowrap">{dateTime(log.createdAt)}</td>
                        <td className="td text-slate-700">
                          {log.actorName || '--'}
                          {log.actorId !== null && <span className="ml-2 text-[11px] text-slate-400">#{log.actorId}</span>}
                        </td>
                        <td className="td">
                          <Tag className={ROLE_TONE[log.actorRole] ?? 'bg-slate-100 text-slate-600'}>{ROLE_TEXT[log.actorRole] ?? log.actorRole}</Tag>
                        </td>
                        <td className="td">
                          <code className="font-mono text-xs text-brand-700">{log.action}</code>
                        </td>
                        <td className="td text-slate-600">{TARGET_TEXT[log.targetType] ?? log.targetType}</td>
                        <td className="td font-mono text-xs text-slate-600 max-w-[12rem] truncate" title={log.targetId ?? ''}>
                          {log.targetId || '--'}
                        </td>
                        <td className="td font-mono text-xs text-slate-500">{log.ip || '--'}</td>
                        <td className="td">
                          <button
                            type="button"
                            className="text-left font-mono text-xs text-slate-600 hover:text-brand-700 max-w-[20rem] truncate"
                            aria-expanded={isOpen}
                            title={isOpen ? '收起完整 JSON' : '点击展开完整 JSON'}
                            onClick={() => setExpanded(isOpen ? null : log.id)}
                          >
                            {log.detail ? truncateDetail(log.detail) : '--'}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td className="td" colSpan={8}>
                            <div className="text-xs text-slate-500 mb-2">完整 detail（JSON 字符串）</div>
                            <pre className="rounded-lg border border-[var(--border)] bg-white px-4 py-3 text-xs text-slate-700 whitespace-pre-wrap break-all max-h-64 overflow-auto">
{prettyJson(log.detail)}
                            </pre>
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
        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(p) => setPage(p)} />
        )}
      </div>
    </div>
  );
}
