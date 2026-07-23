import { Redirect } from 'expo-router';

/**
 * This route is never actually shown — the "+" tab's `tabBarButton` in `_layout.tsx` fully
 * replaces its press behavior with opening `CreateActionSheet`, so a user never navigates here
 * by tapping. This file only exists because Expo Router requires a real route file for
 * `Tabs.Screen name="create"` to resolve; the redirect is a safety net for the unlikely case of
 * a stale saved navigation state pointing here directly.
 */
export default function CreateScreen() {
  return <Redirect href="/" />;
}
