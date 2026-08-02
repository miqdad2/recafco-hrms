import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';

/**
 * Shown while the app restores a session from SecureStore (`(app)/_layout.tsx`'s `isLoading`
 * gate) — the brief moment after the native splash screen hides and before the app knows
 * whether to render the authenticated tabs or redirect to `/login`. Reuses the same tightly
 * cropped logo asset as the native splash (`assets/splash-logo.png`, not the padded
 * `assets/icon.png`) so the handoff from native splash to this screen reads as one continuous
 * branded load at matching visual weight, not a jarring cut or size jump.
 */
export function BrandedLoadingScreen() {
  return (
    <View style={styles.container}>
      <Image source={require('../../assets/splash-logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>RECAFCO HRMS</Text>
      <Text style={styles.subtitle}>Employee Self Service</Text>
      <Text style={styles.tagline}>Secure Attendance & HR Platform</Text>
      <ActivityIndicator color={colors.accentPrimary} size="small" style={styles.spinner} />
      <Text style={styles.loadingText}>Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  logo: { width: 180, height: 140, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  tagline: { fontSize: 12, color: colors.textMuted, marginTop: 4, marginBottom: 24 },
  spinner: { marginBottom: 8 },
  loadingText: { fontSize: 13, color: colors.textMuted },
});
