import { Router } from 'express';
import { prisma } from '../db';
import { ApiError, Errors, ok, wrap } from '../lib/http';
import { combineDateTime, cnDateString, formatDuration } from '../lib/datetime';
import { SEAT_CLASS_LABEL, allocateSeatNos } from '../services/pricing';
import { availableOf } from '../services/inventory';

export const publicRouter = Router();

/** 余票展示文案（BR-16） */
export function availableText(n: number): string {
  if (n <= 0) return '无票';
  if (n >= 20) return '有票';
  return String(n);
}

/** 组装车次视图（含各席别余票与票价） */
function buildTrainView(
  train: {
    id: number;
    trainNo: string;
    trainType: string;
    departTime: string;
    arriveTime: string;
    durationMin: number;
    mileageKm: number;
    fromStation: { name: string; city: string };
    toStation: { name: string; city: string };
  },
  schedule: { id: number; runDate: string; status: string; delayMinutes: number; note: string | null },
  inventory: Array<{ seatClass: string; priceCents: number; totalCount: number; soldCount: number; lockedCount: number }>,
) {
  const seats = inventory.map((inv) => ({
    seatClass: inv.seatClass,
    seatClassLabel: SEAT_CLASS_LABEL[inv.seatClass] ?? inv.seatClass,
    priceCents: inv.priceCents,
    priceYuan: (inv.priceCents / 100).toFixed(2),
    total: inv.totalCount,
    available: availableOf(inv),
    availableText: availableText(availableOf(inv)),
  }));

  const minPrice = seats.length ? Math.min(...seats.map((s) => s.priceCents)) : 0;

  return {
    trainId: train.id,
    trainNo: train.trainNo,
    trainType: train.trainType,
    fromStation: train.fromStation.name,
    fromCity: train.fromStation.city,
    toStation: train.toStation.name,
    toCity: train.toStation.city,
    runDate: schedule.runDate,
    departTime: train.departTime,
    arriveTime: train.arriveTime,
    departDateTime: combineDateTime(schedule.runDate, train.departTime).toISOString(),
    durationMin: train.durationMin,
    durationText: formatDuration(train.durationMin),
    mileageKm: train.mileageKm,
    minPriceCents: minPrice,
    minPriceYuan: (minPrice / 100).toFixed(2),
    scheduleId: schedule.id,
    scheduleStatus: schedule.status,
    scheduleStatusText: schedule.status === 'NORMAL' ? '正点' : schedule.status === 'DELAYED' ? `晚点${schedule.delayMinutes}分` : '停运',
    delayMinutes: schedule.delayMinutes,
    note: schedule.note,
    purchasable: schedule.status !== 'CANCELLED',
    seats,
  };
}

/** GET /stations 车站字典 */
publicRouter.get(
  '/stations',
  wrap(async (req, res) => {
    const keyword = String(req.query.keyword ?? '').trim();
    const list = await prisma.station.findMany({
      where: {
        isActive: true,
        ...(keyword
          ? { OR: [{ name: { contains: keyword } }, { city: { contains: keyword } }, { pinyin: { contains: keyword } }, { code: { contains: keyword.toUpperCase() } }] }
          : {}),
      },
      orderBy: { id: 'asc' },
    });
    return ok(res, { list });
  }),
);

/** 把「车站名 / 电报码 / 城市名」解析为唯一车站（优先级：站名 > 电报码 > 城市 > 模糊包含） */
export async function resolveStation(input: string) {
  const v = input.trim();
  if (!v) return null;
  const byName = await prisma.station.findFirst({ where: { isActive: true, name: v }, orderBy: { id: 'asc' } });
  if (byName) return byName;
  const byCode = await prisma.station.findFirst({ where: { isActive: true, code: v.toUpperCase() }, orderBy: { id: 'asc' } });
  if (byCode) return byCode;
  const byCity = await prisma.station.findFirst({ where: { isActive: true, city: v }, orderBy: { id: 'asc' } });
  if (byCity) return byCity;
  return prisma.station.findFirst({ where: { isActive: true, name: { contains: v } }, orderBy: { id: 'asc' } });
}

/**
 * 车站/城市解析为「车站集合」。
 * 与真实 12306 一致：输入城市名（如「北京」「上海」）时，检索该城市下的**所有车站**
 * （北京南 + 北京西），而不是只挑一个，否则「北京 → 上海」这类查询会查不到车。
 */
export interface StationGroup {
  ids: number[];
  label: string;
  city: string;
  isCity: boolean;
  names: string[];
}

export async function resolveStationGroup(input: string): Promise<StationGroup | null> {
  const v = input.trim();
  if (!v) return null;

  const exact = await prisma.station.findFirst({ where: { isActive: true, name: v } });
  if (exact) {
    // 「上海」这类站名与城市名相同的车站：按**城市**处理，覆盖同城全部车站（与真实 12306 一致），
    // 否则「上海 → 北京」会因只查上海站而查不到任何车次。
    if (exact.name === exact.city) {
      const sameCity = await prisma.station.findMany({ where: { isActive: true, city: exact.city }, orderBy: { id: 'asc' } });
      if (sameCity.length > 1) {
        return {
          ids: sameCity.map((s) => s.id),
          label: `${exact.city}（${sameCity.map((s) => s.name).join('、')}）`,
          city: exact.city,
          isCity: true,
          names: sameCity.map((s) => s.name),
        };
      }
    }
    return { ids: [exact.id], label: exact.name, city: exact.city, isCity: false, names: [exact.name] };
  }

  const byCode = await prisma.station.findFirst({ where: { isActive: true, code: v.toUpperCase() } });
  if (byCode) return { ids: [byCode.id], label: byCode.name, city: byCode.city, isCity: false, names: [byCode.name] };

  const cityStations = await prisma.station.findMany({ where: { isActive: true, city: v }, orderBy: { id: 'asc' } });
  if (cityStations.length > 0) {
    return {
      ids: cityStations.map((s) => s.id),
      label: cityStations.length > 1 ? `${v}（${cityStations.map((s) => s.name).join('、')}）` : cityStations[0].name,
      city: v,
      isCity: cityStations.length > 1,
      names: cityStations.map((s) => s.name),
    };
  }

  const loose = await prisma.station.findMany({ where: { isActive: true, name: { contains: v } }, orderBy: { id: 'asc' } });
  if (loose.length > 0) {
    return {
      ids: loose.map((s) => s.id),
      label: loose.length > 1 ? `${v}（${loose.map((s) => s.name).join('、')}）` : loose[0].name,
      city: loose[0].city,
      isCity: loose.length > 1,
      names: loose.map((s) => s.name),
    };
  }
  return null;
}

/** GET /trains/search 车次查询（FR-05 / FR-06 / FR-07） */
publicRouter.get(
  '/trains/search',
  wrap(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const fromRaw = (q.from ?? '').trim();
    const toRaw = (q.to ?? '').trim();
    const runDate = (q.date ?? '').trim() || cnDateString(new Date());

    if (!fromRaw || !toRaw) throw new ApiError(1001, '请填写出发站与到达站', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new ApiError(1001, '日期格式应为 yyyy-MM-dd', 400);

    const [fromStation, toStation] = await Promise.all([resolveStationGroup(fromRaw), resolveStationGroup(toRaw)]);
    if (!fromStation) throw new ApiError(1001, `未找到车站「${fromRaw}」`, 400);
    if (!toStation) throw new ApiError(1001, `未找到车站「${toRaw}」`, 400);
    if (fromStation.ids.some((id) => toStation.ids.includes(id))) throw new ApiError(1001, '出发站与到达站不能相同', 400);

    const trains = await prisma.train.findMany({
      where: {
        isActive: true,
        fromStationId: { in: fromStation.ids },
        toStationId: { in: toStation.ids },
        ...(q.trainType ? { trainType: q.trainType } : {}),
      },
      include: { fromStation: true, toStation: true },
    });

    const schedules = await prisma.trainSchedule.findMany({
      where: { runDate, trainId: { in: trains.map((t) => t.id) } },
      include: { inventory: true },
    });
    const scheduleMap = new Map(schedules.map((s) => [s.trainId, s]));

    let list = trains
      .filter((t) => scheduleMap.has(t.id))
      .map((t) => buildTrainView(t, scheduleMap.get(t.id)!, scheduleMap.get(t.id)!.inventory));

    // 席别筛选
    if (q.seatClass) {
      list = list.filter((item) => item.seats.some((s) => s.seatClass === q.seatClass && s.available > 0));
    }
    // 发车时段筛选
    if (q.departFrom) list = list.filter((item) => item.departTime >= q.departFrom!);
    if (q.departTo) list = list.filter((item) => item.departTime <= q.departTo!);

    // 排序
    const sortBy = q.sortBy ?? 'departTime';
    list.sort((a, b) => {
      if (sortBy === 'duration') return a.durationMin - b.durationMin;
      if (sortBy === 'price') return a.minPriceCents - b.minPriceCents;
      return a.departTime.localeCompare(b.departTime);
    });

    return ok(res, {
      from: { id: fromStation.ids[0], name: fromStation.label, city: fromStation.city, isCity: fromStation.isCity, stations: fromStation.names },
      to: { id: toStation.ids[0], name: toStation.label, city: toStation.city, isCity: toStation.isCity, stations: toStation.names },
      runDate,
      total: list.length,
      list,
    });
  }),
);

/** GET /trains/:trainNo 车次详情 */
publicRouter.get(
  '/trains/:trainNo',
  wrap(async (req, res) => {
    const trainNo = req.params.trainNo.toUpperCase();
    const train = await prisma.train.findUnique({
      where: { trainNo },
      include: { fromStation: true, toStation: true },
    });
    if (!train) throw Errors.notFound(`车次 ${trainNo} 不存在`);
    return ok(res, {
      trainNo: train.trainNo,
      trainType: train.trainType,
      fromStation: train.fromStation.name,
      toStation: train.toStation.name,
      departTime: train.departTime,
      arriveTime: train.arriveTime,
      durationMin: train.durationMin,
      durationText: formatDuration(train.durationMin),
      mileageKm: train.mileageKm,
      basePriceYuan: (train.basePriceCents / 100).toFixed(2),
      isActive: train.isActive,
      stops: [
        { seq: 1, station: train.fromStation.name, arriveTime: null, departTime: train.departTime, stayMinutes: 0 },
        { seq: 2, station: train.toStation.name, arriveTime: train.arriveTime, departTime: null, stayMinutes: 0 },
      ],
    });
  }),
);

/** GET /trains/:trainNo/schedule 指定运行日详情 */
publicRouter.get(
  '/trains/:trainNo/schedule',
  wrap(async (req, res) => {
    const trainNo = req.params.trainNo.toUpperCase();
    const runDate = String(req.query.date ?? '') || cnDateString(new Date());
    const train = await prisma.train.findUnique({ where: { trainNo }, include: { fromStation: true, toStation: true } });
    if (!train) throw Errors.notFound(`车次 ${trainNo} 不存在`);
    const schedule = await prisma.trainSchedule.findFirst({ where: { trainId: train.id, runDate }, include: { inventory: true } });
    if (!schedule) throw new ApiError(3001, `${runDate} 该车次没有运行计划`, 404);
    return ok(res, buildTrainView(train, schedule, schedule.inventory));
  }),
);

/** GET /announcements 公告列表 */
publicRouter.get(
  '/announcements',
  wrap(async (req, res) => {
    const limit = Number(req.query.limit ?? 10);
    const list = await prisma.announcement.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 50),
    });
    return ok(res, {
      list: list.map((a) => ({
        id: a.id,
        title: a.title,
        content: a.content,
        type: a.type,
        trainNo: a.trainNo,
        runDate: a.runDate,
        publishedAt: a.publishedAt,
      })),
    });
  }),
);

/** 座位号预览（供前端在确认订单页展示）*/
publicRouter.get(
  '/seats/preview',
  wrap(async (req, res) => {
    const seatClass = String(req.query.seatClass ?? 'SECOND');
    const count = Math.min(Number(req.query.count ?? 1), 5);
    const inv = await prisma.seatInventory.findFirst({ where: { seatClass } });
    const startIndex = inv ? inv.soldCount + inv.lockedCount : 0;
    return ok(res, { seatNos: allocateSeatNos(seatClass, startIndex, count) });
  }),
);
