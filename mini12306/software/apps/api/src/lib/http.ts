import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** 业务错误：携带统一错误码与 HTTP 状态码 */
export class ApiError extends Error {
  code: number;
  httpStatus: number;

  constructor(code: number, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** 常用错误快捷构造 */
export const Errors = {
  badRequest: (msg = '参数校验失败', code = 1001) => new ApiError(code, msg, 400),
  unauthorized: (msg = '未登录或登录已失效', code = 1002) => new ApiError(code, msg, 401),
  forbidden: (msg = '无权限执行该操作', code = 1003) => new ApiError(code, msg, 403),
  notFound: (msg = '资源不存在', code = 1004) => new ApiError(code, msg, 404),
  tooMany: (msg = '请求过于频繁，请稍后再试', code = 1005) => new ApiError(code, msg, 429),
  conflict: (msg = '操作冲突，请刷新后重试', code = 4002) => new ApiError(code, msg, 409),
  internal: (msg = '服务器内部错误', code = 9000) => new ApiError(code, msg, 500),
};

/** 成功响应 */
export function ok(res: Response, data: unknown = null, message = 'ok') {
  return res.json({ code: 0, message, data, requestId: res.locals.requestId ?? null });
}

/** 异步路由包装：自动把 reject 转交给错误中间件 */
export function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** 统一错误处理中间件 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = res.locals.requestId ?? null;
  if (err instanceof ApiError) {
    return res.status(err.httpStatus).json({ code: err.code, message: err.message, data: null, requestId });
  }
  if (err instanceof Error && err.name === 'ZodError') {
    return res.status(400).json({ code: 1001, message: '参数校验失败', data: (err as any).issues ?? null, requestId });
  }
  // eslint-disable-next-line no-console
  console.error('[unhandled]', err);
  return res.status(500).json({ code: 9000, message: '服务器内部错误', data: null, requestId });
}

/** 请求 ID 中间件 */
export function requestId(_req: Request, res: Response, next: NextFunction) {
  res.locals.requestId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  next();
}
