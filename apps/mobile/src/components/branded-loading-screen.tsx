import * as React from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';
import { LogoBadge } from './logo-badge';

const ANIMATION_DURATION_MS = 500;

/**
 * Shown while the app restores a session from SecureStore (`(app)/_layout.tsx`'s `isLoading`
 * gate) — the brief moment after the native splash screen hides and before the app knows
 * whether to render the authenticated tabs or redirect to `/login`. Uses the same white
 * rounded-card logo presentation as the login screen (`LogoBadge`) so the whole launch sequence
 * (native splash → this screen → login) reads as one consistent, professional brand handoff.
 *
 * The fade/scale entrance lives only here, not in the native splash — React Native's built-in
 * `Animated` API (no new dependency) drives a subtle 0.96→1.00 scale + 0→1 opacity over ~500ms,
 * intentionally simple with no bounce/spring per the task's "no flashy motion" direction.
 */
export function BrandedLoadingScreen() {
  const opacity = React.useRef(new Animated.Value(0)).current;
  const scale = React.useRef(new Animated.Value(0.96)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: ANIMATION_DURATION_MS,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: ANIMATION_DURATION_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <View style={styles.badgeWrapper}>
          <LogoBadge width={220} />
        </View>
        <Text style={styles.title}>RECAFCO HRMS</Text>
        <Text style={styles.subtitle}>Employee Self Service</Text>
        <Text style={styles.tagline}>Secure Attendance & HR Platform</Text>
      </Animated.View>
      <ActivityIndicator color={colors.accentPrimary} size="small" style={styles.spinner} />
      <Text style={styles.loadingText}>Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgBase },
  badgeWrapper: { alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4, textAlign: 'center' },
  tagline: { fontSize: 12, color: colors.textMuted, marginTop: 4, marginBottom: 24, textAlign: 'center' },
  spinner: { marginTop: 24, marginBottom: 8 },
  loadingText: { fontSize: 13, color: colors.textMuted },
});
