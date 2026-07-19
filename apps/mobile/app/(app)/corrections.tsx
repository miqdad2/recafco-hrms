import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  listMyAttendanceCorrections,
  requestAttendanceCorrection,
  type AttendanceCorrection,
  type CorrectionType,
} from '../../src/lib/api/attendance-corrections';
import { ApiError } from '../../src/lib/api/client';
import {
  CORRECTION_STATUS_COPY,
  CORRECTION_TYPES_REQUIRING_PUNCH_TIME,
  CORRECTION_TYPES_REQUIRING_PUNCH_TYPE,
  CORRECTION_TYPES_REQUIRING_TARGET_PUNCH,
  CORRECTION_TYPE_LABELS,
} from '../../src/lib/attendance/correction-status-copy';
import { formatDateForDisplay, formatDateTimeForDisplay } from '../../src/lib/attendance/date-utils';
import { useAuth } from '../../src/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '../../src/lib/auth/no-employee-message';
import { colors } from '../../src/lib/theme';

const CORRECTION_TYPES: CorrectionType[] = [
  'MISSED_IN',
  'MISSED_OUT',
  'WRONG_IN',
  'WRONG_OUT',
  'MANUAL_ADJUSTMENT',
  'OTHER',
];

const REQUESTED_PUNCH_TYPES: ('IN' | 'OUT')[] = ['IN', 'OUT'];

interface CorrectionFormValues {
  workDate: string;
  correctionType: CorrectionType;
  requestedPunchType: 'IN' | 'OUT' | '';
  requestedPunchTime: string;
  targetPunchId: string;
  reason: string;
}

const WORK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function CorrectionsScreen() {
  const { user, logout } = useAuth();
  const hasEmployee = user?.employeeId != null;

  const [corrections, setCorrections] = React.useState<AttendanceCorrection[] | null>(null);
  const [isLoadingList, setIsLoadingList] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CorrectionFormValues>({
    defaultValues: {
      workDate: '',
      correctionType: 'MISSED_IN',
      requestedPunchType: '',
      requestedPunchTime: '',
      targetPunchId: '',
      reason: '',
    },
  });

  const selectedType = watch('correctionType');
  const needsPunchType = CORRECTION_TYPES_REQUIRING_PUNCH_TYPE.includes(selectedType);
  const needsPunchTime = CORRECTION_TYPES_REQUIRING_PUNCH_TIME.includes(selectedType);
  const needsTargetPunch = CORRECTION_TYPES_REQUIRING_TARGET_PUNCH.includes(selectedType);

  const loadCorrections = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!hasEmployee) {
        setIsLoadingList(false);
        return;
      }
      setListError(null);
      try {
        const result = await listMyAttendanceCorrections({ limit: 50 });
        setCorrections(result.data);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await logout();
          return;
        }
        if (!options.silent) {
          setListError(error instanceof ApiError ? error.message : 'Could not load correction requests.');
        }
      } finally {
        setIsLoadingList(false);
        setIsRefreshing(false);
      }
    },
    [hasEmployee, logout],
  );

  React.useEffect(() => {
    let cancelled = false;

    async function loadInitialCorrections() {
      if (!hasEmployee) {
        if (!cancelled) {
          setIsLoadingList(false);
        }
        return;
      }
      setListError(null);
      try {
        const result = await listMyAttendanceCorrections({ limit: 50 });
        if (!cancelled) {
          setCorrections(result.data);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await logout();
          return;
        }
        if (!cancelled) {
          setListError(error instanceof ApiError ? error.message : 'Could not load correction requests.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingList(false);
        }
      }
    }

    void loadInitialCorrections();
    return () => {
      cancelled = true;
    };
  }, [hasEmployee, logout]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    void loadCorrections();
  };

  const onSubmit = async (values: CorrectionFormValues) => {
    setSubmitMessage(null);
    try {
      await requestAttendanceCorrection({
        workDate: values.workDate,
        correctionType: values.correctionType,
        requestedPunchType: needsPunchType && values.requestedPunchType ? values.requestedPunchType : undefined,
        requestedPunchTime: needsPunchTime ? values.requestedPunchTime : undefined,
        targetPunchId: needsTargetPunch ? values.targetPunchId : undefined,
        reason: values.reason,
      });
      setSubmitMessage({ type: 'success', text: 'Correction request submitted. Waiting for approval.' });
      reset({
        workDate: '',
        correctionType: 'MISSED_IN',
        requestedPunchType: '',
        requestedPunchTime: '',
        targetPunchId: '',
        reason: '',
      });
      await loadCorrections({ silent: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await logout();
        return;
      }
      setSubmitMessage({
        type: 'error',
        text: error instanceof ApiError ? error.message : 'Could not submit correction request. Please try again.',
      });
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        hasEmployee ? <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} /> : undefined
      }
    >
      {!hasEmployee ? (
        <View style={[styles.section, styles.noticeCard]}>
          <Text style={styles.noticeText}>{NO_EMPLOYEE_MESSAGE}</Text>
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Request a Correction</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Work Date</Text>
              <Controller
                control={control}
                name="workDate"
                rules={{
                  required: 'Work date is required',
                  pattern: { value: WORK_DATE_PATTERN, message: 'Use format YYYY-MM-DD' },
                }}
                render={({ field: { value, onChange, onBlur } }) => (
                  <TextInput
                    style={styles.input}
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="2026-07-15"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                )}
              />
              {errors.workDate ? <Text style={styles.fieldError}>{errors.workDate.message}</Text> : null}
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Correction Type</Text>
              <Controller
                control={control}
                name="correctionType"
                render={({ field: { value, onChange } }) => (
                  <View style={styles.chipRow}>
                    {CORRECTION_TYPES.map((type) => (
                      <Pressable
                        key={type}
                        style={[styles.chip, value === type && styles.chipSelected]}
                        onPress={() => onChange(type)}
                      >
                        <Text style={[styles.chipText, value === type && styles.chipTextSelected]}>
                          {CORRECTION_TYPE_LABELS[type]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              />
            </View>

            {needsPunchType ? (
              <View style={styles.field}>
                <Text style={styles.label}>Requested Punch Type</Text>
                <Controller
                  control={control}
                  name="requestedPunchType"
                  rules={{ required: needsPunchType ? 'Requested punch type is required' : false }}
                  render={({ field: { value, onChange } }) => (
                    <View style={styles.chipRow}>
                      {REQUESTED_PUNCH_TYPES.map((type) => (
                        <Pressable
                          key={type}
                          style={[styles.chip, value === type && styles.chipSelected]}
                          onPress={() => onChange(type)}
                        >
                          <Text style={[styles.chipText, value === type && styles.chipTextSelected]}>{type}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                />
                {errors.requestedPunchType ? (
                  <Text style={styles.fieldError}>{errors.requestedPunchType.message}</Text>
                ) : null}
              </View>
            ) : null}

            {needsPunchTime ? (
              <View style={styles.field}>
                <Text style={styles.label}>Requested Punch Time</Text>
                <Controller
                  control={control}
                  name="requestedPunchTime"
                  rules={{
                    required: needsPunchTime ? 'Requested punch time is required' : false,
                    validate: (value) =>
                      !needsPunchTime || !Number.isNaN(new Date(value).getTime()) || 'Enter a valid date/time',
                  }}
                  render={({ field: { value, onChange, onBlur } }) => (
                    <TextInput
                      style={styles.input}
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      placeholder="2026-07-15T08:00:00.000Z"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  )}
                />
                {errors.requestedPunchTime ? (
                  <Text style={styles.fieldError}>{errors.requestedPunchTime.message}</Text>
                ) : null}
              </View>
            ) : null}

            {needsTargetPunch ? (
              <View style={styles.field}>
                <Text style={styles.label}>Related Punch ID</Text>
                <Controller
                  control={control}
                  name="targetPunchId"
                  rules={{ required: needsTargetPunch ? 'Related punch ID is required for this correction type' : false }}
                  render={({ field: { value, onChange, onBlur } }) => (
                    <TextInput
                      style={styles.input}
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      placeholder="Punch ID from your attendance history"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  )}
                />
                {errors.targetPunchId ? <Text style={styles.fieldError}>{errors.targetPunchId.message}</Text> : null}
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>Reason</Text>
              <Controller
                control={control}
                name="reason"
                rules={{ required: 'Reason is required', maxLength: { value: 1000, message: 'Max 1000 characters' } }}
                render={({ field: { value, onChange, onBlur } }) => (
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="Forgot to punch out due to site work…"
                    placeholderTextColor={colors.textMuted}
                    multiline
                    numberOfLines={4}
                  />
                )}
              />
              {errors.reason ? <Text style={styles.fieldError}>{errors.reason.message}</Text> : null}
            </View>

            {submitMessage ? (
              <Text style={submitMessage.type === 'success' ? styles.successText : styles.errorText}>
                {submitMessage.text}
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                isSubmitting && styles.buttonDisabled,
              ]}
              onPress={handleSubmit(onSubmit)}
              disabled={isSubmitting}
            >
              {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit Request</Text>}
            </Pressable>
          </View>

          <View style={styles.section}>
            <View style={styles.listHeader}>
              <Text style={styles.sectionTitle}>My Correction Requests</Text>
              <Pressable onPress={handleRefresh} disabled={isRefreshing || isLoadingList}>
                <Text style={styles.refreshLink}>{isRefreshing ? 'Refreshing…' : 'Refresh'}</Text>
              </Pressable>
            </View>

            {isLoadingList ? (
              <ActivityIndicator color={colors.accentPrimary} style={styles.statusSpinner} />
            ) : listError ? (
              <Text style={styles.errorText}>{listError}</Text>
            ) : !corrections || corrections.length === 0 ? (
              <Text style={styles.emptyText}>No correction requests yet.</Text>
            ) : (
              corrections.map((correction) => (
                <View key={correction.id} style={styles.requestCard}>
                  <View style={styles.requestHeaderRow}>
                    <Text style={styles.requestDate}>{formatDateForDisplay(correction.workDate)}</Text>
                    <View style={styles.statusRow}>
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: CORRECTION_STATUS_COPY[correction.status].tone },
                        ]}
                      />
                      <Text style={styles.statusLabel}>{CORRECTION_STATUS_COPY[correction.status].label}</Text>
                    </View>
                  </View>
                  <Text style={styles.requestType}>{CORRECTION_TYPE_LABELS[correction.correctionType]}</Text>
                  {correction.requestedPunchType ? (
                    <Text style={styles.requestMeta}>Requested punch type: {correction.requestedPunchType}</Text>
                  ) : null}
                  {correction.requestedPunchTime ? (
                    <Text style={styles.requestMeta}>
                      Requested time: {formatDateTimeForDisplay(correction.requestedPunchTime)}
                    </Text>
                  ) : null}
                  <Text style={styles.requestReason} numberOfLines={3}>
                    {correction.reason}
                  </Text>
                  {correction.status === 'REJECTED' && correction.rejectedReason ? (
                    <Text style={styles.errorText}>Rejected reason: {correction.rejectedReason}</Text>
                  ) : null}
                  {correction.status === 'APPROVED' && correction.approvedAt ? (
                    <Text style={styles.successText}>
                      Approved on {formatDateTimeForDisplay(correction.approvedAt)}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgBase },
  container: { padding: 20 },
  section: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  noticeCard: { backgroundColor: '#fffbeb' },
  noticeText: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.bgSurface,
  },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  fieldError: { color: colors.error, fontSize: 12, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.bgMuted,
  },
  chipSelected: { backgroundColor: colors.accentPrimary, borderColor: colors.accentPrimary },
  chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  successText: {
    color: colors.success,
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },
  button: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonPressed: { backgroundColor: colors.accentPrimaryHover },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  refreshLink: { color: colors.accentPrimary, fontSize: 13, fontWeight: '600' },
  statusSpinner: { marginVertical: 8 },
  emptyText: { fontSize: 14, color: colors.textMuted },
  requestCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  requestHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  requestDate: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  requestType: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
  requestMeta: { fontSize: 12, color: colors.textSecondary, marginBottom: 2 },
  requestReason: { fontSize: 13, color: colors.textPrimary, marginTop: 4, lineHeight: 18 },
});
