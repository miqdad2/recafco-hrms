import { Image, StyleSheet, View } from 'react-native';
import { colors } from '../lib/theme';

/**
 * White rounded-rectangle card presenting the transparent RECAFCO logo — used on the branded
 * loading screen and the login screen so both read as one consistent brand presentation. Sized
 * to the logo's own aspect ratio (not a fixed square) so the card hugs the artwork with even
 * padding on all sides, rather than leaving awkward empty space above/below a wide horizontal
 * logo. Deliberately not a circular crop — the logo is a wide wordmark, not an icon mark.
 */
const LOGO_ASPECT_RATIO = 2451 / 3125;
const BADGE_PADDING = 24;

interface LogoBadgeProps {
  width?: number;
}

export function LogoBadge({ width = 220 }: LogoBadgeProps) {
  const logoWidth = width - BADGE_PADDING * 2;
  const logoHeight = logoWidth * LOGO_ASPECT_RATIO;
  const cardHeight = logoHeight + BADGE_PADDING * 2;

  return (
    <View style={[styles.badge, { width, height: cardHeight }]}>
      <Image
        source={require('../../assets/recafco-logo-transparent.png')}
        style={{ width: logoWidth, height: logoHeight }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: colors.bgSurface,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
});
