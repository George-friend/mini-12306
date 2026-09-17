/** 登录：账号密码登录与演示账号一键填充 */
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Input, useToast } from '../components/ui';

/* ── 演示账号 ─────────────────────────────────────────────── */

interface DemoAccount {
  role: string;
  label: string;
  username: string;
  password: string;
  desc: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  { role: 'PASSENGER', label: '旅客', username: 'passenger01', password: 'Pass@123456', desc: '购票、退票、改签、乘车人管理' },
  { role: 'CLERK', label: '售票员', username: 'clerk01', password: 'Clerk@123456', desc: '售票窗口代客购票与退改办理' },
  { role: 'ADMIN', label: '管理员', username: 'admin01', password: 'Admin@123456', desc: '车站车次、订单、用户与公告管理' },
];

/* ── 页面 ─────────────────────────────────────────────────── */

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const state = location.state as { from?: string } | null;
  const from = state?.from && state.from.startsWith('/') ? state.from : '/orders';

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = username.trim();
    if (!name) {
      setError('请输入用户名');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const user = await login(name, password);
      toast.success(`欢迎回来，${user.realName || user.username}`);
      if (user.role === 'ADMIN') navigate('/admin', { replace: true });
      else if (user.role === 'CLERK') navigate('/clerk', { replace: true });
      else navigate(from, { replace: true });
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : '登录失败，请稍后重试';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[52rem] py-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        {/* 表单 */}
        <section className="card p-6 sm:p-8">
          <h1 className="text-xl">账号登录</h1>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            登录后可查询车次、提交订单、管理乘车人；管理员与售票员登录后自动进入对应工作台。
          </p>

          <form className="mt-6 space-y-4" onSubmit={(e) => void onSubmit(e)} noValidate>
            <Field label="用户名" required error={error && !username.trim() ? error : undefined}>
              <Input
                id="login-username"
                name="username"
                aria-label="用户名"
                autoComplete="username"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>

            <Field label="密码" required>
              <Input
                id="login-password"
                name="password"
                aria-label="密码"
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? '登录中…' : '登录'}
            </button>
          </form>

          <p className="mt-4 text-xs text-[var(--fg-muted)]">
            还没有账号？
            <Link to="/register" className="text-brand-700 hover:underline ml-1">
              实名注册
            </Link>
          </p>

          <div className="mt-6 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600 leading-relaxed">
            连续 5 次密码错误将锁定账号 10 分钟；被冻结账号需联系管理员处理。
          </div>
        </section>

        {/* 演示账号 */}
        <aside className="card p-5">
          <h2 className="text-base">演示账号一键填充</h2>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">课程演示环境预置以下账号，点击即可填入登录表单。</p>
          <ul className="mt-4 space-y-2.5">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.username}>
                <button
                  type="button"
                  className="w-full text-left rounded-xl border border-[var(--border)] px-3.5 py-3 hover:border-brand-300 hover:bg-brand-50/50 transition-colors"
                  onClick={() => {
                    setUsername(a.username);
                    setPassword(a.password);
                    setError('');
                  }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {a.label}
                      <span className="ml-2 text-xs font-normal text-slate-500 tnum">{a.username}</span>
                    </span>
                    <span className="text-xs text-brand-700">填充</span>
                  </span>
                  <span className="mt-1 block text-xs text-[var(--fg-muted)] break-all">{a.desc}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] text-slate-400 leading-relaxed">
            提示：本系统为教学演示项目，实名核验、短信与支付均接入本地 Mock 服务。
          </p>
        </aside>
      </div>
    </div>
  );
}
