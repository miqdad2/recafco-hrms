import { clearStoredTokens, getStoredAccessToken } from '../auth/token-storage';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000';

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

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(
      0,
      `Could not reach the server at ${API_URL}. Check EXPO_PUBLIC_API_URL and your network connection.`,
    );
  }

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

/**
 * Authenticated request helper for future non-auth endpoints (Unit 16+). Reads the
 * current access token from secure storage and, on a 401, clears the stored session
 * so the app falls back to the login screen rather than retrying with a dead token.
 */
export async function authorizedRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const accessToken = await getStoredAccessToken();
  try {
    return await request<T>(path, options, accessToken ?? undefined);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await clearStoredTokens();
    }
    throw error;
  }
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
