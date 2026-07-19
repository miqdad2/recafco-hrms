import { useRouter } from 'expo-router';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError, changePassword } from '../../src/lib/api/client';
import { useAuth } from '../../src/lib/auth/auth-context';
import { colors } from '../../src/lib/theme';

interface ChangePasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { updateUser } = useAuth();
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (values: ChangePasswordFormValues) => {
    setSubmitError(null);
    try {
      await changePassword(values);
      updateUser({ mustChangePassword: false });
      setSuccess(true);
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not change password. Please try again.');
    }
  };

  if (success) {
    return (
      <View style={styles.successScreen}>
        <Text style={styles.successTitle}>Password changed</Text>
        <Text style={styles.successMessage}>Your password has been updated successfully.</Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => router.back()}
        >
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Change Password</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Current Password</Text>
          <Controller
            control={control}
            name="currentPassword"
            rules={{ required: 'Current password is required' }}
            render={({ field: { value, onChange, onBlur } }) => (
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secureTextEntry
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
              />
            )}
          />
          {errors.currentPassword ? <Text style={styles.fieldError}>{errors.currentPassword.message}</Text> : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>New Password</Text>
          <Controller
            control={control}
            name="newPassword"
            rules={{ required: 'New password is required', minLength: { value: 8, message: 'At least 8 characters' } }}
            render={({ field: { value, onChange, onBlur } }) => (
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secureTextEntry
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
              />
            )}
          />
          {errors.newPassword ? <Text style={styles.fieldError}>{errors.newPassword.message}</Text> : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Confirm New Password</Text>
          <Controller
            control={control}
            name="confirmPassword"
            rules={{ required: 'Please confirm the new password' }}
            render={({ field: { value, onChange, onBlur } }) => (
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secureTextEntry
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
              />
            )}
          />
          {errors.confirmPassword ? <Text style={styles.fieldError}>{errors.confirmPassword.message}</Text> : null}
        </View>

        {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, isSubmitting && styles.buttonDisabled]}
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
        >
          {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Change Password</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bgBase },
  container: { flexGrow: 1, padding: 24 },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 24 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.bgSurface,
  },
  fieldError: { color: colors.error, fontSize: 12, marginTop: 4 },
  submitError: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
    backgroundColor: '#fef2f2',
    padding: 10,
    borderRadius: 8,
  },
  button: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonPressed: { backgroundColor: colors.accentPrimaryHover },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  successScreen: { flex: 1, backgroundColor: colors.bgBase, alignItems: 'center', justifyContent: 'center', padding: 24 },
  successTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  successMessage: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 24 },
});
