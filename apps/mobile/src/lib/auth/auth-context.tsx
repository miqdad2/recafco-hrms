import * as React from 'react';
import { useRouter } from 'expo-router';
import {
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
      const accessToken = await getStoredAccessToken();
      if (!accessToken) {
        setIsLoading(false);
        return;
      }
      try {
        const profile = await getCurrentUser(accessToken);
        if (!cancelled) {
          setUser(profile);
        }
      } catch {
        // Invalid/expired token — clear the stale session rather than leave the UI in a broken state.
        if (!cancelled) {
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
