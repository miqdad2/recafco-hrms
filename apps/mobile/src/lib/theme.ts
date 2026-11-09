/**
 * Mobile color tokens mirrored from context/ui-context.md's color table, so no
 * component hardcodes a hex value directly (same rule ui-context.md states for web).
 */
export const colors = {
  bgBase: '#f6f8fb',
  bgSurface: '#ffffff',
  bgMuted: '#f1f5f9',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#64748b',
  accentPrimary: '#0f766e',
  accentPrimaryHover: '#115e59',
  border: '#dbe3ea',
  error: '#dc2626',
  warning: '#d97706',
  success: '#16a34a',
  info: '#2563eb',
  locked: '#334155',
} as const;

/**
 * RECAFCO brand surface used only by the launch experience (native splash background in
 * app.json + the React Native welcome screen). Deliberately separate from `colors` above —
 * the rest of the app keeps its light theme. `red` is sampled from the official logo artwork.
 * Keep `charcoal` in sync with the expo-splash-screen `backgroundColor` in app.json so the
 * native → React Native handoff has no color jump.
 */
export const brand = {
  charcoal: '#191919',
  charcoalRaised: '#202020',
  red: '#EA262A',
  white: '#ffffff',
  textOnDarkMuted: '#b8b8b8',
} as const;
