import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brand } from '../lib/theme';

/**
 * Branded launch screen (MOBILE UI-01). Rendered by `(app)/_layout.tsx` while the session is
 * restored from SecureStore, immediately after the native splash hides. Its background matches
 * the native splash (`brand.charcoal`), and the native splash already shows the same white logo
 * disc at screen centre, so the handoff reads as the disc growing into the full welcome layout.
 *
 * Timing: no artificial wait. The screen exits as soon as BOTH the session check has finished
 * (`ready`) AND the short entrance animation (~500ms) has played, then fades out (~180ms) and
 * calls `onFinish`. With reduced motion enabled, nothing animates and it exits as soon as
 * `ready` is true.
 */

// Trimmed original RECAFCO artwork on white (3033×2358 source → 1024px wide); h/w ratio below.
const LOGO_ASPECT = 2358 / 3033;
const ENTRANCE_MS = 380;
const HEADING_DELAY_MS = 120;
const EXIT_MS = 180;
const SLOW_HINT_AFTER_MS = 1200;

interface LaunchWelcomeScreenProps {
  /** True once auth restore has finished (success, signed-out, or error). */
  ready: boolean;
  onFinish: () => void;
}

export function LaunchWelcomeScreen({ ready, onFinish }: LaunchWelcomeScreenProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const circleIn = React.useRef(new Animated.Value(0)).current;
  const headingIn = React.useRef(new Animated.Value(0)).current;
  const contentOut = React.useRef(new Animated.Value(1)).current;

  const [entranceDone, setEntranceDone] = React.useState(false);
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const [showSlowHint, setShowSlowHint] = React.useState(false);
  const finishedRef = React.useRef(false);

  // Entrance animation (or instant reveal when the OS asks for reduced motion).
  React.useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        if (cancelled) return;
        setReduceMotion(reduced);
        if (reduced) {
          circleIn.setValue(1);
          headingIn.setValue(1);
          setEntranceDone(true);
          return;
        }
        const easing = Easing.out(Easing.cubic);
        Animated.parallel([
          Animated.timing(circleIn, { toValue: 1, duration: ENTRANCE_MS, easing, useNativeDriver: true }),
          Animated.timing(headingIn, {
            toValue: 1,
            duration: ENTRANCE_MS,
            delay: HEADING_DELAY_MS,
            easing,
            useNativeDriver: true,
          }),
        ]).start(() => {
          if (!cancelled) setEntranceDone(true);
        });
      });
    return () => {
      cancelled = true;
    };
  }, [circleIn, headingIn]);

  // Only if the session check is slow (bad network) show a small progress hint, so the screen
  // never looks frozen. Fast launches never see it.
  React.useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setShowSlowHint(true), SLOW_HINT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  // Exit as soon as startup work is done and the entrance has played.
  React.useEffect(() => {
    if (!ready || !entranceDone || finishedRef.current) return;
    finishedRef.current = true;
    if (reduceMotion) {
      onFinish();
      return;
    }
    Animated.timing(contentOut, {
      toValue: 0,
      duration: EXIT_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => onFinish());
  }, [ready, entranceDone, reduceMotion, contentOut, onFinish]);

  // Responsive sizing: the disc targets 240–280dp on typical phones, shrinks on short/narrow
  // screens so it never collides with the heading, and never exceeds 280dp on large phones.
  const usableHeight = height - insets.top - insets.bottom;
  const circleSize = Math.round(Math.max(168, Math.min(280, width * 0.7, usableHeight * 0.38)));
  // Logo diagonal kept to ~85% of the disc so no corner of the artwork can touch the edge.
  const logoWidth = Math.round(circleSize * 0.67);
  const logoHeight = Math.round(logoWidth * LOGO_ASPECT);
  const compact = width < 360 || usableHeight < 620;
  const showSideLines = width >= 340;

  const circleScale = circleIn.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const headingTranslate = headingIn.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });

  return (
    <View
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessible
      accessibilityLabel="Welcome to RECAFCO. HRMS Employee Self Service. Loading."
    >
      <StatusBar style="light" />

      {/* Subtle curved background shapes — decorative only. */}
      <View pointerEvents="none" style={[styles.bgArc, styles.bgArcTop, { width: width * 1.4, height: width * 1.4 }]} />
      <View
        pointerEvents="none"
        style={[styles.bgArc, styles.bgArcBottom, { width: width * 1.2, height: width * 1.2 }]}
      />

      <Animated.View style={[styles.content, { opacity: contentOut }]}>
        <Animated.View style={{ opacity: circleIn, transform: [{ scale: circleScale }] }}>
          <View
            style={[
              styles.halo,
              { width: circleSize + 24, height: circleSize + 24, borderRadius: (circleSize + 24) / 2 },
            ]}
          >
            <View
              style={[styles.circle, { width: circleSize, height: circleSize, borderRadius: circleSize / 2 }]}
            >
              <Image
                source={require('../../assets/welcome-logo.png')}
                style={{ width: logoWidth, height: logoHeight }}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            </View>
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.textBlock,
            { marginTop: compact ? 28 : 40, opacity: headingIn, transform: [{ translateY: headingTranslate }] },
          ]}
        >
          <Text
            style={[styles.heading, { fontSize: compact ? 24 : 28, lineHeight: compact ? 30 : 34 }]}
            accessibilityRole="header"
            maxFontSizeMultiplier={1.3}
          >
            Welcome to RECAFCO
          </Text>
          <View style={styles.subtitleRow}>
            {showSideLines ? <View style={styles.sideLine} /> : null}
            <Text style={[styles.subtitle, { fontSize: compact ? 14 : 15 }]} maxFontSizeMultiplier={1.3}>
              HRMS Employee Self Service
            </Text>
            {showSideLines ? <View style={styles.sideLine} /> : null}
          </View>
        </Animated.View>
      </Animated.View>

      <View style={[styles.footer, { bottom: insets.bottom + 40 }]} pointerEvents="none">
        {showSlowHint && !ready ? <ActivityIndicator size="small" color={brand.red} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: brand.charcoal,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bgArc: {
    position: 'absolute',
    borderRadius: 9999,
    backgroundColor: brand.charcoalRaised,
  },
  bgArcTop: { top: '-38%', right: '-55%' },
  bgArcBottom: { bottom: '-42%', left: '-50%', opacity: 0.7 },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  halo: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  circle: {
    backgroundColor: brand.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 14,
  },
  textBlock: {
    alignItems: 'center',
  },
  heading: {
    color: brand.white,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  sideLine: {
    width: 22,
    height: 1.5,
    backgroundColor: brand.red,
    marginHorizontal: 10,
    borderRadius: 1,
  },
  subtitle: {
    color: brand.textOnDarkMuted,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
