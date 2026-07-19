/**
 * Foundation-unit storage: access + refresh tokens live in expo-secure-store
 * (iOS Keychain / Android Keystore), per architecture.md's "mobile app uses
 * secure storage for tokens" requirement. Unlike the web app's synchronous
 * localStorage wrapper, every read/write here is async — SecureStore has no
 * synchronous API.
 *
 * SecureStore requires a native runtime (device, emulator, or dev client) and
 * does not work under `expo start --web` — not a concern for this app, since
 * apps/mobile targets Android/iOS only per architecture.md.
 */
import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'recafco.accessToken';
const REFRESH_TOKEN_KEY = 'recafco.refreshToken';

export async function getStoredAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function getStoredRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function storeTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function clearStoredTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}
