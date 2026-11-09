import * as React from 'react';
import { useRouter } from 'expo-router';
import {
  ApiError,
  getCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  type CurrentUserProfile,
} from '../api/client';
import { clearStoredTokens, getStoredAccessToken, getStoredRefreshToken, storeTokens } from './token-storage';

interface AuthContextValue {
  user: CurrentUserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (patch: Partial<CurrentUserProfile>) => void;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

/** Upper bound on launch-time session restore so the welcome screen can never spin forever. */
const SESSION_RESTORE_TIMEOUT_MS = 15_000;

class SessionRestoreTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SessionRestoreTimeoutError('Session restore timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = React.useState<CurrentUserProfile | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  const clearSession = React.useCallback(async () => {
    await clearStoredTokens();
    setUser(null);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      let accessToken: string | null = null;
      try {
        accessToken = await getStoredAccessToken();
      } catch {
        // SecureStore unreadable (e.g. keystore error) — treat as signed out so launch never hangs.
        accessToken = null;
      }
      if (!accessToken) {
        if (!cancelled) {
          setIsLoading(false);
        }
        return;
      }
      try {
        const profile = await withTimeout(getCurrentUser(accessToken), SESSION_RESTORE_TIMEOUT_MS);
        if (!cancelled) {
          setUser(profile);
        }
      } catch (error) {
        // Server unreachable/slow: stop the launch screen and fall through to /login, but keep the
        // stored tokens so the next launch can retry. Any other failure (invalid/expired token)
        // clears the stale session, as before.
        const serverUnreachable =
          error instanceof SessionRestoreTimeoutError || (error instanceof ApiError && error.status === 0);
        if (!cancelled && !serverUnreachable) {
          await clearSession();
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = React.useCallback(async (identifier: string, password: string) => {
    const tokens = await apiLogin(identifier, password);
    await storeTokens(tokens.accessToken, tokens.refreshToken);
    const profile = await getCurrentUser(tokens.accessToken);
    setUser(profile);
  }, []);

  const logout = React.useCallback(async () => {
    const refreshToken = await getStoredRefreshToken();
    if (refreshToken) {
      try {
        await apiLogout(refreshToken);
      } catch {
        // Best-effort server-side revoke — the local session must clear either way.
      }
    }
    await clearSession();
    router.replace('/login');
  }, [clearSession, router]);

  const updateUser = React.useCallback((patch: Partial<CurrentUserProfile>) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, isLoading, isAuthenticated: user !== null, login, logout, updateUser }),
    [user, isLoading, login, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
