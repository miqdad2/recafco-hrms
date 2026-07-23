import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarCheck,
  Clock,
  FileEdit,
  Fingerprint,
  IdCard,
  LayoutDashboard,
  MapPin,
  ScrollText,
  Smartphone,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Permission code required to see this item. Omitted for items every authenticated user can see. */
  permission?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Employees', href: '/employees', icon: Users, permission: 'employees.read' },
  { label: 'Departments', href: '/departments', icon: Building2, permission: 'departments.read' },
  { label: 'Designations', href: '/designations', icon: IdCard, permission: 'designations.read' },
  { label: 'Work Locations', href: '/work-locations', icon: MapPin, permission: 'workLocations.read' },
  {
    label: 'Attendance Devices',
    href: '/attendance-devices',
    icon: Fingerprint,
    permission: 'attendanceDevices.read',
  },
  { label: 'Mobile Devices', href: '/mobile-devices', icon: Smartphone, permission: 'mobileDevices.read' },
  { label: 'Raw Punches', href: '/attendance-punches', icon: Clock, permission: 'attendancePunches.read' },
  {
    label: 'Attendance Summaries',
    href: '/attendance-summaries',
    icon: CalendarCheck,
    permission: 'attendanceSummaries.read',
  },
  {
    label: 'Attendance Corrections',
    href: '/attendance-corrections',
    icon: FileEdit,
    permission: 'attendanceCorrections.read',
  },
  { label: 'Audit Logs', href: '/audit-logs', icon: ScrollText, permission: 'audit.read' },
];

/** Any permission that unlocks at least one admin-only nav item — used to decide admin vs employee navigation mode. */
export const ADMIN_NAV_PERMISSIONS: string[] = NAV_ITEMS.filter((item) => item.permission).map(
  (item) => item.permission as string,
);

export interface EmployeeNavLink {
  type: 'link';
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface EmployeeNavComingSoon {
  type: 'coming-soon';
  label: string;
}

export interface EmployeeNavGroup {
  type: 'group';
  label: string;
  icon: LucideIcon;
  children: (EmployeeNavLink | EmployeeNavComingSoon)[];
}

export type EmployeeNavEntry = EmployeeNavLink | EmployeeNavGroup;

/**
 * Shown instead of NAV_ITEMS for users with none of ADMIN_NAV_PERMISSIONS (typically the
 * EMPLOYEE role) — grouped to match the Pinnacle ESS benchmark's Workflow/Time
 * Management/Reports sections while keeping RECAFCO's own routes/labels. No `permission`
 * gating on any entry: every linked route only ever calls the current user's own `/me`-style
 * endpoints. "Coming soon" entries render as plain, non-clickable text — never a link, never a
 * button with an onPress — so there is no path from them to a backend call.
 */
export const EMPLOYEE_NAV_ITEMS: EmployeeNavEntry[] = [
  { type: 'link', label: 'Home', href: '/dashboard', icon: LayoutDashboard },
  {
    type: 'group',
    label: 'Workflow',
    icon: Briefcase,
    children: [
      { type: 'link', label: 'Attendance Correction', href: '/corrections', icon: FileEdit },
      { type: 'coming-soon', label: 'Leave Request' },
      { type: 'coming-soon', label: 'Document Request' },
    ],
  },
  {
    type: 'group',
    label: 'Time Management',
    icon: Clock,
    children: [
      { type: 'link', label: 'My Attendance', href: '/attendance', icon: CalendarCheck },
      { type: 'link', label: 'Device Registration', href: '/device', icon: Smartphone },
    ],
  },
  {
    type: 'group',
    label: 'Reports',
    icon: BarChart3,
    children: [{ type: 'coming-soon', label: 'Payslip' }],
  },
  { type: 'link', label: 'Profile', href: '/profile', icon: User },
];
