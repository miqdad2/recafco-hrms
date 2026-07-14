# RECAFCO HRMS — UI Context

## Theme

The UI should feel like a modern internal enterprise application: clean, professional, fast, and trustworthy. It must be easier and more employee-friendly than the existing third-party ESS system.

The design should prioritize:

- Clarity for employees
- Fast actions for attendance
- Dense but readable tables for HR
- Trustworthy management dashboards
- Clear warning states for payroll-critical issues
- Arabic/English readiness
- Mobile-first employee experience

Do not create a flashy consumer app. This is an enterprise HR system where accuracy, clarity, and confidence matter.

## Design Language

- Light professional default theme
- Optional dark mode can be added later, not required in MVP
- Clean card-based dashboards
- Clear status badges
- Strong but restrained color usage
- Large primary action for punch-in/punch-out
- Minimal technical data shown to employees
- Detailed technical data available to HR/admin audit views

## Colors

Use CSS variables/tokens. Do not hardcode hex values inside components.

| Role | CSS Variable | Suggested Value | Usage |
| --- | --- | --- | --- |
| Page background | `--bg-base` | `#f6f8fb` | Main app background |
| Surface | `--bg-surface` | `#ffffff` | Cards, panels, modals |
| Surface muted | `--bg-muted` | `#f1f5f9` | Secondary blocks |
| Primary text | `--text-primary` | `#0f172a` | Main text |
| Secondary text | `--text-secondary` | `#475569` | Labels, descriptions |
| Muted text | `--text-muted` | `#64748b` | Hints and metadata |
| Primary accent | `--accent-primary` | `#0f766e` | Main action/buttons |
| Primary accent hover | `--accent-primary-hover` | `#115e59` | Button hover |
| Border | `--border-default` | `#dbe3ea` | Card/table borders |
| Error | `--state-error` | `#dc2626` | Rejected, missing, risk |
| Warning | `--state-warning` | `#d97706` | Pending, suspicious |
| Success | `--state-success` | `#16a34a` | Accepted, present |
| Info | `--state-info` | `#2563eb` | Informational states |
| Locked | `--state-locked` | `#334155` | Payroll locked states |

## Typography

| Role | Font | Variable |
| --- | --- | --- |
| UI text | Inter / Geist Sans | `--font-sans` |
| Mono/code | Geist Mono / JetBrains Mono | `--font-mono` |

Rules:

- Use clear readable font sizes.
- Avoid very small text for attendance status.
- HR tables can be dense but must remain readable.
- Important payroll/attendance numbers must be visually prominent.

## Border Radius

| Context | Class |
| --- | --- |
| Small controls | `rounded-md` |
| Cards / panels | `rounded-xl` |
| Dashboard cards | `rounded-2xl` |
| Modals / sheets | `rounded-2xl` |
| Mobile punch button | `rounded-2xl` or circular button if appropriate |

## Component Library

Recommended:

- Tailwind CSS
- shadcn/ui
- Lucide icons
- TanStack Table
- React Hook Form
- Zod
- Recharts

Rules:

- Use shadcn/ui primitives for consistency.
- Do not modify generated shadcn components directly unless intentionally maintaining a fork.
- Build business components separately.
- Use reusable status badges for attendance and approval states.
- Use skeleton loaders for dashboard/table loading states.
- Use empty states with clear next actions.

## Layout Patterns

### Employee Mobile Home

Must prioritize punch status.

Top section:

- Greeting
- Date
- Today shift
- Current attendance status
- Location status
- Big punch button

Cards:

- Leave balance
- Attendance this month
- Pending requests
- Latest payslip
- Announcements

Do not show raw latitude/longitude to normal employees unless in a diagnostic/debug screen.

### Employee Web ESS

Use a simple dashboard:

- Today attendance
- Quick actions
- Leave balance
- Attendance calendar
- Documents
- Payslip
- Announcements

### HR Admin Web

Use sidebar layout:

- Dashboard
- Employees
- Attendance
- Corrections
- Leave
- Locations
- Devices
- Shifts
- Documents
- Payslips
- Reports
- Settings
- Audit Logs

Tables should support:

- Search
- Filter
- Export
- Column visibility where useful
- Pagination
- Row actions
- Status badges

### Manager Dashboard

Show:

- Team present/absent/late
- Pending approvals
- Suspicious punches in team
- Team attendance calendar
- Quick approve/reject actions with reason

### Management Dashboard

Show executive summary:

- Total manpower
- Present today
- Absent today
- Late today
- Location-wise count
- Department-wise count
- Overtime trend
- Leave trend
- Risk alerts

## Attendance UI Rules

### Employee Punch Screen

Show simple status:

- Inside allowed location / Outside allowed location
- GPS accuracy acceptable / poor
- Registered device / device issue
- Shift status
- Punch allowed / punch blocked / review required

Do not show technical fields by default:

- Raw latitude
- Raw longitude
- Workplace latitude
- Workplace longitude
- Fraud score

These belong to HR/admin audit view.

### HR Punch Audit View

Show all technical data:

- Source type
- Source ID
- Device ID
- Mobile device ID
- GPS coordinates
- Accuracy
- Distance
- Wi-Fi proof
- Selfie proof
- Validation status
- Fraud flags
- Raw payload
- Duplicate hash
- Official/duplicate status

## Status Badge Conventions

Attendance:

- Present: success
- Absent: error
- Late: warning
- Leave: info
- Missing punch: warning/error depending severity
- Holiday/week off: muted
- Pending review: warning
- Payroll locked: locked

Punch validation:

- Accepted: success
- Accepted with warning: warning
- Rejected: error
- Pending HR review: warning
- Duplicate: muted
- Manual correction: info

## Mobile UI Rules

- Punch action must be large and hard to mis-tap.
- Show confirmation result after every punch attempt.
- Do not hide rejected punch reason.
- If app is offline, explain whether punch can be queued or must wait.
- Use secure UX for session expiry.
- Use biometric app unlock only after normal login is established.
- Keep mobile screens fast and simple.

## Accessibility

- Buttons must have clear labels.
- Colors must not be the only indicator of status.
- Use icons + labels for important states.
- Text contrast must be accessible.
- Support larger text reasonably.
- Avoid tiny status chips for payroll-critical warnings.

## Localization

- Design must support English and Arabic.
- Avoid fixed-width text layouts that break in Arabic.
- Keep labels concise.
- Use centralized translation keys from the start where feasible.
- Do not hardcode user-facing strings deep inside business logic.
