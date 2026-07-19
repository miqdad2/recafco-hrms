import * as Location from 'expo-location';

export type LocationPermissionStatus = 'undetermined' | 'granted' | 'denied';

export interface LocationReading {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  mockLocationDetected: boolean;
}

/** Meters. A simple client-side pre-check only — the backend remains the final authority on geofence/accuracy. */
export const MAX_ACCEPTABLE_ACCURACY_METERS = 100;

function toPermissionStatus(status: Location.PermissionStatus): LocationPermissionStatus {
  if (status === Location.PermissionStatus.GRANTED) {
    return 'granted';
  }
  if (status === Location.PermissionStatus.DENIED) {
    return 'denied';
  }
  return 'undetermined';
}

/** Read-only check — never triggers the native permission prompt. Safe to call on screen load. */
export async function getForegroundPermissionStatus(): Promise<LocationPermissionStatus> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return toPermissionStatus(status);
}

/** Triggers the native permission prompt. Only call this from a user-initiated action (e.g. pressing Check In/Out). */
export async function requestForegroundPermission(): Promise<LocationPermissionStatus> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return toPermissionStatus(status);
}

export async function getCurrentLocation(): Promise<LocationReading> {
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? null,
    mockLocationDetected: position.mocked ?? false,
  };
}
