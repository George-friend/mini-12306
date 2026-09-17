/** 公告列表：按类型筛选、点击展开正文 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { dateTime } from '../lib/format';
import { cn } from '../lib/cn';
import { Empty, ErrorBox, Spinner } from '../components/ui';

/* ── 接口类型 ─────────────────────────────────────────────── */

interface AnnouncementItem {
  id: number;
  title: string;
  content: string;
  type: string;
  trainNo: string | null;
  runDate: string | null;
  publishedAt: string | null;
}

interface AnnouncementListData {
  list: AnnouncementItem[];
}

/* ── 常量 ─────────────────────────────────────────────────── */

const TYPE_LABEL: Record<string, string> = { SYSTEM: '系统公告', DELAY: '晚点通知', CANCEL: '停运通知', NOTICE: '温馨提示' };
const TYPE_TONE: Record<string, string> = {
  SYSTEM: 'bg-brand-50 text-brand-700',
  DELAY: 'bg-amber-50 text-amber-700',
  CANCEL: 'bg-red-50 text-red-700',
  NOTICE: 'bg-slate-100 text-slate-600',
};

const FILTERS = [
  { value: '', label: '全部' },
  { value: 'SYSTEM', label: '系统公告' },
  { value: 'DELAY', label: '晚点通知' },
  { value: 'CANCEL', label: '停运通知' },
  { value: 'NOTICE', label: '温馨提示' },
];

/* ── 页面 ─────────────────────────────────────────────────── */

export default function Announcements() {
  const [list, setList] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [type, setType] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get<AnnouncementListData>('/announcements?limit=30')
      .then((d) => {
        if (!cancelled) setList(d.list ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setList([]);
        setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '公告加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filtered = useMemo(() => (type ? list.filter((a) => a.type === type) : list), [list, type]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg">公告与乘车提示</h1>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            列车晚点、停运与购票提示由铁路运营方统一发布，共 <span className="tnum">{list.length}</span> 条。
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-sm btn-ghost" onClick={() => setReloadKey((k) => k + 1)}>
            刷新
          </button>
          <Link to="/" className="btn-sm btn-ghost">
            查询车次
          </Link>
        </div>
      </div>

      {/* 类型筛选 */}
      <div className="card p-1.5">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="公告类型">
          {FILTERS.map((f) => {
            const active = type === f.value;
            const count = f.value ? list.filter((a) => a.type === f.value).length : list.length;
            return (
              <button
                key={f.value || 'all'}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  'whitespace-nowrap px-4 h-9 rounded-lg text-sm transition-colors',
                  active ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-600 hover:bg-slate-100',
                )}
                onClick={() => {
                  setType(f.value);
                  setExpandedId(null);
                }}
              >
                {f.label}
                <span className="ml-1.5 text-xs text-slate-400 tnum">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="card">
          <Spinner label="正在加载公告…" />
        </div>
      ) : error ? (
        <ErrorBox message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : filtered.length === 0 ? (
        <div className="card">
          <Empty
            title="暂无公告"
            hint={type ? '该类型下暂无公告，可切换其它类型查看。' : '管理员发布公告后会在此展示。'}
            action={
              type ? (
                <button type="button" className="btn-ghost" onClick={() => setType('')}>
                  查看全部公告
                </button>
              ) : (
                <Link to="/" className="btn-primary">
                  去查询车次
                </Link>
              )
            }
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((a) => {
            const open = expandedId === a.id;
            return (
              <li key={a.id} className="card overflow-hidden">
                <button
                  type="button"
                  className="w-full text-left px-5 py-4 hover:bg-slate-50"
                  aria-expanded={open}
                  aria-controls={`ann-${a.id}`}
                  onClick={() => setExpandedId(open ? null : a.id)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('badge shrink-0', TYPE_TONE[a.type] ?? TYPE_TONE.NOTICE)}>
                      {TYPE_LABEL[a.type] ?? a.type}
                    </span>
                    <span className="text-sm font-medium text-slate-800">{a.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-[var(--fg-muted)] tnum">{dateTime(a.publishedAt)}</span>
                    <span className="shrink-0 text-xs text-slate-400" aria-hidden>
                      {open ? '收起 ▲' : '展开 ▼'}
                    </span>
                  </div>

                  {(a.trainNo || a.runDate) && (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--fg-muted)]">
                      {a.trainNo && (
                        <span>
                          关联车次 <span className="tnum text-slate-700">{a.trainNo}</span>
                        </span>
                      )}
                      {a.runDate && (
                        <span>
                          乘车日期 <span className="tnum text-slate-700">{a.runDate}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {!open && <p className="mt-2 text-xs text-[var(--fg-muted)] line-clamp-1">{a.content}</p>}
                </button>

                {open && (
                  <div id={`ann-${a.id}`} className="px-5 pb-5 pt-1 text-sm text-slate-700 leading-relaxed border-t border-slate-100">
                    <p className="whitespace-pre-wrap">{a.content}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--fg-muted)]">
                      <span>
                        发布时间：<span className="tnum">{dateTime(a.publishedAt)}</span>
                      </span>
                      {a.trainNo && a.runDate && (
                        <span>
                          涉及车次 <span className="tnum text-slate-700">{a.trainNo}</span> · <span className="tnum text-slate-700">{a.runDate}</span>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
