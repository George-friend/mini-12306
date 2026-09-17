import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../db';
import { ApiError, Errors } from '../lib/http';

export interface AuthUser {
  id: number;
  username: string;
  role: 'PASSENGER' | 'CLERK' | 'ADMIN';
  status: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: { id: number; username: string; role: string; status: string }): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, status: user.status }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

/** 解析并校验令牌；未登录时抛出 1002 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw Errors.unauthorized();
    const payload = jwt.verify(token, config.jwtSecret) as AuthUser;
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) throw Errors.unauthorized('账号不存在');
    if (user.status === 'FROZEN') throw new ApiError(2003, '账号已被冻结，请联系管理员', 423);
    req.user = { id: user.id, username: user.username, role: user.role as AuthUser['role'], status: user.status };
    next();
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: number }).code === 2003) return next(e);
    next(Errors.unauthorized());
  }
}

/** 可选登录：有令牌则解析，无令牌放行 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret) as AuthUser;
      req.user = { id: payload.id, username: payload.username, role: payload.role, status: payload.status };
    } catch {
      /* 忽略无效令牌 */
    }
  }
  next();
}

/** 角色校验 */
export function requireRole(...roles: Array<AuthUser['role']>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(Errors.unauthorized());
    if (!roles.includes(req.user.role)) return next(Errors.forbidden());
    next();
  };
}
