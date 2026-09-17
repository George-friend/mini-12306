import { Router } from 'express';
import { z } from 'zod';
import { prisma, getIntSetting } from '../db';
import { ApiError, Errors, ok, wrap } from '../lib/http';
import { combineDateTime, cnDateString } from '../lib/datetime';
import { newOrderNo, newOutTradeNo, newPaymentNo } from '../lib/ids';
import { requireAuth } from '../middleware/auth';
import { lockSeats, releaseLockedSeats, availableOf } from '../services/inventory';
import { allocateSeatNos, studentAllowed, childNeedsAdult, TICKET_TYPE_DISCOUNT } from '../services/pricing';
import { buildOrderView, loadOrder } from '../services/orderView';
import { paymentProvider } from '../providers/mock';

export const orderRouter = Router();

const createSchema = z.object({
  scheduleId: z.number().int().positive(),
  seatClass: z.string().min(2),
  passengerIds: z.array(z.number().int().positive()).min(1).max(5),
  channel: z.enum(['WEB', 'APP', 'CLERK']).optional(),
  remark: z.string().max(100).optional(),
});

/** 下单核心逻辑（供旅客端与售票窗口复用） */
export async function createOrder(input: {
  userId: number;
  scheduleId: number;
  seatClass: string;
  passengerIds: number[];
  channel?: 'WEB' | 'APP' | 'CLERK';
  remark?: string;
  idempotencyKey?: string | null;
  operatorId?: number;
}) {
  const maxPerOrder = await getIntSetting('order.max_tickets_per_order', 5);
  const maxPending = await getIntSetting('order.max_pending_orders', 3);
  const payTimeout = await getIntSetting('order.pay_timeout_minutes', 15);
  const saleStop = await getIntSetting('ticket.sale_stop_minutes', 30);
  const minRefundFee = await getIntSetting('ticket.min_refund_fee_cents', 200);

  if (input.passengerIds.length > maxPerOrder) throw new ApiError(1001, `单笔订单最多购买 ${maxPerOrder} 张`, 400);

  // 幂等：同一幂等键直接返回首次结果
  if (input.idempotencyKey) {
    const existed = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existed) return { order: await loadOrder(existed.orderNo), idempotent: true };
  }

  const schedule = await prisma.trainSchedule.findUnique({
    where: { id: input.scheduleId },
    include: { train: { include: { fromStation: true, toStation: true } }, inventory: true },
  });
  if (!schedule) throw Errors.notFound('运行计划不存在');
  if (schedule.status === 'CANCELLED') throw new ApiError(3002, '该车次已停运，无法购票', 400);

  const departAt = combineDateTime(schedule.runDate, schedule.train.departTime);
  const now = new Date();
  if (departAt.getTime() - now.getTime() < saleStop * 60000) {
    throw new ApiError(3003, `距发车不足 ${saleStop} 分钟，已停止售票`, 400);
  }

  const inventory = schedule.inventory.find((i) => i.seatClass === input.seatClass);
  if (!inventory) throw new ApiError(4001, '该车次不发售所选席别', 409);
  if (availableOf(inventory) < input.passengerIds.length) {
    throw new ApiError(4001, `余票不足，当前仅剩 ${availableOf(inventory)} 张`, 409);
  }

  // 待支付订单上限
  const pendingCount = await prisma.order.count({ where: { userId: input.userId, status: 'PENDING_PAYMENT', expireAt: { gt: now } } });
  if (pendingCount >= maxPending) throw new ApiError(5001, `您有 ${pendingCount} 笔待支付订单，请先支付或取消后再下单`, 409);

  const passengers = await prisma.passenger.findMany({ where: { id: { in: input.passengerIds }, userId: input.userId, isDeleted: false } });
  if (passengers.length !== input.passengerIds.length) throw new ApiError(4003, '乘车人信息与当前账号不匹配', 400);

  // 票种规则（BR-13 / BR-14）
  if (childNeedsAdult(passengers.map((p) => p.passengerType))) {
    throw new ApiError(1001, '儿童票需至少有一名成人同行', 400);
  }
  for (const p of passengers) {
    if (p.passengerType === 'STUDENT' && !studentAllowed(input.seatClass)) {
      throw new ApiError(1001, '学生票仅限购买二等座或硬座', 400);
    }
  }

  // 重复购买校验（BR-18 简化：同一乘车人同一运行日只能有一张有效车票）
  const conflict = await prisma.orderItem.findFirst({
    where: {
      passengerId: { in: input.passengerIds },
      isDeleted: false,
      ticketStatus: { in: ['LOCKED', 'TICKETED', 'REFUNDING'] },
      order: { schedule: { runDate: schedule.runDate } },
    },
    include: { passenger: true },
  });
  if (conflict) {
    throw new ApiError(4004, `乘车人「${conflict.passengerName}」在 ${schedule.runDate} 已有有效车票，不可重复购买`, 400);
  }

  const expireAt = new Date(now.getTime() + payTimeout * 60000);
  const orderNo = newOrderNo();

  // 事务：锁库存 + 建订单 + 建车票
  const created = await prisma.$transaction(async (tx) => {
    const locked = await lockSeats(tx, schedule.id, input.seatClass, passengers.length);
    const startIndex = locked.soldCount + locked.lockedCount;
    const seatNos = allocateSeatNos(input.seatClass, startIndex, passengers.length);

    const itemsData = passengers.map((p, idx) => {
      const price = Math.round(inventory.priceCents * (TICKET_TYPE_DISCOUNT[p.passengerType] ?? 1));
      return {
        passengerId: p.id,
        passengerName: p.name,
        idCardSuffix: p.idCardSuffix,
        seatClass: input.seatClass,
        ticketType: p.passengerType,
        priceCents: price,
        seatNo: seatNos[idx],
        ticketStatus: 'LOCKED',
      };
    });

    const total = itemsData.reduce((sum, it) => sum + it.priceCents, 0);

    const order = await tx.order.create({
      data: {
        orderNo,
        userId: input.userId,
        scheduleId: schedule.id,
        channel: input.channel ?? 'WEB',
        passengerCount: passengers.length,
        totalAmountCents: total,
        status: 'PENDING_PAYMENT',
        idempotencyKey: input.idempotencyKey ?? null,
        expireAt,
        remark: input.remark ?? null,
        items: { create: itemsData },
      },
    });

    return order;
  });

  void minRefundFee; // 退票费下限在退票环节使用
  return { order: await loadOrder(created.orderNo), idempotent: false };
}

/** POST /orders 创建订单 */
orderRouter.post(
  '/orders',
  requireAuth,
  wrap(async (req, res) => {
    const body = createSchema.parse(req.body);
    const idempotencyKey = (req.headers['idempotency-key'] as string) || null;
    const result = await createOrder({
      userId: req.user!.id,
      scheduleId: body.scheduleId,
      seatClass: body.seatClass,
      passengerIds: body.passengerIds,
      channel: body.channel ?? 'WEB',
      remark: body.remark,
      idempotencyKey,
    });
    return ok(res, buildOrderView(result.order!), result.idempotent ? '订单已存在（幂等返回）' : '下单成功，请在规定时间内完成支付');
  }),
);

/** GET /orders 我的订单列表 */
orderRouter.get(
  '/orders',
  requireAuth,
  wrap(async (req, res) => {
    const status = String(req.query.status ?? '').trim();
    const page = Math.max(Number(req.query.page ?? 1), 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 10), 1), 50);

    const where = { userId: req.user!.id, ...(status ? { status } : {}) };
    const [total, list] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);

    // 惰性过期处理（BR-01）
    const views = [];
    for (const o of list) {
      if (o.status === 'PENDING_PAYMENT' && o.expireAt.getTime() <= Date.now()) {
        await expireOrder(o.orderNo);
      }
    }
    const refreshed = await prisma.order.findMany({ where: { id: { in: list.map((o) => o.id) } }, include: { schedule: { include: { train: { include: { fromStation: true, toStation: true } } } }, items: { include: { refunds: true, changesOld: true } }, payments: true, user: true } });
    for (const o of refreshed.sort((a, b) => b.id - a.id)) views.push(buildOrderView(o));

    return ok(res, { total, page, pageSize, list: views });
  }),
);

/** GET /orders/:orderNo 订单详情 */
orderRouter.get(
  '/orders/:orderNo',
  requireAuth,
  wrap(async (req, res) => {
    const order = await loadOrder(req.params.orderNo);
    if (!order) throw Errors.notFound('订单不存在');
    const isOwner = order.userId === req.user!.id;
    const isStaff = req.user!.role === 'CLERK' || req.user!.role === 'ADMIN';
    if (!isOwner && !isStaff) throw Errors.forbidden('无权查看他人订单');
    if (order.status === 'PENDING_PAYMENT' && order.expireAt.getTime() <= Date.now()) await expireOrder(order.orderNo);
    const fresh = await loadOrder(req.params.orderNo);
    return ok(res, buildOrderView(fresh!, { withUser: isStaff }));
  }),
);

/** POST /orders/:orderNo/cancel 取消未支付订单 */
orderRouter.post(
  '/orders/:orderNo/cancel',
  requireAuth,
  wrap(async (req, res) => {
    const order = await loadOrder(req.params.orderNo);
    if (!order) throw Errors.notFound('订单不存在');
    if (order.userId !== req.user!.id && req.user!.role === 'PASSENGER') throw Errors.forbidden('无权操作他人订单');
    if (order.status !== 'PENDING_PAYMENT') throw new ApiError(5001, `订单当前状态为「${order.status}」，不可取消`, 409);

    await prisma.$transaction(async (tx) => {
      await releaseLockedSeats(tx, order.scheduleId, order.items[0].seatClass, order.passengerCount);
      await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { ticketStatus: 'CANCELLED' } });
      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'CLOSED', failReason: '订单已取消' } });
    });

    const fresh = await loadOrder(order.orderNo);
    return ok(res, buildOrderView(fresh!), '订单已取消，余票已释放');
  }),
);

/** POST /orders/:orderNo/pay 发起支付，返回 Mock 收银台地址 */
orderRouter.post(
  '/orders/:orderNo/pay',
  requireAuth,
  wrap(async (req, res) => {
    const order = await loadOrder(req.params.orderNo);
    if (!order) throw Errors.notFound('订单不存在');
    if (order.userId !== req.user!.id && req.user!.role === 'PASSENGER') throw Errors.forbidden('无权支付他人订单');
    if (order.status === 'PENDING_PAYMENT' && order.expireAt.getTime() <= Date.now()) {
      await expireOrder(order.orderNo);
      throw new ApiError(5002, '订单已超时关闭，请重新下单', 410);
    }
    if (order.status !== 'PENDING_PAYMENT') throw new ApiError(5001, `订单当前状态为「${order.status}」，无需支付`, 409);

    let payment = await prisma.payment.findFirst({ where: { orderId: order.id, type: 'PAY', status: 'PENDING' } });
    if (!payment) {
      payment = await prisma.payment.create({
        data: {
          paymentNo: newPaymentNo(),
          orderId: order.id,
          type: 'PAY',
          amountCents: order.totalAmountCents,
          method: 'MOCK_BANK',
          status: 'PENDING',
          outTradeNo: newOutTradeNo(),
        },
      });
    }

    const created = await paymentProvider.create({
      outTradeNo: payment.outTradeNo,
      amountCents: payment.amountCents,
      subject: `${order.schedule.train.trainNo} ${order.schedule.runDate} 车票`,
    });

    return ok(
      res,
      {
        outTradeNo: payment.outTradeNo,
        tradeNo: created.tradeNo,
        payUrl: created.payUrl,
        amountCents: payment.amountCents,
        amountYuan: (payment.amountCents / 100).toFixed(2),
        expireAt: order.expireAt,
      },
      '支付单已创建，请前往 Mock 银行收银台完成支付',
    );
  }),
);

/** 订单超时关闭（释放锁票）——惰性检查与定时任务共用 */
export async function expireOrder(orderNo: string) {
  const order = await prisma.order.findUnique({ where: { orderNo }, include: { items: true } });
  if (!order || order.status !== 'PENDING_PAYMENT') return false;
  if (order.expireAt.getTime() > Date.now()) return false;

  await prisma.$transaction(async (tx) => {
    const seatClass = order.items[0]?.seatClass;
    if (seatClass) await releaseLockedSeats(tx, order.scheduleId, seatClass, order.passengerCount);
    await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { ticketStatus: 'CANCELLED' } });
    await tx.order.update({ where: { id: order.id }, data: { status: 'EXPIRED' } });
    await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'CLOSED', failReason: '订单超时关闭' } });
  });
  return true;
}

/** 批量扫描超时订单（定时任务调用） */
export async function expireOutdatedOrders(): Promise<number> {
  const list = await prisma.order.findMany({ where: { status: 'PENDING_PAYMENT', expireAt: { lte: new Date() } }, select: { orderNo: true } });
  let n = 0;
  for (const o of list) {
    if (await expireOrder(o.orderNo)) n += 1;
  }
  return n;
}

export { cnDateString };
