import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, Errors, ok, wrap } from '../lib/http';
import { addDays, cnDateString } from '../lib/datetime';
import { hashPassword } from '../lib/crypto';
import { newVerifyCode } from '../lib/ids';
import { requireAuth, requireRole } from '../middleware/auth';
import { computePrice, seatClassesForTrainType, SEAT_CLASS_CAPACITY, SEAT_CLASS_LABEL } from '../services/pricing';
import { availableOf } from '../services/inventory';
import { buildOrderView } from '../services/orderView';
import { writeAudit } from '../services/audit';
import { expireOutdatedOrders } from './orders';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'));

/* ── 运营概览 ───────────────────────────────────────────── */
adminRouter.get(
  '/stats/overview',
  wrap(async (_req, res) => {
    const today = cnDateString(new Date());
    const [orderCount, paidOrders, refundCount, ticketCount, userCount, trainCount] = await Promise.all([
      prisma.order.count(),
      prisma.order.findMany({ where: { status: { in: ['PAID', 'PARTIAL_REFUNDED', 'REFUNDED', 'CHANGED', 'CLOSED'] } }, select: { totalAmountCents: true } }),
      prisma.refund.count(),
      prisma.orderItem.count({ where: { ticketStatus: { in: ['TICKETED', 'USED'] } } }),
      prisma.user.count(),
      prisma.train.count({ where: { isActive: true } }),
    ]);

    const paidTotal = paidOrders.reduce((s, o) => s + o.totalAmountCents, 0);
    const refundTotal = (await prisma.refund.aggregate({ _sum: { refundCents: true } }))._sum.refundCents ?? 0;

    // 热门线路 Top5
    const items = await prisma.orderItem.findMany({
      include: { order: { include: { schedule: { include: { train: { include: { fromStation: true, toStation: true } } } } } } },
      take: 500,
      orderBy: { id: 'desc' },
    });
    const routeMap = new Map<string, number>();
    const classMap = new Map<string, number>();
    for (const it of items) {
      const t = it.order.schedule.train;
      const key = `${t.fromStation.name} → ${t.toStation.name}`;
      routeMap.set(key, (routeMap.get(key) ?? 0) + 1);
      classMap.set(it.seatClass, (classMap.get(it.seatClass) ?? 0) + 1);
    }

    const todayOrders = await prisma.order.count({ where: { createdAt: { gte: new Date(`${today}T00:00:00+08:00`) } } });

    return ok(res, {
      today,
      todayOrders,
      orderCount,
      paidOrderCount: paidOrders.length,
      paidTotalCents: paidTotal,
      paidTotalYuan: (paidTotal / 100).toFixed(2),
      refundCount,
      refundTotalCents: refundTotal,
      refundTotalYuan: (refundTotal / 100).toFixed(2),
      ticketCount,
      userCount,
      trainCount,
      refundRate: paidOrders.length ? ((refundCount / paidOrders.length) * 100).toFixed(1) + '%' : '0%',
      topRoutes: [...routeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([route, count]) => ({ route, count })),
      seatClassStat: [...classMap.entries()].map(([seatClass, count]) => ({ seatClass, label: SEAT_CLASS_LABEL[seatClass] ?? seatClass, count })),
    });
  }),
);

/* ── 车站维护 ───────────────────────────────────────────── */
adminRouter.get(
  '/stations',
  wrap(async (_req, res) => ok(res, { list: await prisma.station.findMany({ orderBy: { id: 'asc' } }) })),
);

adminRouter.post(
  '/stations',
  wrap(async (req, res) => {
    const body = z
      .object({ code: z.string().min(2).max(6), name: z.string().min(2), city: z.string().min(2), province: z.string().min(2), pinyin: z.string().min(1) })
      .parse(req.body);
    const exists = await prisma.station.findUnique({ where: { code: body.code.toUpperCase() } });
    if (exists) throw new ApiError(2002, '该电报码已存在', 409);
    const created = await prisma.station.create({ data: { ...body, code: body.code.toUpperCase() } });
    await writeAudit(req, 'CREATE_STATION', 'station', created.id, body);
    return ok(res, created, '车站已新增');
  }),
);

adminRouter.put(
  '/stations/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const body = z.object({ name: z.string().min(2).optional(), city: z.string().optional(), province: z.string().optional(), pinyin: z.string().optional(), isActive: z.boolean().optional() }).parse(req.body);
    const updated = await prisma.station.update({ where: { id }, data: body });
    await writeAudit(req, 'UPDATE_STATION', 'station', id, body);
    return ok(res, updated, '车站已更新');
  }),
);

adminRouter.delete(
  '/stations/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const used = await prisma.train.count({ where: { OR: [{ fromStationId: id }, { toStationId: id }] } });
    if (used > 0) throw new ApiError(1001, `该车站已被 ${used} 个车次引用，不可删除`, 400);
    await prisma.station.delete({ where: { id } });
    await writeAudit(req, 'DELETE_STATION', 'station', id);
    return ok(res, null, '车站已删除');
  }),
);

/* ── 车次维护 ───────────────────────────────────────────── */
adminRouter.get(
  '/trains',
  wrap(async (_req, res) => {
    const list = await prisma.train.findMany({
      include: { fromStation: true, toStation: true, _count: { select: { schedules: true } } },
      orderBy: { trainNo: 'asc' },
    });
    return ok(res, {
      list: list.map((t) => ({
        id: t.id,
        trainNo: t.trainNo,
        trainType: t.trainType,
        fromStation: t.fromStation.name,
        toStation: t.toStation.name,
        departTime: t.departTime,
        arriveTime: t.arriveTime,
        durationMin: t.durationMin,
        mileageKm: t.mileageKm,
        basePriceYuan: (t.basePriceCents / 100).toFixed(2),
        isActive: t.isActive,
        scheduleCount: t._count.schedules,
      })),
    });
  }),
);

adminRouter.post(
  '/trains',
  wrap(async (req, res) => {
    const body = z
      .object({
        trainNo: z.string().min(2).max(8),
        trainType: z.enum(['G', 'D', 'T', 'K', 'Z']),
        fromStationId: z.number().int().positive(),
        toStationId: z.number().int().positive(),
        departTime: z.string().regex(/^\d{2}:\d{2}$/),
        arriveTime: z.string().regex(/^\d{2}:\d{2}$/),
        durationMin: z.number().int().positive(),
        mileageKm: z.number().int().positive(),
        basePriceCents: z.number().int().positive(),
      })
      .parse(req.body);
    if (body.fromStationId === body.toStationId) throw new ApiError(1001, '出发站与到达站不能相同', 400);
    const exists = await prisma.train.findUnique({ where: { trainNo: body.trainNo.toUpperCase() } });
    if (exists) throw new ApiError(2002, '该车次号已存在', 409);
    const created = await prisma.train.create({ data: { ...body, trainNo: body.trainNo.toUpperCase() } });
    await writeAudit(req, 'CREATE_TRAIN', 'train', created.id, body);
    return ok(res, created, '车次已新增');
  }),
);

adminRouter.put(
  '/trains/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const body = z
      .object({
        departTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        arriveTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        durationMin: z.number().int().positive().optional(),
        mileageKm: z.number().int().positive().optional(),
        basePriceCents: z.number().int().positive().optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    const updated = await prisma.train.update({ where: { id }, data: body });
    await writeAudit(req, 'UPDATE_TRAIN', 'train', id, body);
    return ok(res, updated, '车次已更新');
  }),
);

adminRouter.delete(
  '/trains/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const sold = await prisma.order.count({ where: { schedule: { trainId: id } } });
    if (sold > 0) throw new ApiError(1001, '该车次已有订单，建议改为「停用」而非删除', 400);
    await prisma.seatInventory.deleteMany({ where: { schedule: { trainId: id } } });
    await prisma.trainSchedule.deleteMany({ where: { trainId: id } });
    await prisma.train.delete({ where: { id } });
    await writeAudit(req, 'DELETE_TRAIN', 'train', id);
    return ok(res, null, '车次已删除');
  }),
);

/** 批量生成运行日（含席别库存与票价） */
adminRouter.post(
  '/trains/:id/schedules',
  wrap(async (req, res) => {
    const trainId = Number(req.params.id);
    const body = z.object({ startDate: z.string(), endDate: z.string() }).parse(req.body);
    const train = await prisma.train.findUnique({ where: { id: trainId } });
    if (!train) throw Errors.notFound('车次不存在');
    if (body.endDate < body.startDate) throw new ApiError(1001, '结束日期不能早于开始日期', 400);

    const classes = seatClassesForTrainType(train.trainType);
    let created = 0;
    let cursor = body.startDate;
    let guard = 0;
    while (cursor <= body.endDate && guard < 120) {
      guard += 1;
      const exist = await prisma.trainSchedule.findUnique({ where: { trainId_runDate: { trainId, runDate: cursor } } });
      if (!exist) {
        const schedule = await prisma.trainSchedule.create({ data: { trainId, runDate: cursor } });
        for (const sc of classes) {
          await prisma.seatInventory.create({
            data: {
              scheduleId: schedule.id,
              seatClass: sc,
              priceCents: sc === 'STANDING' ? computePrice(train.basePriceCents, 'SECOND', 'ADULT', train.mileageKm) : computePrice(train.basePriceCents, sc, 'ADULT', train.mileageKm),
              totalCount: SEAT_CLASS_CAPACITY[sc] ?? 100,
            },
          });
        }
        created += 1;
      }
      cursor = addDays(cursor, 1);
    }
    await writeAudit(req, 'GENERATE_SCHEDULES', 'train', trainId, { ...body, created });
    return ok(res, { created }, `已生成 ${created} 个运行日`);
  }),
);

/* ── 运行日与库存 ───────────────────────────────────────── */
adminRouter.get(
  '/schedules',
  wrap(async (req, res) => {
    const runDate = String(req.query.date ?? '') || cnDateString(new Date());
    const trainNo = String(req.query.trainNo ?? '').toUpperCase();
    const list = await prisma.trainSchedule.findMany({
      where: { runDate, ...(trainNo ? { train: { trainNo: { contains: trainNo } } } : {}) },
      include: { train: { include: { fromStation: true, toStation: true } }, inventory: true },
      orderBy: { id: 'asc' },
      take: 200,
    });
    return ok(res, {
      runDate,
      list: list.map((s) => ({
        id: s.id,
        trainNo: s.train.trainNo,
        route: `${s.train.fromStation.name} → ${s.train.toStation.name}`,
        departTime: s.train.departTime,
        runDate: s.runDate,
        status: s.status,
        delayMinutes: s.delayMinutes,
        note: s.note,
        inventory: s.inventory.map((i) => ({
          id: i.id,
          seatClass: i.seatClass,
          seatClassLabel: SEAT_CLASS_LABEL[i.seatClass] ?? i.seatClass,
          priceCents: i.priceCents,
          priceYuan: (i.priceCents / 100).toFixed(2),
          totalCount: i.totalCount,
          soldCount: i.soldCount,
          lockedCount: i.lockedCount,
          available: availableOf(i),
        })),
      })),
    });
  }),
);

adminRouter.put(
  '/schedules/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const body = z.object({ status: z.enum(['NORMAL', 'DELAYED', 'CANCELLED']).optional(), delayMinutes: z.number().int().min(0).optional(), note: z.string().max(200).optional() }).parse(req.body);
    const updated = await prisma.trainSchedule.update({ where: { id }, data: body });
    await writeAudit(req, 'UPDATE_SCHEDULE', 'schedule', id, body);
    return ok(res, updated, '运行日状态已更新');
  }),
);

adminRouter.put(
  '/inventory/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const body = z.object({ priceCents: z.number().int().positive().optional(), totalCount: z.number().int().min(0).optional() }).parse(req.body);
    const inv = await prisma.seatInventory.findUnique({ where: { id } });
    if (!inv) throw Errors.notFound('库存记录不存在');
    if (body.totalCount !== undefined && body.totalCount < inv.soldCount + inv.lockedCount) {
      throw new ApiError(1001, `定员不可低于已售 + 已锁定（${inv.soldCount + inv.lockedCount}）`, 400);
    }
    const updated = await prisma.seatInventory.update({ where: { id }, data: { ...body, version: { increment: 1 } } });
    await writeAudit(req, 'UPDATE_INVENTORY', 'inventory', id, body);
    return ok(res, updated, '票价 / 定员已更新');
  }),
);

/* ── 订单检索 ───────────────────────────────────────────── */
adminRouter.get(
  '/orders',
  wrap(async (req, res) => {
    const status = String(req.query.status ?? '').trim();
    const keyword = String(req.query.keyword ?? '').trim();
    const page = Math.max(Number(req.query.page ?? 1), 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 10), 1), 50);

    const where = {
      ...(status ? { status } : {}),
      ...(keyword ? { OR: [{ orderNo: { contains: keyword } }, { user: { username: { contains: keyword } } }, { user: { realName: { contains: keyword } } }] } : {}),
    };
    const [total, list] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: { user: true, schedule: { include: { train: { include: { fromStation: true, toStation: true } } } }, items: { include: { refunds: true, changesOld: true } }, payments: true },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return ok(res, { total, page, pageSize, list: list.map((o) => buildOrderView(o, { withUser: true })) });
  }),
);

/* ── 用户管理 ───────────────────────────────────────────── */
adminRouter.get(
  '/users',
  wrap(async (req, res) => {
    const keyword = String(req.query.keyword ?? '').trim();
    const list = await prisma.user.findMany({
      where: keyword ? { OR: [{ username: { contains: keyword } }, { realName: { contains: keyword } }, { phone: { contains: keyword } }] } : {},
      orderBy: { id: 'asc' },
      take: 200,
    });
    return ok(res, {
      list: list.map((u) => ({
        id: u.id,
        username: u.username,
        realName: u.realName,
        phone: u.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
        idCardMasked: `**************${u.idCardSuffix}`,
        role: u.role,
        status: u.status,
        isVerified: u.isVerified,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
      })),
    });
  }),
);

adminRouter.patch(
  '/users/:id/status',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const body = z.object({ status: z.enum(['ACTIVE', 'FROZEN']) }).parse(req.body);
    if (id === req.user!.id) throw new ApiError(1001, '不能冻结当前登录的管理员账号', 400);
    const updated = await prisma.user.update({ where: { id }, data: { status: body.status, loginFailCount: 0, lockedUntil: null } });
    await writeAudit(req, 'UPDATE_USER_STATUS', 'user', id, body);
    return ok(res, { id: updated.id, status: updated.status }, body.status === 'FROZEN' ? '账号已冻结' : '账号已解冻');
  }),
);

adminRouter.post(
  '/users/:id/reset-password',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const newPassword = `Mk${newVerifyCode()}`;
    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(newPassword), loginFailCount: 0, lockedUntil: null } });
    await writeAudit(req, 'RESET_PASSWORD', 'user', id);
    return ok(res, { newPassword }, `密码已重置为 ${newPassword}`);
  }),
);

/* ── 公告 ───────────────────────────────────────────────── */
adminRouter.get(
  '/announcements',
  wrap(async (_req, res) => ok(res, { list: await prisma.announcement.findMany({ orderBy: { id: 'desc' }, take: 100 }) })),
);

adminRouter.post(
  '/announcements',
  wrap(async (req, res) => {
    const body = z
      .object({
        title: z.string().min(2).max(60),
        content: z.string().min(2).max(500),
        type: z.enum(['SYSTEM', 'DELAY', 'CANCEL', 'NOTICE']),
        trainNo: z.string().max(8).optional().or(z.literal('')),
        runDate: z.string().max(10).optional().or(z.literal('')),
        /** 联动：发布晚点/停运时同步更新运行日状态 */
        syncSchedule: z.boolean().optional(),
      })
      .parse(req.body);

    const created = await prisma.announcement.create({
      data: {
        title: body.title,
        content: body.content,
        type: body.type,
        trainNo: body.trainNo || null,
        runDate: body.runDate || null,
        status: 'PUBLISHED',
        publisherId: req.user!.id,
        publishedAt: new Date(),
      },
    });

    if (body.syncSchedule && body.trainNo && body.runDate && (body.type === 'DELAY' || body.type === 'CANCEL')) {
      const train = await prisma.train.findUnique({ where: { trainNo: body.trainNo.toUpperCase() } });
      if (train) {
        await prisma.trainSchedule.updateMany({
          where: { trainId: train.id, runDate: body.runDate },
          data: { status: body.type === 'CANCEL' ? 'CANCELLED' : 'DELAYED', note: body.content.slice(0, 100) },
        });
      }
    }

    await writeAudit(req, 'CREATE_ANNOUNCEMENT', 'announcement', created.id, body);
    return ok(res, created, '公告已发布');
  }),
);

adminRouter.put(
  '/announcements/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const body = z.object({ status: z.enum(['DRAFT', 'PUBLISHED', 'OFFLINE']).optional(), title: z.string().optional(), content: z.string().optional() }).parse(req.body);
    const updated = await prisma.announcement.update({ where: { id }, data: body });
    await writeAudit(req, 'UPDATE_ANNOUNCEMENT', 'announcement', id, body);
    return ok(res, updated, '公告已更新');
  }),
);

adminRouter.delete(
  '/announcements/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.announcement.delete({ where: { id } });
    await writeAudit(req, 'DELETE_ANNOUNCEMENT', 'announcement', id);
    return ok(res, null, '公告已删除');
  }),
);

/* ── 系统参数 ───────────────────────────────────────────── */
adminRouter.get(
  '/settings',
  wrap(async (_req, res) => {
    const list = await prisma.systemSetting.findMany({ orderBy: [{ groupName: 'asc' }, { key: 'asc' }] });
    return ok(res, { list });
  }),
);

adminRouter.put(
  '/settings/:key',
  wrap(async (req, res) => {
    const key = req.params.key;
    const body = z.object({ value: z.string() }).parse(req.body);
    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    if (!existing) throw Errors.notFound(`参数 ${key} 不存在`);
    if (existing.valueType === 'INT' && !/^\d+$/.test(body.value)) throw new ApiError(1001, '该参数必须是整数', 400);
    if (existing.valueType === 'BOOL' && !['true', 'false'].includes(body.value)) throw new ApiError(1001, '该参数必须是 true 或 false', 400);
    const updated = await prisma.systemSetting.update({ where: { key }, data: { value: body.value, updatedBy: req.user!.id } });
    await writeAudit(req, 'UPDATE_SETTING', 'setting', key, { from: existing.value, to: body.value });
    return ok(res, updated, '系统参数已更新（立即生效）');
  }),
);

/** POST /admin/jobs/expire-orders 手动触发超时订单释放（也可由定时任务调用） */
adminRouter.post(
  '/jobs/expire-orders',
  wrap(async (req, res) => {
    const n = await expireOutdatedOrders();
    await writeAudit(req, 'JOB_EXPIRE_ORDERS', 'job', 'expire-orders', { released: n });
    return ok(res, { released: n }, `已释放 ${n} 笔超时订单`);
  }),
);

/* ── 审计日志 ───────────────────────────────────────────── */
adminRouter.get(
  '/audit-logs',
  wrap(async (req, res) => {
    const action = String(req.query.action ?? '').trim();
    const page = Math.max(Number(req.query.page ?? 1), 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 100);
    const where = action ? { action: { contains: action } } : {};
    const [total, list] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return ok(res, { total, page, pageSize, list });
  }),
);
