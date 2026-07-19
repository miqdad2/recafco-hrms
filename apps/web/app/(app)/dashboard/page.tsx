'use client';

import { Building2, CalendarCheck, FileEdit, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/auth-context';

const DASHBOARD_CARDS = [
  { title: 'Employees', description: 'Headcount, onboarding, and directory management.', icon: Users },
  { title: 'Attendance Today', description: 'Live present/absent/late counts across all sites.', icon: CalendarCheck },
  {
    title: 'Pending Corrections',
    description: 'Missed-punch and correction requests awaiting approval.',
    icon: FileEdit,
  },
  { title: 'Device Status', description: 'Health of registered biometric and mobile devices.', icon: Building2 },
];

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Welcome back{user ? `, ${user.username}` : ''}.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DASHBOARD_CARDS.map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <card.icon className="h-5 w-5 text-accent" />
              <CardTitle>{card.title}</CardTitle>
              <CardDescription>{card.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-sm font-medium text-subtle-foreground">Coming soon</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
