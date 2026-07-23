import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';

interface CreateActionSheetProps {
  visible: boolean;
  onClose: () => void;
}

interface ActionItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href?: string;
  comingSoon?: boolean;
}

const ACTIONS: ActionItem[] = [
  { key: 'correction', label: 'Attendance Correction', icon: 'document-text-outline', href: '/corrections' },
  { key: 'device', label: 'Device Registration', icon: 'phone-portrait-outline', href: '/device' },
  { key: 'change-password', label: 'Change Password', icon: 'key-outline', href: '/change-password' },
  { key: 'leave', label: 'Leave Request', icon: 'calendar-outline', comingSoon: true },
  { key: 'document', label: 'Document Request', icon: 'folder-outline', comingSoon: true },
];

/** The center "+" tab's quick-create bottom sheet — a real device/attendance-correction shortcut, not a new feature; "Coming soon" rows never call the backend. */
export function CreateActionSheet({ visible, onClose }: CreateActionSheetProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handlePress = (action: ActionItem) => {
    if (action.comingSoon) {
      Alert.alert(action.label, `${action.label} is coming soon.`);
      return;
    }
    onClose();
    if (action.href) {
      router.push(action.href);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Create</Text>

          {ACTIONS.map((action) => (
            <Pressable
              key={action.key}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => handlePress(action)}
            >
              <View style={styles.iconCircle}>
                <Ionicons name={action.icon} size={20} color={colors.accentPrimary} />
              </View>
              <Text style={styles.rowLabel}>{action.label}</Text>
              {action.comingSoon ? <Text style={styles.comingSoonTag}>Coming soon</Text> : null}
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  sheet: {
    backgroundColor: colors.bgSurface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgMuted,
  },
  rowPressed: { backgroundColor: colors.bgMuted },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bgMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  rowLabel: { fontSize: 15, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  comingSoonTag: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
});
