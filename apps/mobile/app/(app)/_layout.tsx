import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppHeader } from '../../src/components/app-header';
import { CreateActionSheet } from '../../src/components/create-action-sheet';
import { LaunchWelcomeScreen } from '../../src/components/launch-welcome-screen';
import { SideMenu } from '../../src/components/side-menu';
import { useAuth } from '../../src/lib/auth/auth-context';
import { colors } from '../../src/lib/theme';

// The launch welcome plays once per app process (cold start). Later remounts of this layout —
// e.g. after logout → login — go straight to the tabs without replaying it.
let launchWelcomePlayed = false;

export default function AppLayout() {
  const { isLoading, isAuthenticated } = useAuth();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [welcomeDone, setWelcomeDone] = React.useState(launchWelcomePlayed);
  const finishWelcome = React.useCallback(() => {
    launchWelcomePlayed = true;
    setWelcomeDone(true);
  }, []);

  // Protected screens never render until auth restore has finished (`isLoading` false).
  if (isLoading || !welcomeDone) {
    return <LaunchWelcomeScreen ready={!isLoading} onFinish={finishWelcome} />;
  }

  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  return (
    <>
      <Tabs
        screenOptions={{
          header: () => <AppHeader onMenuPress={() => setMenuOpen(true)} />,
          tabBarActiveTintColor: colors.accentPrimary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: { backgroundColor: colors.bgSurface, borderTopColor: colors.border },
          tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            tabBarLabel: 'Home',
            tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="workflow"
          options={{
            tabBarLabel: 'Workflow',
            tabBarIcon: ({ color, size }) => <Ionicons name="briefcase-outline" size={size} color={color} />,
          }}
        />
        {/* Center "+" action: `tabBarButton` fully replaces the default pressable, so tapping it
            never navigates — it only opens the quick-create bottom sheet. Expo Router still
            requires a real route file named "create" for this Tabs.Screen to resolve; see
            create.tsx for why that file is a harmless, never-shown redirect. A true floating
            FAB detached from the bar would need deeper custom tab-bar surgery than this
            component-level override — this raised, circular, elevated button is the documented
            simplification per the task's own accepted fallback. */}
        <Tabs.Screen
          name="create"
          options={{
            tabBarLabel: () => null,
            tabBarButton: (props) => (
              <Pressable
                onPress={() => setCreateOpen(true)}
                style={[styles.centerButtonWrapper, props.style]}
                accessibilityRole="button"
                accessibilityLabel="Create"
              >
                <View style={styles.centerButton}>
                  <Ionicons name="add" size={28} color="#fff" />
                </View>
              </Pressable>
            ),
          }}
        />
        <Tabs.Screen
          name="attendance"
          options={{
            tabBarLabel: 'Attend.',
            tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="directory"
          options={{
            tabBarLabel: 'Directory',
            tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
          }}
        />
        {/* Moved out of the bottom bar into the side menu / quick-create sheet / Home quick
            links — still reachable via router.push, just not a tab. Same `href: null` pattern
            already established for change-password. */}
        <Tabs.Screen name="device" options={{ href: null }} />
        <Tabs.Screen name="profile" options={{ href: null }} />
        <Tabs.Screen name="corrections" options={{ href: null }} />
        <Tabs.Screen name="change-password" options={{ href: null }} />
      </Tabs>

      <SideMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
      <CreateActionSheet visible={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  centerButtonWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
});
