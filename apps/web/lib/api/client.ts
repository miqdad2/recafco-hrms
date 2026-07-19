import { getStoredAccessToken } from '../auth/token-storage';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

/** Builds a query string, skipping undefined/empty values so optional list filters stay out of the URL entirely. */
export function buildQueryString(params: object): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: string;
}

export interface CurrentUserProfile {
  id: string;
  username: string;
  email: string | null;
  employeeId: string | null;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  temporaryPasswordIssuedAt: string | null;
  passwordChangedAt: string | null;
  roles: string[];
  permissions: string[];
}

interface ErrorResponseBody {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

function extractErrorMessage(body: unknown, fallback: string): string {
  const parsed = body as ErrorResponseBody | null;
  if (!parsed || typeof parsed !== 'object') {
    return fallback;
  }
  if (Array.isArray(parsed.message)) {
    return parsed.message.join(', ');
  }
  if (typeof parsed.message === 'string') {
    return parsed.message;
  }
  return fallback;
}

async function request<T>(path: string, options: RequestInit = {}, accessToken?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw new ApiError(response.status, extractErrorMessage(body, `Request failed with status ${response.status}`));
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function login(identifier: string, password: string): Promise<TokenPair> {
  return request<TokenPair>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export function refreshTokens(refreshToken: string): Promise<TokenPair> {
  return request<TokenPair>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export function logout(refreshToken: string): Promise<{ status: string }> {
  return request<{ status: string }>('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export function getCurrentUser(accessToken: string): Promise<CurrentUserProfile> {
  return request<CurrentUserProfile>('/auth/me', { method: 'GET' }, accessToken);
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function changePassword(input: ChangePasswordInput): Promise<{ status: string }> {
  return authorizedRequest<{ status: string }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Authenticated request helper for every non-auth endpoint. Reads the current access token
 * directly from storage (the single source of truth — see lib/auth/token-storage.ts) rather
 * than requiring every call site to thread it through manually.
 */
export function authorizedRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const accessToken = getStoredAccessToken();
  return request<T>(path, options, accessToken ?? undefined);
}
