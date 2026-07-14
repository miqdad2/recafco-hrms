# RECAFCO HRMS — Project Overview

## Overview

RECAFCO HRMS is an internal enterprise Human Resource Management System for a company with 2000+ employees across multiple offices, factory locations, warehouses, and project sites. The system provides web and mobile applications for employee self-service, attendance, leave, documents, approvals, reporting, and future payroll support.

The most critical module is attendance. Employees may punch in/out using mobile apps, office punching devices, biometric devices, face/card devices, or approved manual correction workflows. All punch sources must flow into one central attendance engine to produce payroll-safe daily attendance summaries.

The system is intended to eventually replace or reduce dependence on the current third-party HR/ESS system, but only through phased rollout, parallel validation, and management approval.


## Payroll-Critical Attendance Requirement

Attendance is salary-impacting and must be treated as a payroll-grade transaction system. The system must support 2000+ employees across multiple offices, factories, warehouses, and project sites. Employees may punch through office devices, mobile app, or a valid mixed combination such as mobile check-in and device check-out.

The official attendance result must be calculated by the central attendance engine from validated raw punches, not directly from a single UI action. Fraud prevention, audit logs, exception approval, and payroll period locking are mandatory.

## Goals

1. Provide a fast and reliable internal HRMS for 2000+ employees.
2. Support web, Android, and iOS access from day one.
3. Accurately capture punch-in and punch-out from both mobile and physical punching devices.
4. Prevent attendance fraud using geofence validation, device binding, fake GPS detection, optional selfie proof, Wi-Fi/QR/site validation, and audit logs.
5. Generate payroll-safe daily and monthly attendance summaries from immutable raw punch records.
6. Support HR, manager, employee, and management workflows with role-based permissions.
7. Run internally with strong backups, monitoring, auditability, and rollback capability.
8. Build in phases without interrupting the existing third-party HR system.

## Primary User Roles

### Employee

- Uses mobile app or web ESS
- Views profile, attendance, leave balance, documents, payslips, announcements
- Punches in/out through approved mobile or device methods
- Requests leave, missed punch correction, letter requests, passport withdrawal, and other HR requests

### Manager / Supervisor

- Views team attendance
- Approves or rejects leave requests
- Approves or rejects attendance correction requests
- Reviews suspicious or exception punches where assigned
- Views team monthly attendance reports

### HR Officer

- Manages employee data
- Manages shifts, locations, departments, leave balances, documents, announcements
- Reviews attendance exceptions
- Runs monthly attendance closing
- Prepares payroll attendance export
- Uploads payslips/documents
- Cannot silently edit payroll-critical data

### HR Manager

- Has elevated approval authority
- Can approve sensitive corrections
- Can reopen attendance periods based on policy
- Reviews fraud/risk alerts

### Finance / Payroll User

- Views approved attendance summaries
- Exports payroll-ready reports
- Reviews post-lock corrections if payroll has already been processed

### Management

- Views dashboards and reports
- Reviews manpower, attendance, leave, overtime, risk, and department/site trends
- Does not directly edit attendance records unless explicitly granted by policy

### System Administrator

- Manages users, roles, permissions, system settings, integrations, backups, monitoring configuration
- Cannot bypass audit logging

## Core User Flows

### Employee Mobile Attendance Flow

1. Employee logs in to mobile app.
2. App verifies session, registered device, and app integrity checks.
3. Employee opens Today Attendance.
4. App collects GPS location, accuracy, timestamp, device details, network details, and optional selfie/QR/Wi-Fi proof.
5. Employee taps Check In or Check Out.
6. Backend validates employee, shift, assigned location, geofence, device binding, source trust, duplicate risk, and fraud signals.
7. Backend stores raw punch attempt immediately.
8. Accepted punches update/recalculate the daily attendance summary.
9. Rejected or suspicious punches are stored and shown with clear reason.
10. Employee and manager can see final status or required action.

### Device Punch Sync Flow

1. Punching device records employee punch.
2. Integration service imports logs through API, SDK, database pull, CSV, or scheduled file import depending on device capability.
3. System stores each imported record in raw punch table with original payload.
4. Duplicate hashes prevent repeated imports.
5. Attendance engine validates and recalculates daily summaries.
6. HR can see sync status and device health.

### Mixed Punch Flow

Example: mobile check-in + office device check-out.

1. Employee checks in using mobile.
2. Employee checks out using office device.
3. Both records enter `attendance_raw_punches`.
4. Attendance engine selects earliest valid IN and latest valid OUT according to rules.
5. Daily summary shows official IN/OUT, source labels, total hours, late/early/overtime, and risk flags if any.

### Attendance Correction Flow

1. Employee submits missed punch or correction request.
2. Supervisor reviews and approves/rejects.
3. HR verifies if required by policy.
4. System creates correction event; raw records remain unchanged.
5. Daily attendance summary is recalculated.
6. Audit log stores before/after values, reason, approvers, timestamps, and attached evidence.

### Monthly Attendance Closing Flow

1. HR opens monthly closing dashboard.
2. System lists missing punches, pending corrections, absences, overtime, late/early cases, rejected punches, and fraud alerts.
3. HR resolves or approves exceptions.
4. HR manager closes attendance period.
5. Payroll/finance exports approved summary.
6. Locked period cannot be edited silently. Reopen or post-lock correction requires approval and audit.

## Feature Scope

### Phase 1 — Foundation

In scope:

- Monorepo setup
- Authentication
- RBAC permissions
- Employees
- Departments
- Designations
- Work locations/geofences
- Shifts
- Mobile device registration
- Audit logs
- Basic HR/admin web layout
- Basic employee mobile shell

Out of scope:

- Payroll calculation engine
- Recruitment
- Training
- Complex performance appraisal
- AI face recognition
- Full biometric hardware integration beyond a mock/import adapter

### Phase 2 — Payroll-Safe Attendance MVP

In scope:

- Mobile check-in/check-out
- Raw punch table
- Attendance validation engine
- Daily summaries
- Mixed mobile/device punch handling
- Manual correction request flow
- HR attendance dashboard
- Manager approval
- Device punch import abstraction
- Fraud flags
- Reports/export

Out of scope:

- Full salary calculation
- Deep hardware SDK support for every device brand
- Complex shift patterns unless required by validated policy

### Phase 3 — ESS and Leave

In scope:

- Leave request
- Leave balance
- Holidays
- Attendance history/calendar
- Employee documents
- Payslip upload/view
- Announcements
- Notifications

### Phase 4 — Payroll Support and Advanced Controls

In scope:

- Monthly attendance closing
- Payroll export
- Overtime/late/early calculation policies
- Post-lock correction workflow
- Advanced risk reports
- Backup/restore drill documentation

Out of scope unless approved:

- Replacing finance/payroll system fully
- Biometric face recognition as official identity verification
- Public internet exposure without VPN/security approval

## Success Criteria

1. System can handle 2000+ active employees with fast punch response during peak times.
2. A mobile punch saves raw punch attempt even if later rejected.
3. Device punches and mobile punches are processed by the same attendance engine.
4. Mobile IN + device OUT and device IN + mobile OUT produce correct daily summaries.
5. Duplicate and conflicting punches are stored but do not corrupt official IN/OUT.
6. Payroll uses only approved daily/monthly summaries, not raw punches directly.
7. Payroll-locked periods cannot be silently modified.
8. Every manual correction includes reason, approver, before/after, and audit log.
9. HR can identify missing punches, rejected punches, suspicious punches, and pending approvals before monthly closing.
10. System has backup, restore, monitoring, and rollback-ready deployment process.
