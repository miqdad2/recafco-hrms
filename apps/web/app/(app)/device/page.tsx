'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorAlert } from '@/components/admin/error-alert';
import { Spinner } from '@/components/admin/spinner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, type BadgeTone } from '@/components/ui/status-badge';
import { getMyMobileDevices, type MobileDevice, type MobileDeviceStatus } from '@/lib/api/mobile-devices';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '@/lib/auth/no-employee-message';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// Matches the task's exact requested wording: "Not registered, Pending, Approved, Blocked, Deactivated".
const STATUS_LABELS: Record<MobileDeviceStatus, string> = {
  PENDING_APPROVAL: 'Pending',
  APPROVED: 'Approved',
  BLOCKED: 'Blocked',
  DEACTIVATED: 'Deactivated',
};

const STATUS_TONES: Record<MobileDeviceStatus, BadgeTone> = {
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  BLOCKED: 'error',
  DEACTIVATED: 'muted',
};

function DeviceCard({ device }: { device: MobileDevice }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{device.deviceName ?? device.platform}</CardTitle>
          <StatusBadge label={STATUS_LABELS[device.status]} tone={STATUS_TONES[device.status]} />
        </div>
        <CardDescription>
          {device.manufacturer ?? '—'} {device.model ?? ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
        <span>Platform: {device.platform}</span>
        <span>OS Version: {device.osVersion ?? '—'}</span>
        <span>Registered: {new Date(device.registeredAt).toLocaleString()}</span>
        <span>Last Seen: {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '—'}</span>
      </CardContent>
    </Card>
  );
}

export default function DevicePage() {
  const { user } = useAuth();
  const hasEmployee = user?.employeeId != null;

  const query = useQuery({
    queryKey: ['my-mobile-devices'],
    queryFn: getMyMobileDevices,
    enabled: hasEmployee,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">My Device</h1>
        <p className="text-sm text-muted-foreground">Your mobile device registration status.</p>
      </div>

      {!hasEmployee ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {NO_EMPLOYEE_MESSAGE}
        </div>
      ) : query.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : query.isError ? (
        <ErrorAlert message={errorMessage(query.error, 'Failed to load device status.')} />
      ) : query.data && query.data.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {query.data.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Not Registered</CardTitle>
            <CardDescription>
              This account has no registered mobile device yet. Use the mobile app to register this device.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
