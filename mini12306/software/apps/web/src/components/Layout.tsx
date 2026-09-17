import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { Icon, type IconName } from './Icon';
import { SpeedLines, TrainMark } from './Decor';

/* ── 页面标题横幅：内页统一使用，避免"白底空荡" ─────────────── */

const PAGE_BANNERS: Record<string, { title: string; desc: string; icon: IconName }> = {
  '/orders': { title: '我的订单', desc: '查看订单状态，完成支付、退票与改签', icon: 'ticket' },
  '/passengers': { title: '乘车人管理', desc: '维护常用乘车人，购票时可直接勾选', icon: 'users' },
  '/profile': { title: '个人中心', desc: '账号资料、手机号与登录密码维护', icon: 'user' },
  '/announcements': { title: '列车公告', desc: '晚点、停运与购票提示，由后台统一发布', icon: 'bell' },
  '/admin': { title: '运营概览', desc: '订单、收入、退票与热门线路一览', icon: 'chart' },
  '/clerk': { title: '售票窗口', desc: '检索旅客、代客下单、现金收银出票与代客退票', icon: 'window' },
  '/admin/stations': { title: '车站管理', desc: '维护车站字典，供车次与查询使用', icon: 'pin' },
  '/admin/trains': { title: '车次管理', desc: '维护车次区间、发到时刻与基准票价', icon: 'train' },
  '/admin/schedules': { title: '运行日与库存', desc: '批量生成运行日，调整席别票价与定员', icon: 'calendar' },
  '/admin/orders': { title: '订单管理', desc: '按订单号、用户与状态检索全量订单', icon: 'ticket' },
  '/admin/users': { title: '用户管理', desc: '账号检索、冻结解冻与密码重置', icon: 'users' },
  '/admin/announcements': { title: '公告管理', desc: '发布系统、晚点与停运公告并联动运行日', icon: 'bell' },
  '/admin/settings': { title: '系统设置', desc: '支付时限、退票规则等参数，修改立即生效', icon: 'settings' },
  '/admin/audit-logs': { title: '审计日志', desc: '记录管理员的关键写操作，可追溯', icon: 'shield' },
};

export function PageBanner({ dark = false }: { dark?: boolean }) {
  const { pathname } = useLocation();
  const banner = PAGE_BANNERS[pathname];
  if (!banner) return null;

  return (
    // 注意：使用 overflow-clip 而非 overflow-hidden，后者会把横幅变成可滚动容器，
    // 一旦内部元素被 focus/scrollIntoView 带走，会出现"点了没反应"的点击丢失问题。
    <div
      className={cn(
        'relative overflow-clip rounded-2xl px-5 py-5 sm:px-6 text-white rise-in mb-6',
        dark ? 'bg-gradient-to-r from-[#0b3a86] via-[#1a5fd0] to-[#1f6feb]' : 'bg-gradient-to-r from-[#0d4ea6] to-[#38bdf8]',
      )}
    >
      <SpeedLines className="pointer-events-none absolute inset-0 h-full w-full" opacity={0.12} />
      <div className="relative flex items-center gap-3.5">
        <span className="w-11 h-11 shrink-0 rounded-xl bg-white/15 ring-1 ring-inset ring-white/25 inline-flex items-center justify-center">
          <Icon name={banner.icon} size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{banner.title}</h1>
          <p className="mt-0.5 text-xs text-white/80">{banner.desc}</p>
        </div>
      </div>
    </div>
  );
}

/* ── 旅客端布局：顶部导航 + 移动端底部导航 ─────────────────── */

const NAV: Array<{ to: string; label: string; end?: boolean; icon: IconName }> = [
  { to: '/', label: '车次查询', end: true, icon: 'search' },
  { to: '/orders', label: '我的订单', icon: 'ticket' },
  { to: '/passengers', label: '乘车人', icon: 'users' },
  { to: '/announcements', label: '公告', icon: 'bell' },
];

export function SiteLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-grid">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-[var(--border)] no-print">
        <div className="mx-auto max-w-[1180px] px-4 h-16 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-600 to-sky-400 flex items-center justify-center text-white shadow-sm ring-1 ring-white/40">
              <TrainMark className="w-7 h-7" />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold tracking-tight">Mini-12306</span>
              <span className="block text-[11px] text-[var(--fg-muted)]">在线车票服务系统</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 ml-2">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'px-3 h-9 inline-flex items-center gap-1.5 rounded-lg text-sm transition-colors',
                    isActive ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-600 hover:bg-slate-100',
                  )
                }
              >
                <Icon name={item.icon} size={15} className="opacity-80" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {user?.role === 'ADMIN' && (
              <Link to="/admin" className="hidden sm:inline-flex btn-sm btn-ghost">
                管理后台
              </Link>
            )}
            {user && user.role !== 'PASSENGER' && (
              <Link to="/clerk" className="hidden sm:inline-flex btn-sm btn-ghost">
                售票窗口
              </Link>
            )}
            {user ? (
              <div className="flex items-center gap-2">
                <Link to="/profile" className="flex items-center gap-2 text-sm text-slate-700 hover:text-brand-700">
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-sky-400 text-white text-xs font-medium flex items-center justify-center">
                    {(user.realName || user.username).slice(0, 1)}
                  </span>
                  <span className="max-w-[7rem] truncate">{user.realName || user.username}</span>
                  <span className="text-[11px] text-slate-400">
                    {user.role === 'ADMIN' ? '管理员' : user.role === 'CLERK' ? '售票员' : '旅客'}
                  </span>
                </Link>
                <button
                  type="button"
                  className="btn-sm btn-ghost"
                  onClick={() => {
                    logout();
                    navigate('/');
                  }}
                >
                  退出
                </button>
              </div>
            ) : (
              <>
                <Link to="/login" className="btn-sm btn-ghost">
                  登录
                </Link>
                <Link to="/register" className="btn-sm btn-primary">
                  注册
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-[1180px] px-4 py-6 pb-24 md:pb-10">
        <PageBanner />
        <Outlet />
      </main>

      <footer className="border-t border-[var(--border)] bg-white no-print">
        <div className="mx-auto max-w-[1180px] px-4 py-10">
          <div className="grid gap-8 md:grid-cols-[1.5fr_1fr_1fr_1.1fr]">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-600 to-sky-400 flex items-center justify-center text-white">
                  <TrainMark className="w-6 h-6" />
                </span>
                <span className="text-sm font-semibold">Mini-12306 在线车票服务系统</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--fg-muted)]">
                软件工程基础实验课程项目，2 人结对完成。系统覆盖实名注册、车次查询、在线购票、退票与改签全流程，
                面向旅客、售票员、管理员三类角色。
              </p>
              <p className="mt-3 text-xs leading-relaxed text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                教学演示环境：实名认证 / 短信 / 银行支付均为本地 Mock 服务，请勿填写真实身份证号、手机号与银行卡号。
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-800 mb-3">快速导航</h4>
              <ul className="space-y-2 text-xs text-[var(--fg-muted)]">
                <li><Link to="/" className="hover:text-brand-700">车次查询</Link></li>
                <li><Link to="/orders" className="hover:text-brand-700">订单管理</Link></li>
                <li><Link to="/passengers" className="hover:text-brand-700">乘车人管理</Link></li>
                <li><Link to="/announcements" className="hover:text-brand-700">列车公告</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-800 mb-3">服务范围</h4>
              <ul className="space-y-2 text-xs text-[var(--fg-muted)]">
                <li>16 座车站 · 26 条线路</li>
                <li>104 个车次 · 未来 14 天可售</li>
                <li>在线购票与模拟支付</li>
                <li>阶梯费率退票与改签</li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-800 mb-3">技术实现</h4>
              <ul className="space-y-2 text-xs text-[var(--fg-muted)]">
                <li>React + TypeScript + Tailwind</li>
                <li>Node.js + Express + Prisma</li>
                <li>SQLite 数据库 · 事务 + 乐观锁</li>
                <li>DeepSeek Harness 辅助开发</li>
              </ul>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>© 2026 Mini-12306 · 软件工程基础实验课程项目</span>
            <span>本系统仅用于教学演示，不涉及真实资金流转与真实个人信息</span>
          </div>
        </div>
      </footer>

      {/* 移动端底部导航（部署图中「移动端」形态） */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--border)] grid grid-cols-4 h-14 no-print">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => cn('flex items-center justify-center text-xs', isActive ? 'text-brand-700 font-medium' : 'text-slate-500')}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/* ── 后台布局：左侧导航 + 内容区（售票员 / 管理员共用） ────── */

const ADMIN_NAV = [
  { to: '/admin', label: '运营概览', end: true, roles: ['ADMIN'] },
  { to: '/clerk', label: '售票窗口', end: true, roles: ['ADMIN', 'CLERK'] },
  { to: '/admin/stations', label: '车站管理', roles: ['ADMIN'] },
  { to: '/admin/trains', label: '车次管理', roles: ['ADMIN'] },
  { to: '/admin/schedules', label: '运行日与库存', roles: ['ADMIN'] },
  { to: '/admin/orders', label: '订单管理', roles: ['ADMIN'] },
  { to: '/admin/users', label: '用户管理', roles: ['ADMIN'] },
  { to: '/admin/announcements', label: '公告管理', roles: ['ADMIN'] },
  { to: '/admin/settings', label: '系统设置', roles: ['ADMIN'] },
  { to: '/admin/audit-logs', label: '审计日志', roles: ['ADMIN'] },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex bg-[var(--bg)]">
      <aside className="w-56 shrink-0 bg-white border-r border-[var(--border)] hidden md:flex flex-col no-print">
        <Link to="/" className="h-16 flex items-center gap-2.5 px-5 border-b border-[var(--border)]">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-600 to-sky-400 flex items-center justify-center text-white font-bold text-xs">
            M
          </span>
          <span className="text-sm font-semibold">Mini-12306 后台</span>
        </Link>
        <nav className="p-3 space-y-0.5 flex-1 overflow-y-auto">
          {ADMIN_NAV.filter((i) => i.roles.includes(user?.role ?? '')).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'block px-3 h-9 leading-9 rounded-lg text-sm transition-colors',
                  isActive ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-600 hover:bg-slate-100',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-[var(--border)]">
          <Link to="/" className="block text-xs text-slate-500 hover:text-brand-700">
            ← 返回旅客端
          </Link>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-[var(--border)] flex items-center px-5 gap-4 no-print">
          <div className="md:hidden text-sm font-semibold">Mini-12306 后台</div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-600">
              {user?.realName || user?.username}
              <span className="ml-1.5 text-[11px] text-slate-400">{user?.role === 'ADMIN' ? '管理员' : '售票员'}</span>
            </span>
            <button
              type="button"
              className="btn-sm btn-ghost"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              退出
            </button>
          </div>
        </header>
        <div className="md:hidden px-3 py-2 bg-white border-b border-[var(--border)] overflow-x-auto no-print">
          <div className="flex gap-2">
            {ADMIN_NAV.filter((i) => i.roles.includes(user?.role ?? '')).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn('whitespace-nowrap px-3 h-8 leading-8 rounded-lg text-xs', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 bg-slate-100')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
        {/*
          这里不能用 overflow-x-hidden：CSS 规定一个轴设成 hidden 时，另一个轴的 visible 会被
          计算成 auto，于是 main 变成「可滚动容器」，会引发与 Hero 相同的点击丢失问题。
          overflow-x: clip 只裁剪、不产生滚动容器。
        */}
        <main className="flex-1 p-5" style={{ overflowX: 'clip' }}>
          <PageBanner dark />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="py-20 text-center">
      <div className="text-5xl font-bold text-slate-200">404</div>
      <p className="mt-3 text-sm text-slate-500">页面不存在或已被移除</p>
      <Link to="/" className="btn-primary mt-6 inline-flex">
        返回首页
      </Link>
    </div>
  );
}
