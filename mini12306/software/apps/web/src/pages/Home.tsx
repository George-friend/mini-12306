/** 首页：车次查询入口、最新公告、热门线路与系统说明 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { addDays, dateTime, today, weekday } from '../lib/format';
import { cn } from '../lib/cn';
import { Empty, ErrorBox, SectionTitle, Spinner, useToast } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { HeroRails, SignBadge, SpeedLines, TrainSilhouette } from '../components/Decor';

/* ── 接口类型 ─────────────────────────────────────────────── */

interface Station {
  id: number;
  code: string;
  name: string;
  city: string;
  province: string;
  pinyin: string;
  isActive: boolean;
}

interface AnnouncementItem {
  id: number;
  title: string;
  content: string;
  type: string;
  trainNo: string | null;
  runDate: string | null;
  publishedAt: string | null;
}

interface StationListData {
  list: Station[];
}

interface AnnouncementListData {
  list: AnnouncementItem[];
}

/* ── 常量 ─────────────────────────────────────────────────── */

const MAX_DAYS = 14;

const HOT_ROUTES: Array<{ from: string; to: string; line: string; note: string }> = [
  { from: '北京南', to: '上海虹桥', line: '京沪高铁', note: '全天 2 班 · 约 4 小时 28 分' },
  { from: '上海虹桥', to: '北京南', line: '京沪高铁', note: '全天 2 班 · 约 4 小时 28 分' },
  { from: '北京南', to: '广州南', line: '京广高铁', note: '每日 1 班 · 约 8 小时' },
  { from: '上海虹桥', to: '杭州东', line: '沪杭高铁', note: '每日 1 班 · 45 分钟' },
  { from: '广州南', to: '深圳北', line: '广深港高铁', note: '每日 1 班 · 36 分钟' },
  { from: '成都东', to: '重庆北', line: '成渝高铁', note: '每日 1 班 · 1 小时 30 分' },
];

const ANNOUNCE_TONE: Record<string, string> = {
  SYSTEM: 'bg-brand-50 text-brand-700',
  DELAY: 'bg-amber-50 text-amber-700',
  CANCEL: 'bg-red-50 text-red-700',
  NOTICE: 'bg-slate-100 text-slate-600',
};

const ANNOUNCE_LABEL: Record<string, string> = {
  SYSTEM: '系统',
  DELAY: '晚点',
  CANCEL: '停运',
  NOTICE: '公告',
};

/** Hero 区服务数据一览 */
const HERO_STATS = [
  { value: '16', unit: '座', label: '覆盖车站' },
  { value: '26', unit: '条', label: '双向线路' },
  { value: '104', unit: '个', label: '在售车次' },
  { value: '14', unit: '天', label: '可售日期' },
];

/** 服务特色 */
const FEATURES: Array<{ title: string; desc: string; icon: IconName }> = [
  { title: '实名购票', desc: '身份证核验通过才能购票，证件号加密存储、界面脱敏展示。', icon: 'shield' },
  { title: '余票实时', desc: '余票 = 定员 − 已售 − 锁定；下单即锁票，超时自动释放。', icon: 'chart' },
  { title: '在线退改', desc: '退票费按阶梯费率透明试算，改签差价自动补收或退还。', icon: 'refresh' },
  { title: '安全支付', desc: 'Mock 银行收银台 + 签名异步回调，回调幂等可重复投递。', icon: 'wallet' },
];

/** 出行指引三步 */
const STEPS: Array<{ title: string; desc: string; icon: IconName }> = [
  { title: '查询车次', desc: '选择出发站、到达站与乘车日期，支持按车次类型、席别与时段筛选。', icon: 'search' },
  { title: '提交订单', desc: '勾选乘车人并选择席别，系统在事务内锁定余票并生成待支付订单。', icon: 'ticket' },
  { title: '完成支付', desc: '前往 Mock 银行收银台支付，回调验签通过后自动出票并分配座位号。', icon: 'check' },
];

/** 出行须知 */
const TIPS: Array<{ title: string; desc: string; tone: string }> = [
  { title: '开车前 30 分钟停止售票', desc: '为保障行程，请在列车开车前 30 分钟完成购票。', tone: 'text-amber-700 bg-amber-50 border-amber-100' },
  { title: '开车后不办理退票', desc: '已发车车票不可退票，仅可改签当日其他车次。', tone: 'text-red-700 bg-red-50 border-red-100' },
  { title: '每张车票限改签一次', desc: '改签后票价高于原价需补差，低于原价按阶梯费率退还差额。', tone: 'text-sky-700 bg-sky-50 border-sky-100' },
  { title: '退票费最低 2 元', desc: '开车前 8 天以上免收，48 小时以上收 5%，24 小时以上收 10%，不足 24 小时收 20%。', tone: 'text-slate-700 bg-slate-50 border-slate-200' },
];

/** 车站模糊匹配：名称 / 城市 / 拼音 / 电报码 */
function filterStations(list: Station[], keyword: string, limit = 100): Station[] {
  const kw = keyword.trim().toLowerCase();
  const matched = list.filter(
    (s) =>
      !kw ||
      s.name.toLowerCase().includes(kw) ||
      s.city.toLowerCase().includes(kw) ||
      s.pinyin.toLowerCase().includes(kw) ||
      s.code.toLowerCase().includes(kw),
  );
  const rank = (s: Station) => (s.name === keyword.trim() ? 0 : s.name.toLowerCase().startsWith(kw) ? 1 : s.city.toLowerCase().startsWith(kw) ? 2 : 3);
  return [...matched].sort((a, b) => (rank(a) === rank(b) ? a.id - b.id : rank(a) - rank(b))).slice(0, limit);
}

/** 把用户输入解析为唯一车站 */
function resolveStation(list: Station[], input: string): Station | null {
  const v = input.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  return (
    list.find((s) => s.name === v) ??
    list.find((s) => s.code.toLowerCase() === lower) ??
    list.find((s) => s.city === v) ??
    list.find((s) => s.name.includes(v)) ??
    null
  );
}

/* ── 车站输入框（可搜索下拉，聚焦即展示全部车站） ─────────── */

function StationField({
  id,
  label,
  value,
  onChange,
  stations,
  placeholder,
  onEnter,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  stations: Station[];
  placeholder: string;
  onEnter?: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** 是否处于「正在输入检索」状态：决定下拉是展示全部车站还是按关键字过滤 */
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const options = useMemo(() => {
    const kw = searching ? value.trim() : '';
    return filterStations(stations, kw);
  }, [stations, value, searching]);

  const noMatch = searching && value.trim().length > 0 && options.length === 0;

  useEffect(() => {
    setActive(0);
  }, [value, searching]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearching(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  // 键盘上下键时把高亮项滚进可视区
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`#${id}-opt-${active}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);

  const choose = (s: Station) => {
    onChange(s.name);
    setOpen(false);
    setSearching(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setSearching(true);
      setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && options[active]) {
        e.preventDefault();
        choose(options[active]);
      } else {
        e.preventDefault();
        onEnter?.();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setSearching(false);
    }
  };

  const listId = `${id}-listbox`;

  return (
    <div className="relative" ref={boxRef}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onMouseDown={() => {
          // 已在聚焦状态下再次点击输入框 → 回到「浏览全部车站」
          setSearching(false);
          setOpen(true);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setSearching(true);
        }}
        onFocus={() => {
          setSearching(false);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto card py-1 shadow-pop"
        >
          {noMatch ? (
            <li className="px-3 py-3 text-sm text-slate-500">
              未找到「{value.trim()}」对应的车站
              <button
                type="button"
                className="ml-2 text-brand-700 underline"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange('');
                  setSearching(false);
                  setOpen(true);
                }}
              >
                查看全部 {stations.length} 个车站
              </button>
            </li>
          ) : (
            <>
              {!searching && (
                <li className="px-3 py-1.5 text-[11px] text-slate-400 border-b border-slate-100">
                  共 {stations.length} 个车站 · 可按站名 / 城市 / 拼音 / 电报码检索
                </li>
              )}
              {options.map((s, i) => {
                const isCurrent = s.name === value.trim();
                return (
                  <li
                    key={s.id}
                    id={`${id}-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={cn(
                      'px-3 py-2 text-sm cursor-pointer flex items-center justify-between gap-3',
                      i === active ? 'bg-brand-50 text-brand-700' : 'text-slate-700',
                    )}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(s);
                    }}
                  >
                    <span className="min-w-0 truncate">
                      {s.name}
                      <span className="ml-2 text-xs text-slate-400">{s.city}</span>
                      {isCurrent && <span className="ml-2 badge bg-brand-100 text-brand-700 h-5">当前</span>}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400 tnum">{s.code}</span>
                  </li>
                );
              })}
            </>
          )}
        </ul>
      )}
    </div>
  );
}

/* ── 页面 ─────────────────────────────────────────────────── */

export default function Home() {
  const navigate = useNavigate();
  const toast = useToast();

  const [stations, setStations] = useState<Station[]>([]);
  const [from, setFrom] = useState('北京南');
  const [to, setTo] = useState('上海虹桥');
  const [date, setDate] = useState(() => addDays(today(), 1));
  const [formError, setFormError] = useState('');

  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [annLoading, setAnnLoading] = useState(true);
  const [annError, setAnnError] = useState('');

  const todayStr = today();
  const maxDate = addDays(todayStr, MAX_DAYS - 1);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<StationListData>('/stations')
      .then((d) => {
        if (!cancelled) setStations(d.list ?? []);
      })
      .catch(() => {
        if (!cancelled) setStations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAnnouncements = () => {
    setAnnLoading(true);
    setAnnError('');
    void api
      .get<AnnouncementListData>('/announcements?limit=5')
      .then((d) => setAnnouncements(d.list ?? []))
      .catch((e: unknown) => setAnnError(e instanceof Error ? e.message : '公告加载失败'))
      .finally(() => setAnnLoading(false));
  };

  useEffect(() => {
    loadAnnouncements();
  }, []);

  const quickDates = useMemo(
    () =>
      [0, 1, 2].map((offset) => {
        const value = addDays(todayStr, offset);
        return { value, label: offset === 0 ? '今天' : offset === 1 ? '明天' : '后天' };
      }),
    [todayStr],
  );

  const goSearch = (fromStation: string, toStation: string, runDate: string) => {
    navigate(`/trains?from=${encodeURIComponent(fromStation)}&to=${encodeURIComponent(toStation)}&date=${runDate}`);
  };

  const submit = () => {
    const f = from.trim();
    const t = to.trim();

    /** 校验失败：三种反馈同时给（内联提示 + 右上角提示 + 聚焦出错输入框），避免"点了没反应" */
    const reject = (msg: string, focusId?: string) => {
      setFormError(msg);
      toast.error(msg);
      if (focusId) {
        const el = document.getElementById(focusId) as HTMLInputElement | null;
        el?.focus();
        el?.select();
      }
    };

    if (!f || !t) {
      reject('请填写出发站与到达站', !f ? 'home-from' : 'home-to');
      return;
    }
    // 车站字典尚未加载完：直接交给后端校验，下一页会给出明确错误
    if (stations.length === 0) {
      setFormError('');
      goSearch(f, t, date);
      return;
    }
    const fs = resolveStation(stations, f);
    if (!fs) {
      reject(`未找到车站「${f}」，请从下拉候选中选择（支持站名 / 城市 / 拼音 / 电报码）`, 'home-from');
      return;
    }
    const ts = resolveStation(stations, t);
    if (!ts) {
      reject(`未找到车站「${t}」，请从下拉候选中选择（支持站名 / 城市 / 拼音 / 电报码）`, 'home-to');
      return;
    }
    if (fs.id === ts.id) {
      reject('出发站与到达站不能相同', 'home-to');
      return;
    }
    setFormError('');
    // 直接把用户的输入交给后端解析：后端支持「城市名 → 该城市全部车站」的检索
    // （例如输入「北京 → 上海」会自动检索 北京南/北京西 → 上海），比前端硬选一个站更符合真实 12306
    goSearch(f, t, date);
  };

  return (
    <div className="space-y-10">
      {/* ── Hero：品牌视觉 + 车次查询 ─────────────────────── */}
      {/*
        注意：这里用 overflow-clip 而不是 overflow-hidden。
        overflow-hidden 会把 Hero 变成「可滚动容器」，一旦有元素被 scrollIntoView / focus 带进来，
        浏览器会在 Hero 内部滚动，导致 mousedown 与 mouseup 落在不同元素上 —— click 事件根本不触发，
        表现为「点了按钮没反应」。overflow-clip 只裁剪、不产生滚动容器，正好满足这里的装饰裁剪需求。
      */}
      <section className="relative overflow-clip rounded-2xl bg-gradient-to-br from-[#062a5e] via-[#0d4ea6] to-[#1f6feb] px-5 py-9 sm:px-9 sm:py-12 text-white shadow-glow rise-in">
        {/* 背景装饰：光晕 / 速度线 / 铁轨透视 / 复兴号剪影 */}
        <div className="pointer-events-none absolute inset-0 bg-hero-glow" aria-hidden="true" />
        <SpeedLines className="pointer-events-none absolute inset-0 h-full w-full" opacity={0.1} />
        <HeroRails className="pointer-events-none absolute inset-x-0 bottom-0 h-44 w-full" />
        <TrainSilhouette className="pointer-events-none absolute right-2 bottom-8 hidden w-[27rem] lg:block" />

        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <SignBadge>MINI-12306 · 在线车票服务系统</SignBadge>
            <SignBadge className="bg-white/10">教学演示环境</SignBadge>
          </div>

          <h1 className="mt-4 text-2xl sm:text-[2.15rem] leading-tight">
            一次查询，<span className="text-gradient">直达目的地</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/85">
            输入出发站与到达站即可查询未来 14 天内的运行车次、各席别余票与票价，支持在线下单、模拟支付、退票与改签全流程。
          </p>

          {/* 车次查询卡 */}
          <div className="mt-7 rounded-2xl bg-white p-4 sm:p-5 shadow-pop">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] md:items-end">
            <StationField
              id="home-from"
              label="出发站"
              value={from}
              onChange={setFrom}
              stations={stations}
              placeholder="如：北京南 / 北京 / beijingnan / VNP"
              onEnter={submit}
            />
            <StationField
              id="home-to"
              label="到达站"
              value={to}
              onChange={setTo}
              stations={stations}
              placeholder="如：上海虹桥 / 上海 / shanghaihongqiao / AOH"
              onEnter={submit}
            />

            <div>
              <label className="label" htmlFor="home-date">
                乘车日期
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="home-date"
                  type="date"
                  className="input w-[11.5rem]"
                  value={date}
                  min={todayStr}
                  max={maxDate}
                  onChange={(e) => setDate(e.target.value)}
                />
                <div className="flex gap-1" role="group" aria-label="快捷日期">
                  {quickDates.map((q) => (
                    <button
                      key={q.value}
                      type="button"
                      aria-pressed={date === q.value}
                      className={cn(
                        'btn-sm',
                        date === q.value ? 'btn-primary' : 'btn-ghost',
                      )}
                      onClick={() => setDate(q.value)}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 md:pb-0">
              <button
                type="button"
                className="btn-sm btn-ghost h-10"
                onClick={() => {
                  setFrom(to);
                  setTo(from);
                  setFormError('');
                }}
              >
                交换
              </button>
              <button type="button" className="btn-primary h-10 px-6" onClick={submit}>
                查询车次
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-[var(--fg-muted)]">
              已选：{weekday(date)} · {date} · 可售日期范围 {todayStr} ~ {maxDate}
              {stations.length > 0 ? ` · 可选车站 ${stations.length} 个` : ' · 车站加载中…'}
            </span>
            <span className="text-[var(--fg-muted)]">提示：点击出发站/到达站可展开全部车站，直接输入城市名或拼音也能检索</span>
          </div>

          {formError ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
              <span className="shrink-0 font-semibold">!</span>
              <span className="leading-relaxed">{formError}</span>
            </div>
          ) : null}
          </div>

          {/* 服务数据一览 */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {HERO_STATS.map((s) => (
              <div key={s.label} className="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-inset ring-white/15 backdrop-blur-sm">
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-semibold tnum">{s.value}</span>
                  <span className="text-[11px] text-white/70">{s.unit}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-white/70">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 服务特色 */}
      <section>
        <SectionTitle title="服务特色" desc="围绕“查得到、买得着、退得掉、改得动”设计的核心能力" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card card-hover p-5">
              <span className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <Icon name={f.icon} size={18} />
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-800">{f.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--fg-muted)]">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 最新公告 */}
      <section>
        <SectionTitle
          title="最新公告"
          desc="列车晚点、停运与购票提示，由后台统一发布"
          extra={
            <Link to="/announcements" className="btn-sm btn-ghost">
              查看全部
            </Link>
          }
        />
        <div className="card p-1.5">
          {annLoading ? (
            <Spinner label="公告加载中…" />
          ) : annError ? (
            <div className="p-4">
              <ErrorBox message={annError} onRetry={loadAnnouncements} />
            </div>
          ) : announcements.length === 0 ? (
            <Empty title="暂无公告" hint="管理员发布公告后会在此展示。" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {announcements.map((a) => (
                <li key={a.id}>
                  <Link to="/announcements" className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className={cn('badge shrink-0 mt-0.5', ANNOUNCE_TONE[a.type] ?? ANNOUNCE_TONE.NOTICE)}>
                      {ANNOUNCE_LABEL[a.type] ?? '公告'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-800 truncate">{a.title}</span>
                      <span className="mt-0.5 block text-xs text-[var(--fg-muted)] truncate">{a.content}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400 tnum">{dateTime(a.publishedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 热门线路 */}
      <section>
        <SectionTitle title="热门线路" desc="点击卡片可直接查询次日车次" extra={<span className="text-xs text-[var(--fg-muted)]">共 26 条双向线路</span>} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HOT_ROUTES.map((r) => (
            <button
              key={`${r.from}-${r.to}`}
              type="button"
              data-testid="hot-route"
              className="ticket card-hover p-5 text-left"
              onClick={() => goSearch(r.from, r.to, addDays(todayStr, 1))}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                    <span className="truncate">{r.from}</span>
                    <Icon name="arrow-right" size={14} className="text-brand-600 shrink-0" />
                    <span className="truncate">{r.to}</span>
                  </div>
                  <p className="mt-2 text-xs text-[var(--fg-muted)]">{r.note}</p>
                </div>
                <span className="badge bg-brand-50 text-brand-700 shrink-0">{r.line}</span>
              </div>
              <div className="mt-3 pt-3 border-t border-dashed border-slate-200 flex items-center justify-between text-xs">
                <span className="text-[var(--fg-muted)] inline-flex items-center gap-1">
                  <Icon name="train" size={13} /> 每日开行
                </span>
                <span className="text-brand-700 font-medium inline-flex items-center gap-0.5">
                  立即查询 <Icon name="chevron-right" size={13} />
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 出行指引 */}
      <section>
        <SectionTitle title="三步完成购票" desc="从查询到出票，全流程在线办理" />
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="card card-hover relative p-5">
              <span className="absolute right-4 top-4 text-3xl font-bold text-slate-100 tnum">{i + 1}</span>
              <span className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-sky-400 text-white">
                <Icon name={s.icon} size={18} />
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-800">{s.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--fg-muted)]">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 出行须知 */}
      <section>
        <SectionTitle title="出行须知" desc="退改规则与时间限制，购票前请先了解" />
        <div className="grid gap-4 sm:grid-cols-2">
          {TIPS.map((t) => (
            <div key={t.title} className={`rounded-xl border px-4 py-3.5 ${t.tone}`}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon name="info" size={15} className="shrink-0" />
                {t.title}
              </div>
              <p className="mt-1.5 pl-6 text-xs leading-relaxed opacity-90">{t.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 系统说明 */}
      <section>
        <SectionTitle title="系统说明" desc="课程演示环境的能力边界与技术要点" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card p-5">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 inline-flex items-center justify-center">
                <Icon name="window" size={16} />
              </span>
              <h3 className="text-sm font-semibold text-slate-800">Mock 第三方服务</h3>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-slate-600">
              实名核验、短信验证码、银行支付均接入本地 Mock 服务，其中收银台为内置页面，会向本系统发送带 HMAC-SHA256 签名的异步回调；
              接口契约与真实服务同构，可通过 <code className="px-1 rounded bg-slate-100 font-mono text-[11px]">PROVIDER_MODE</code> 一键切换。
            </p>
          </div>

          <div className="card p-5">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 inline-flex items-center justify-center">
                <Icon name="seat" size={16} />
              </span>
              <h3 className="text-sm font-semibold text-slate-800">余票与并发模型</h3>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-slate-600">
              余票为「定员 − 已售 − 锁定」，下单后锁定 15 分钟，支付成功后转为已售，超时或取消自动释放；
              扣减在数据库事务内以乐观锁条件更新完成，并发抢票不会超卖。
            </p>
          </div>

          <div className="card p-5">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 inline-flex items-center justify-center">
                <Icon name="refresh" size={16} />
              </span>
              <h3 className="text-sm font-semibold text-slate-800">退改规则</h3>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-slate-600">
              开车前 8 天以上免退票费，48 小时以上收 5%，24 小时以上收 10%，不足 24 小时收 20%（最低 2 元）；
              每张车票仅可改签一次，改签差价自动补收或退还。
            </p>
          </div>

          <div className="card p-5 border-amber-200 bg-amber-50/60">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 inline-flex items-center justify-center">
                <Icon name="alert" size={16} />
              </span>
              <h3 className="text-sm font-semibold text-amber-900">演示提醒</h3>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-amber-800">
              本项目为软件工程基础实验课程作品，全部数据为虚构演示数据，
              <strong>请勿填写真实身份证号、手机号与银行卡号</strong>，系统不涉及任何真实资金流转。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
