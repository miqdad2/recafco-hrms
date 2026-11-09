import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/lib/auth/auth-context';

// Native splash → LaunchWelcomeScreen handoff (MOBILE UI-01). expo-router hides the native splash
// after the first render, which is the charcoal welcome screen, so no white frame appears. On iOS
// this makes that hide a short cross-fade (`fade` is iOS-only; Android uses the system exit).
SplashScreen.setOptions({ duration: 250, fade: true });

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
