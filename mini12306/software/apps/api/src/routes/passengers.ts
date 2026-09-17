import { Router } from 'express';
import { z } from 'zod';
import { prisma, getIntSetting } from '../db';
import { ApiError, Errors, ok, wrap } from '../lib/http';
import { encryptIdCard, hashIdCard, maskIdCard } from '../lib/crypto';
import { validateIdCard, validatePhone, ageFromIdCard } from '../lib/idcard';
import { requireAuth } from '../middleware/auth';

export const passengerRouter = Router();

/** 乘车人视图（证件号脱敏） */
function toView(p: { id: number; name: string; idCardSuffix: string; phone: string | null; passengerType: string; isDefault: boolean }) {
  return {
    id: p.id,
    name: p.name,
    idCardMasked: `**************${p.idCardSuffix}`,
    idCardSuffix: p.idCardSuffix,
    phone: p.phone ? p.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : null,
    passengerType: p.passengerType,
    isDefault: p.isDefault,
  };
}

const passengerSchema = z.object({
  name: z.string().min(2, '请填写姓名').max(20),
  idCardNo: z.string().length(18, '证件号必须为 18 位'),
  phone: z.string().length(11).optional().or(z.literal('')),
  passengerType: z.enum(['ADULT', 'CHILD', 'STUDENT']).default('ADULT'),
  isDefault: z.boolean().optional(),
});

/** 根据证件号年龄自动校正票种（BR-13） */
function normalizeType(input: { passengerType: string; idCardNo: string }): string {
  const age = ageFromIdCard(input.idCardNo);
  if (input.passengerType === 'STUDENT') return 'STUDENT';
  if (age < 6) throw new ApiError(1001, '未满 6 周岁的儿童免票乘车，无需单独购票', 400);
  if (age < 14) return 'CHILD';
  return 'ADULT';
}

/** GET /passengers */
passengerRouter.get(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const list = await prisma.passenger.findMany({
      where: { userId: req.user!.id, isDeleted: false },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
    const max = await getIntSetting('passenger.max_per_user', 10);
    return ok(res, { list: list.map(toView), max });
  }),
);

/** POST /passengers */
passengerRouter.post(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const body = passengerSchema.parse(req.body);
    const idCardNo = body.idCardNo.trim().toUpperCase();
    const check = validateIdCard(idCardNo);
    if (!check.valid) throw new ApiError(1001, check.reason ?? '证件号不合法', 400);
    if (body.phone && !validatePhone(body.phone)) throw new ApiError(1001, '手机号格式不正确', 400);

    const max = await getIntSetting('passenger.max_per_user', 10);
    const count = await prisma.passenger.count({ where: { userId: req.user!.id, isDeleted: false } });
    if (count >= max) throw new ApiError(1001, `最多只能添加 ${max} 名乘车人`, 400);

    const hash = hashIdCard(idCardNo);
    const dup = await prisma.passenger.findFirst({ where: { userId: req.user!.id, idCardHash: hash, isDeleted: false } });
    if (dup) throw new ApiError(1001, '该乘车人已在您的列表中', 400);

    const passengerType = normalizeType({ passengerType: body.passengerType, idCardNo });
    const created = await prisma.passenger.create({
      data: {
        userId: req.user!.id,
        name: body.name,
        idCardCipher: encryptIdCard(idCardNo),
        idCardHash: hash,
        idCardSuffix: idCardNo.slice(-4),
        phone: body.phone || null,
        passengerType,
        isDefault: body.isDefault ?? count === 0,
      },
    });
    return ok(res, toView(created), '乘车人已添加');
  }),
);

/** PUT /passengers/:id */
passengerRouter.put(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const p = await prisma.passenger.findFirst({ where: { id, userId: req.user!.id, isDeleted: false } });
    if (!p) throw Errors.notFound('乘车人不存在');

    const body = z
      .object({ name: z.string().min(2).max(20).optional(), phone: z.string().length(11).optional().or(z.literal('')), passengerType: z.enum(['ADULT', 'CHILD', 'STUDENT']).optional(), isDefault: z.boolean().optional() })
      .parse(req.body);

    const updated = await prisma.passenger.update({
      where: { id },
      data: {
        name: body.name ?? p.name,
        phone: body.phone === undefined ? p.phone : body.phone || null,
        passengerType: body.passengerType ?? p.passengerType,
        isDefault: body.isDefault ?? p.isDefault,
      },
    });
    if (body.isDefault) {
      await prisma.passenger.updateMany({ where: { userId: req.user!.id, id: { not: id } }, data: { isDefault: false } });
    }
    return ok(res, toView(updated), '乘车人已更新');
  }),
);

/** DELETE /passengers/:id（软删） */
passengerRouter.delete(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const p = await prisma.passenger.findFirst({ where: { id, userId: req.user!.id, isDeleted: false } });
    if (!p) throw Errors.notFound('乘车人不存在');
    const used = await prisma.orderItem.count({ where: { passengerId: id, ticketStatus: { in: ['LOCKED', 'TICKETED', 'REFUNDING'] } } });
    if (used > 0) throw new ApiError(1001, '该乘车人存在未完成的车票，无法删除', 400);
    await prisma.passenger.update({ where: { id }, data: { isDeleted: true } });
    return ok(res, null, '乘车人已删除');
  }),
);

/** 供其他路由复用：按 ID 列表取本人乘车人 */
export async function loadOwnPassengers(userId: number, ids: number[]) {
  const list = await prisma.passenger.findMany({ where: { id: { in: ids }, userId, isDeleted: false } });
  if (list.length !== ids.length) throw new ApiError(4003, '乘车人信息与当前账号不匹配', 400);
  return list;
}

export { toView as toPassengerView, maskIdCard };
