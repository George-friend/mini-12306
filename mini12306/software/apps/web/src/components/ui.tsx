/** 通用 UI 组件：按钮/输入/弹窗/提示/分页/空态等（供各页面复用） */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/* ── 加载与空态 ───────────────────────────────────────────── */

export function Spinner({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <span className="inline-block w-4 h-4 rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin" />
      {label}
    </div>
  );
}

export function Empty({ title = '暂无数据', hint, action }: { title?: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 text-xl mb-3">∅</div>
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {hint && <div className="text-xs text-slate-500 mt-1 max-w-md">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-4">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn-sm btn-ghost" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}

/* ── 表单字段 ─────────────────────────────────────────────── */

export function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input ${props.className ?? ''}`} />;
}

/* ── 弹窗 ─────────────────────────────────────────────────── */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className={`relative w-full ${width} bg-white rounded-2xl shadow-pop max-h-[86vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 h-14 border-b border-[var(--border)]">
          <h3 className="text-base">{title}</h3>
          <button type="button" aria-label="关闭" className="text-slate-400 hover:text-slate-700 text-xl leading-none" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-6 h-16 flex items-center justify-end gap-3 border-t border-[var(--border)]">{footer}</div>}
      </div>
    </div>
  );
}

/* ── 全局提示（Toast） ────────────────────────────────────── */

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

const ToastContext = createContext<{ push: (kind: ToastKind, text: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 5200 : 3200);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 z-[60] space-y-2 w-[min(92vw,360px)]" role="status" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl px-4 py-3 text-sm shadow-pop border flex items-start gap-2 ${
              t.kind === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : t.kind === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-white border-[var(--border)] text-slate-700'
            }`}
          >
            <span className="shrink-0">{t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i'}</span>
            <span className="leading-relaxed">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return {
    success: (t: string) => ctx.push('success', t),
    error: (t: string) => ctx.push('error', t),
    info: (t: string) => ctx.push('info', t),
  };
}

/* ── 分页 ─────────────────────────────────────────────────── */

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-600">
      <span>
        共 <b className="tnum">{total}</b> 条，第 {page}/{pages} 页
      </span>
      <div className="flex gap-2">
        <button type="button" className="btn-sm btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          上一页
        </button>
        <button type="button" className="btn-sm btn-ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          下一页
        </button>
      </div>
    </div>
  );
}

/* ── 其它小组件 ───────────────────────────────────────────── */

export function Stat({ label, value, unit, tone = 'default' }: { label: string; value: ReactNode; unit?: string; tone?: 'default' | 'brand' | 'success' | 'warning' }) {
  const toneCls =
    tone === 'brand' ? 'text-brand-700' : tone === 'success' ? 'text-emerald-600' : tone === 'warning' ? 'text-amber-600' : 'text-slate-900';
  return (
    <div className="card p-5">
      <div className="text-xs text-[var(--fg-muted)]">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tnum ${toneCls}`}>
        {value}
        {unit && <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>}
      </div>
    </div>
  );
}

export function SectionTitle({ title, desc, extra }: { title: string; desc?: string; extra?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        <h2 className="text-lg">{title}</h2>
        {desc && <p className="text-xs text-[var(--fg-muted)] mt-1">{desc}</p>}
      </div>
      {extra}
    </div>
  );
}

export function Tag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`badge ${className}`}>{children}</span>;
}

/** 破坏性操作二次确认 */
export function ConfirmModal({
  open,
  title,
  content,
  confirmText = '确认',
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  content: ReactNode;
  confirmText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={loading}>
            取消
          </button>
          <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={loading}>
            {loading ? '处理中…' : confirmText}
          </button>
        </>
      }
    >
      <div className="text-sm text-slate-700 leading-relaxed">{content}</div>
    </Modal>
  );
}
