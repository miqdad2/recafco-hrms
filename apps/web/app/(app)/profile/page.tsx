'use client';

import * as React from 'react';
import { ChangePasswordModal } from '@/components/auth/change-password-modal';
import { DetailRow } from '@/components/admin/detail-row';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '@/lib/auth/no-employee-message';

export default function ProfilePage() {
  const { user } = useAuth();
  const hasEmployee = user?.employeeId != null;
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Profile</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <DetailRow label="Username" value={user?.username ?? '—'} />
          <DetailRow label="Employee Profile" value={hasEmployee ? `Linked (${user?.employeeId})` : 'Not Linked'} />
          {/*
            /auth/me only ever returns `employeeId` (a plain id string), never a full employee
            record — no employeeCode/department/designation/workLocation. These three rows show
            "—" for now rather than a fabricated value; a future employee-profile endpoint
            (self-service, not the admin-gated GET /employees/:id) should return these fields so
            this page can show real ones instead. Civil ID/religion/nationality/manager are
            deliberately never shown here even as placeholders — the task explicitly said not to
            fake them.
          */}
          <DetailRow label="Employee Code" value="—" />
          <DetailRow label="Department" value="—" />
          <DetailRow label="Designation" value="—" />
          <DetailRow label="Work Location" value="—" />
          <DetailRow label="Roles" value={user?.roles.join(', ') || 'None'} />
          <DetailRow label="Permissions" value={`${user?.permissions.length ?? 0} granted`} />
        </CardContent>
      </Card>

      {!hasEmployee ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {NO_EMPLOYEE_MESSAGE}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setChangePasswordOpen(true)}>
            Change Password
          </Button>
        </CardContent>
      </Card>

      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </div>
  );
}
