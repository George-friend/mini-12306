/** 运营概览：核心指标卡 + 热门线路 Top5 + 席别售出占比 + 快捷入口 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { money, yuan } from '../../lib/format';
import { ErrorBox, SectionTitle, Spinner, Stat } from '../../components/ui';

interface TopRoute {
  route: string;
  count: number;
}

interface SeatClassStat {
  seatClass: string;
  label: string;
  count: number;
}

interface Overview {
  today: string;
  todayOrders: number;
  orderCount: number;
  paidOrderCount: number;
  paidTotalCents: number;
  paidTotalYuan: string;
  refundCount: number;
  refundTotalCents: number;
  refundTotalYuan: string;
  ticketCount: number;
  userCount: number;
  trainCount: number;
  refundRate: string;
  topRoutes: TopRoute[];
  seatClassStat: SeatClassStat[];
}

/** 席别条形配色（与 format.seatClassStyle 同源色系，此处取实心色用于进度条） */
const SEAT_BAR: Record<string, string> = {
  BUSINESS: 'bg-violet-500',
  FIRST: 'bg-sky-500',
  SECOND: 'bg-brand-600',
  SOFT_SLEEPER: 'bg-indigo-500',
  HARD_SLEEPER: 'bg-teal-500',
  HARD_SEAT: 'bg-amber-500',
  STANDING: 'bg-slate-400',
};

const SHORTCUTS: Array<{ to: string; title: string; desc: string }> = [
  { to: '/admin/trains', title: '车次管理', desc: '维护车次基础信息与基准票价' },
  { to: '/admin/schedules', title: '运行日与库存', desc: '生成运行日、调整票价定员与正晚点' },
  { to: '/admin/orders', title: '订单管理', desc: '检索全量订单、查看车票与支付流水' },
  { to: '/admin/settings', title: '系统设置', desc: '支付时限、退票费下限、购票截止时间' },
];

/** 横向条形：以 div 宽度百分比实现，不引入图表库 */
function BarRow({ label, value, max, color, suffix }: { label: string; value: number; max: number; color: string; suffix: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-700 truncate pr-3">{label}</span>
        <span className="tnum text-slate-600 shrink-0">
          {value}
          {suffix}
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.get<Overview>('/admin/stats/overview'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spinner label="正在加载运营概览…" />;
  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!data) return <ErrorBox message="未获取到运营数据" onRetry={() => void load()} />;

  const routeMax = data.topRoutes.reduce((m, r) => Math.max(m, r.count), 0);
  const seatTotal = data.seatClassStat.reduce((s, c) => s + c.count, 0);
  const seatMax = data.seatClassStat.reduce((m, c) => Math.max(m, c.count), 0);
  const refundRateNum = Number.parseFloat(data.refundRate);

  return (
    <div className="space-y-5">
      <SectionTitle
        title="运营概览"
        desc={`统计日期 ${data.today}（东八区）· 指标实时来自业务库`}
        extra={
          <button type="button" className="btn-sm btn-ghost" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="今日订单数" value={data.todayOrders} unit="笔" tone="brand" />
        <Stat label="订单总数" value={data.orderCount} unit="笔" />
        <Stat label="支付总金额" value={money(data.paidTotalCents)} tone="success" />
        <Stat label="退票单数" value={data.refundCount} unit="笔" tone={data.refundCount > 0 ? 'warning' : 'default'} />
        <Stat label="退票率" value={data.refundRate} unit={`（已支付 ${data.paidOrderCount} 笔）`} tone={refundRateNum > 20 ? 'warning' : 'default'} />
        <Stat label="在售车次数" value={data.trainCount} unit="个" />
        <Stat label="用户数" value={data.userCount} unit="人" />
        <Stat label="已出票张数" value={data.ticketCount} unit="张" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="card p-5">
          <SectionTitle title="热门线路 Top5" desc="按近 500 条订单明细中的购票张数统计" />
          {data.topRoutes.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">暂无购票数据，生成运行日并完成下单后此处将显示热门线路</p>
          ) : (
            <div className="space-y-0.5">
              {data.topRoutes.map((r, i) => (
                <BarRow key={r.route} label={`${i + 1}. ${r.route}`} value={r.count} max={routeMax} color="bg-brand-600" suffix=" 张" />
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <SectionTitle title="席别售出占比" desc={`共 ${seatTotal} 张车票，按席别分布`} />
          {data.seatClassStat.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">暂无席别售出数据</p>
          ) : (
            <div className="space-y-0.5">
              {data.seatClassStat.map((c) => (
                <BarRow
                  key={c.seatClass}
                  label={`${c.label}（${seatTotal > 0 ? ((c.count / seatTotal) * 100).toFixed(1) : '0.0'}%）`}
                  value={c.count}
                  max={seatMax}
                  color={SEAT_BAR[c.seatClass] ?? 'bg-slate-400'}
                  suffix=" 张"
                />
              ))}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
            <span>
              退款合计 <b className="tnum text-slate-700">￥{data.refundTotalYuan}</b>
            </span>
            <span>
              实收净额 <b className="tnum text-slate-700">￥{yuan(data.paidTotalCents - data.refundTotalCents)}</b>
            </span>
          </div>
        </section>
      </div>

      <section>
        <SectionTitle title="快捷入口" desc="常用后台操作直达" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {SHORTCUTS.map((s) => (
            <Link key={s.to} to={s.to} className="card p-4 hover:border-brand-300 hover:shadow-pop transition-colors">
              <div className="text-sm font-medium text-slate-800">{s.title}</div>
              <div className="mt-1 text-xs text-[var(--fg-muted)] leading-relaxed">{s.desc}</div>
              <div className="mt-3 text-xs text-brand-700">进入 →</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
