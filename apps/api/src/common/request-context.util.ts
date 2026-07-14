import type { Request } from 'express';

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export function getRequestContext(req: Request): RequestContext {
  const userAgentHeader = req.headers['user-agent'];
  return {
    ipAddress: req.ip ?? null,
    userAgent: Array.isArray(userAgentHeader) ? (userAgentHeader[0] ?? null) : (userAgentHeader ?? null),
  };
}
