import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, Errors, ok, wrap } from '../lib/http';
import { hashIdCard } from '../lib/crypto';
import { validateIdCard } from '../lib/idcard';
import { newOutTradeNo, newPaymentNo } from '../lib/ids';
import { requireAuth, requireRole } from '../middleware/auth';
import { buildOrderView, loadOrder } from '../services/orderView';
import { settlePaySuccess } from './payments';
import { writeAudit } from '../services/audit';

export const clerkRouter = Router();
clerkRouter.use(requireAuth, requireRole('CLERK', 'ADMIN'));

/** GET /clerk/orders/search 按证件号 / 订单号 / 手机号 / 姓名检索 */
clerkRouter.get(
  '/orders/search',
  wrap(async (req, res) => {
    const keyword = String(req.query.keyword ?? '').trim();
    if (!keyword) throw new ApiError(1001, '请输入检索关键字（订单号 / 证件号 / 手机号 / 姓名）', 400);

    const users = await prisma.user.findMany({
      where: {
        OR: [{ username: { contains: keyword } }, { realName: { contains: keyword } }, { phone: { contains: keyword } }, { idCardSuffix: keyword.slice(-4) }],
      },
      take: 20,
    });

    const byCard = validateIdCard(keyword).valid ? await prisma.user.findUnique({ where: { idCardHash: hashIdCard(keyword) } }) : null;
    if (byCard && !users.some((u) => u.id === byCard.id)) users.unshift(byCard);

    const orders = await prisma.order.findMany({
      where: { OR: [{ orderNo: keyword }, { userId: { in: users.map((u) => u.id) } }] },
      include: { user: true, schedule: { include: { train: { include: { fromStation: true, toStation: true } } } }, items: { include: { refunds: true, changesOld: true } }, payments: true },
      orderBy: { id: 'desc' },
      take: 20,
    });

    return ok(res, {
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        realName: u.realName,
        phone: u.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
        idCardMasked: `**************${u.idCardSuffix}`,
        status: u.status,
        isVerified: u.isVerified,
      })),
      orders: orders.map((o) => buildOrderView(o, { withUser: true })),
    });
  }),
);

/** GET /clerk/users/:id/passengers 查看某账号的乘车人（窗口代客购票用） */
clerkRouter.get(
  '/users/:id/passengers',
  wrap(async (req, res) => {
    const userId = Number(req.params.id);
    const list = await prisma.passenger.findMany({ where: { userId, isDeleted: false }, orderBy: { id: 'asc' } });
    return ok(res, {
      list: list.map((p) => ({
        id: p.id,
        name: p.name,
        idCardMasked: `**************${p.idCardSuffix}`,
        passengerType: p.passengerType,
      })),
    });
  }),
);

/** POST /clerk/orders 窗口代客下单（channel=CLERK） */
clerkRouter.post(
  '/orders',
  wrap(async (req, res) => {
    const body = z
      .object({
        userId: z.number().int().positive(),
        scheduleId: z.number().int().positive(),
        seatClass: z.string().min(2),
        passengerIds: z.array(z.number().int().positive()).min(1).max(5),
        remark: z.string().max(100).optional(),
      })
      .parse(req.body);

    const { createOrder } = await import('./orders');
    const result = await createOrder({
      userId: body.userId,
      scheduleId: body.scheduleId,
      seatClass: body.seatClass,
      passengerIds: body.passengerIds,
      channel: 'CLERK',
      remark: body.remark ?? `窗口代客购票（售票员 ${req.user!.username}）`,
      idempotencyKey: (req.headers['idempotency-key'] as string) || null,
    });

    await writeAudit(req, 'CLERK_CREATE_ORDER', 'order', result.order?.orderNo, { userId: body.userId, seatClass: body.seatClass });
    return ok(res, buildOrderView(result.order!), '窗口订单已创建，请收银后确认出票');
  }),
);

/** POST /clerk/orders/:orderNo/pay-cash 窗口现金收银确认出票 */
clerkRouter.post(
  '/orders/:orderNo/pay-cash',
  wrap(async (req, res) => {
    const order = await loadOrder(req.params.orderNo);
    if (!order) throw Errors.notFound('订单不存在');
    if (order.status !== 'PENDING_PAYMENT') throw new ApiError(5001, `订单当前状态为「${order.status}」，无需收银`, 409);

    const outTradeNo = newOutTradeNo();
    await prisma.payment.create({
      data: {
        paymentNo: newPaymentNo(),
        orderId: order.id,
        type: 'PAY',
        amountCents: order.totalAmountCents,
        method: 'CASH',
        status: 'PENDING',
        outTradeNo,
      },
    });
    await settlePaySuccess(outTradeNo, `CASH-${Date.now()}`);
    await prisma.payment.updateMany({ where: { outTradeNo }, data: { method: 'CASH' } });

    await writeAudit(req, 'CLERK_CASH_PAY', 'order', order.orderNo, { amountCents: order.totalAmountCents });
    const fresh = await loadOrder(order.orderNo);
    return ok(res, buildOrderView(fresh!), '现金收银完成，车票已出票');
  }),
);
