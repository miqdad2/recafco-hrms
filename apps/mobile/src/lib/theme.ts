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
