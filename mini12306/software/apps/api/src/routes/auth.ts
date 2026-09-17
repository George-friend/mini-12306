import { Router } from 'express';
import { z } from 'zod';
import { prisma, getBoolSetting, getIntSetting } from '../db';
import { ApiError, Errors, ok, wrap } from '../lib/http';
import { comparePassword, encryptIdCard, hashIdCard, hashPassword, maskIdCard } from '../lib/crypto';
import { validateIdCard, validatePhone } from '../lib/idcard';
import { newVerifyCode } from '../lib/ids';
import { config } from '../config';
import { identityProvider, smsProvider } from '../providers/mock';
import { optionalAuth, requireAuth, signToken } from '../middleware/auth';

export const authRouter = Router();

const registerSchema = z.object({
  username: z.string().min(4, '用户名至少 4 位').max(20, '用户名最多 20 位').regex(/^[A-Za-z0-9_]+$/, '用户名只能包含字母、数字与下划线'),
  password: z.string().min(6, '密码至少 6 位').max(32, '密码最多 32 位'),
  realName: z.string().min(2, '请填写真实姓名').max(20),
  idCardNo: z.string().min(18).max(18),
  phone: z.string().length(11, '手机号必须为 11 位'),
  smsCode: z.string().length(6, '验证码为 6 位'),
  bankCardNo: z.string().optional().or(z.literal('')),
});

const smsSchema = z.object({
  phone: z.string().length(11),
  scene: z.enum(['REGISTER', 'LOGIN', 'RESET', 'CHANGE']),
});

/** POST /auth/sms-code 发送短信验证码（Mock 通道） */
authRouter.post(
  '/sms-code',
  wrap(async (req, res) => {
    const body = smsSchema.parse(req.body);
    if (!validatePhone(body.phone)) throw new ApiError(1001, '手机号格式不正确', 400);

    const interval = await getIntSetting('sms.resend_interval_seconds', 60);
    const last = await prisma.verificationCode.findFirst({
      where: { phone: body.phone, scene: body.scene },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < interval * 1000) {
      const wait = Math.ceil((interval * 1000 - (Date.now() - last.createdAt.getTime())) / 1000);
      throw new ApiError(1005, `请求过于频繁，请 ${wait} 秒后再试`, 429);
    }

    const expireSeconds = await getIntSetting('sms.code_expire_seconds', 300);
    const code = config.providerMode === 'mock' ? config.mockSmsCode : newVerifyCode();
    const sent = await smsProvider.send(body.phone, body.scene, code);

    await prisma.verificationCode.create({
      data: {
        phone: body.phone,
        scene: body.scene,
        code,
        expiresAt: new Date(Date.now() + expireSeconds * 1000),
      },
    });

    // Mock 通道直接回传验证码，前端以提示形式展示，便于课程演示
    return ok(res, { smsId: sent.smsId, expiresInSeconds: expireSeconds, mockCode: code }, '验证码已发送（Mock 短信通道）');
  }),
);

/** 校验验证码 */
async function assertSmsCode(phone: string, scene: string, code: string) {
  if (config.providerMode === 'mock' && code === config.mockSmsCode) return;
  const row = await prisma.verificationCode.findFirst({
    where: { phone, scene, code, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw new ApiError(1001, '验证码错误或已过期', 400);
  await prisma.verificationCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
}

/** POST /auth/register 实名注册 */
authRouter.post(
  '/register',
  wrap(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const idCardNo = body.idCardNo.trim().toUpperCase();

    const format = validateIdCard(idCardNo);
    if (!format.valid) throw new ApiError(2001, format.reason ?? '证件号不合法', 400);
    if (!validatePhone(body.phone)) throw new ApiError(1001, '手机号格式不正确', 400);

    const [byName, byPhone, byCard] = await Promise.all([
      prisma.user.findUnique({ where: { username: body.username } }),
      prisma.user.findUnique({ where: { phone: body.phone } }),
      prisma.user.findUnique({ where: { idCardHash: hashIdCard(idCardNo) } }),
    ]);
    if (byName) throw new ApiError(2002, '该用户名已被注册', 409);
    if (byPhone) throw new ApiError(2002, '该手机号已被注册', 409);
    if (byCard) throw new ApiError(2002, '该证件号已被其他账号绑定', 409);

    await assertSmsCode(body.phone, 'REGISTER', body.smsCode);

    const requireIdentity = await getBoolSetting('auth.require_identity', true);
    const verify = await identityProvider.verify(body.realName, idCardNo);
    await prisma.identityVerification.create({
      data: {
        realName: body.realName,
        idCardSuffix: idCardNo.slice(-4),
        provider: identityProvider.name,
        providerRequestId: verify.requestId,
        result: verify.success ? 'PASS' : 'FAIL',
        failReason: verify.success ? null : verify.message,
        elapsedMs: verify.elapsedMs,
      },
    });
    if (requireIdentity && !verify.success) {
      throw new ApiError(2001, `实名核验未通过：${verify.message}`, 400);
    }

    const user = await prisma.user.create({
      data: {
        username: body.username,
        passwordHash: await hashPassword(body.password),
        realName: body.realName,
        idCardCipher: encryptIdCard(idCardNo),
        idCardHash: hashIdCard(idCardNo),
        idCardSuffix: idCardNo.slice(-4),
        phone: body.phone,
        bankCardLast4: body.bankCardNo ? body.bankCardNo.replace(/\s/g, '').slice(-4) : null,
        role: 'PASSENGER',
        status: 'ACTIVE',
        isVerified: verify.success,
      },
    });

    const token = signToken(user);
    return ok(
      res,
      {
        token,
        user: {
          id: user.id,
          username: user.username,
          realName: user.realName,
          phone: user.phone,
          role: user.role,
          isVerified: user.isVerified,
          idCardMasked: maskIdCard(idCardNo),
        },
      },
      '注册成功',
    );
  }),
);

/** POST /auth/login */
authRouter.post(
  '/login',
  wrap(async (req, res) => {
    const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { username: body.username } });
    if (!user) throw new ApiError(2001, '用户名或密码错误', 400);

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ApiError(2003, `账号已锁定，请 ${mins} 分钟后再试`, 423);
    }
    if (user.status === 'FROZEN') throw new ApiError(2003, '账号已被冻结，请联系管理员', 423);

    const okPwd = await comparePassword(body.password, user.passwordHash);
    if (!okPwd) {
      const maxFail = await getIntSetting('auth.max_login_fail', 5);
      const lockMinutes = await getIntSetting('auth.lock_minutes', 10);
      const failCount = user.loginFailCount + 1;
      const locked = failCount >= maxFail;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          loginFailCount: locked ? 0 : failCount,
          lockedUntil: locked ? new Date(Date.now() + lockMinutes * 60000) : null,
        },
      });
      throw new ApiError(
        locked ? 2003 : 2001,
        locked ? `连续 ${maxFail} 次登录失败，账号已锁定 ${lockMinutes} 分钟` : `用户名或密码错误（还可尝试 ${maxFail - failCount} 次）`,
        locked ? 423 : 400,
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { loginFailCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return ok(
      res,
      {
        token: signToken(user),
        user: {
          id: user.id,
          username: user.username,
          realName: user.realName,
          phone: user.phone,
          role: user.role,
          isVerified: user.isVerified,
          idCardMasked: maskIdCard(`11010119900307${user.idCardSuffix}`),
        },
      },
      '登录成功',
    );
  }),
);

/** POST /auth/logout（JWT 无状态，前端清除令牌即可） */
authRouter.post('/logout', optionalAuth, wrap(async (_req, res) => ok(res, null, '已退出登录')));

/** GET /auth/me */
authRouter.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw Errors.unauthorized();
    return ok(res, {
      id: user.id,
      username: user.username,
      realName: user.realName,
      phone: user.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
      role: user.role,
      status: user.status,
      isVerified: user.isVerified,
      bankCardLast4: user.bankCardLast4,
      idCardMasked: `**************${user.idCardSuffix}`,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    });
  }),
);

/** PATCH /auth/me 修改手机号 / 银行卡尾号 / 密码 */
authRouter.patch(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const body = z
      .object({
        phone: z.string().length(11).optional(),
        smsCode: z.string().length(6).optional(),
        bankCardNo: z.string().optional(),
        oldPassword: z.string().optional(),
        newPassword: z.string().min(6).max(32).optional(),
      })
      .parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw Errors.unauthorized();

    const data: Record<string, unknown> = {};
    if (body.phone && body.phone !== user.phone) {
      if (!validatePhone(body.phone)) throw new ApiError(1001, '手机号格式不正确', 400);
      if (!body.smsCode) throw new ApiError(1001, '修改手机号需要短信验证码', 400);
      await assertSmsCode(body.phone, 'CHANGE', body.smsCode);
      const exists = await prisma.user.findUnique({ where: { phone: body.phone } });
      if (exists) throw new ApiError(2002, '该手机号已被占用', 409);
      data.phone = body.phone;
    }
    if (body.bankCardNo !== undefined) data.bankCardLast4 = body.bankCardNo ? body.bankCardNo.replace(/\s/g, '').slice(-4) : null;
    if (body.newPassword) {
      if (!body.oldPassword) throw new ApiError(1001, '修改密码需要提供原密码', 400);
      const okOld = await comparePassword(body.oldPassword, user.passwordHash);
      if (!okOld) throw new ApiError(2001, '原密码不正确', 400);
      data.passwordHash = await hashPassword(body.newPassword);
    }
    if (Object.keys(data).length === 0) throw new ApiError(1001, '没有需要修改的内容', 400);

    await prisma.user.update({ where: { id: user.id }, data });
    return ok(res, null, '资料已更新');
  }),
);
