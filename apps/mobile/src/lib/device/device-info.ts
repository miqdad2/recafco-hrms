import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export interface DeviceInfo {
  platform: 'android' | 'ios' | 'web' | 'unknown';
  deviceName: string | null;
  manufacturer: string | null;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
}

function resolvePlatform(): DeviceInfo['platform'] {
  if (Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web') {
    return Platform.OS;
  }
  return 'unknown';
}

export function getDeviceInfo(): DeviceInfo {
  return {
    platform: resolvePlatform(),
    deviceName: Device.deviceName ?? null,
    manufacturer: Device.manufacturer ?? null,
    model: Device.modelName ?? null,
    osVersion: Device.osVersion ?? null,
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
  };
}
