import {
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
