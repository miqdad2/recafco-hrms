import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const FALLBACK_IDENTIFIER_KEY = 'recafco.deviceIdentifier.fallback';

/**
 * Resolves a stable device identifier for this foundation unit.
 *
 * Strategy (see progress-tracker.md for the full documented limitations):
 * - Android: `Settings.Secure.ANDROID_ID` via expo-application. Stable for the
 *   lifetime of the app-signing-key + user + device combination; changes on a
 *   factory reset or if the app's signing key changes.
 * - iOS: `identifierForVendor` (IDFV) via expo-application. Stable across app
 *   launches; changes only if every app from this vendor is uninstalled. Can
 *   transiently return null right after a device restart before first unlock.
 * - Fallback (web, or iOS returning null): a random UUID generated once and
 *   persisted in SecureStore, so it survives app restarts but not app
 *   uninstalls (SecureStore data is cleared on uninstall, matching how
 *   ANDROID_ID/IDFV themselves reset on their own trigger conditions).
 *
 * This value is a claim, not proof of device identity — architecture.md's
 * invariant #6 treats every mobile-reported signal as a hint for backend
 * validation, never authoritative on its own. Real attendance trust still
 * requires HR/admin approval of the resulting MobileDevice row.
 */
export async function getDeviceIdentifier(): Promise<string> {
  if (Platform.OS === 'android') {
    const androidId = Application.getAndroidId();
    if (androidId) {
      return `android:${androidId}`;
    }
  }

  if (Platform.OS === 'ios') {
    const idfv = await Application.getIosIdForVendorAsync();
    if (idfv) {
      return `ios:${idfv}`;
    }
  }

  return getOrCreateFallbackIdentifier();
}

async function getOrCreateFallbackIdentifier(): Promise<string> {
  const existing = await SecureStore.getItemAsync(FALLBACK_IDENTIFIER_KEY);
  if (existing) {
    return existing;
  }
  const generated = `fallback:${Crypto.randomUUID()}`;
  await SecureStore.setItemAsync(FALLBACK_IDENTIFIER_KEY, generated);
  return generated;
}
