# RECAFCO HRMS — AI Workflow Rules

## Approach

Build this project incrementally using a strict spec-driven workflow. Context files define what to build, how to build it, and the current state of progress. Always implement against these specs. Do not infer or invent payroll-critical behavior from scratch.

This is an enterprise internal HRMS, not a prototype. Attendance directly affects salary, so accuracy, auditability, and reliability are more important than fast visual progress.

## Main Development Rule

One feature unit at a time.

A feature unit must be small enough to:

- Understand clearly
- Implement safely
- Verify end to end
- Roll back if needed
- Document in `progress-tracker.md`

## Scoping Rules

- Work on one bounded feature unit at a time.
- Prefer small, verifiable increments over large speculative changes.
- Do not combine unrelated system boundaries in one step.
- Do not implement UI before the required backend/data contract exists unless building a static wireframe.
- Do not implement payroll-sensitive behavior without a written rule in context.
- Do not make database changes without explaining why and updating architecture/progress context.

## Recommended Unit Order

1. Monorepo setup
2. Shared enums/permissions
3. Database package and initial Prisma schema
4. Auth and RBAC foundation
5. Employee/department/location/shift foundation
6. Attendance raw punch model
7. Mobile device registration model
8. Attendance validation engine
9. Mobile punch endpoint
10. Daily summary calculation
11. Device import adapter abstraction
12. Manager/HR correction workflow
13. Attendance dashboard
14. Monthly closing/lock workflow
15. Leave/ESS modules
16. Documents/payslips
17. Reports and exports
18. Monitoring, backup, deployment hardening

## When to Split Work

Split a task if it combines:

- UI and backend business logic
- Database schema and unrelated UI polish
- Multiple unrelated API domains
- Attendance calculation and leave management
- Mobile fraud checks and payroll closing
- Device integration and employee profile management
- Reports and punch endpoint behavior
- Any change that cannot be verified quickly

If a change cannot be tested or verified end to end quickly, the scope is too broad.

## Handling Missing Requirements

- Do not invent product behavior not defined in context files.
- If a requirement is ambiguous, add it as an open question in `progress-tracker.md`.
- If a rule affects payroll or salary, stop and document the decision before implementation.
- If a device integration detail is unknown, build an adapter interface and mock importer, not brand-specific assumptions.
- If company policy is unknown, implement configurable policy structure instead of hardcoding assumptions.

## Protected Areas

Do not modify unless explicitly instructed:

- Generated UI library internals
- Prisma migration files already applied to production
- Existing production data seed/migration history
- Authentication/security code outside the current scope
- Backup scripts after they are production approved
- Deployment scripts used by live production without creating rollback copy

## Attendance-Specific AI Rules

- Never delete raw punches.
- Never silently overwrite official attendance values.
- Never bypass audit logging for attendance corrections.
- Never use client-side GPS validation as final proof.
- Never assume mobile is more trustworthy than biometric device.
- Never reject a punch without storing the attempt and reason.
- Never make payroll summary from raw data without validation/approval state.
- Never mix device sync import and final payroll logic in one function.
- Never build a fake “present/absent” demo table as the real data model.

## Reliability Rules

Before production-like deployment:

- Build must pass.
- Database migration must be applied in staging/test first.
- Backup must exist before production migration.
- Health checks must be available.
- Rollback step must be documented.
- Logs must be reviewable.
- Punch endpoint must be tested under repeated submissions.

## Keeping Docs in Sync

Update the relevant context file whenever implementation changes:

- Product scope
- Architecture
- Storage model
- Attendance rules
- Permissions
- UI conventions
- Code standards
- Deployment process

Always update `context/progress-tracker.md` after meaningful implementation.

## Before Moving to the Next Unit

1. Current unit works within its defined scope.
2. No invariant in `architecture.md` was violated.
3. Tests/build/typecheck were run where applicable.
4. `progress-tracker.md` reflects completed work.
5. Open questions are documented.
6. Any risky assumptions are clearly marked.

## Required Completion Report Format

After every feature unit, report:

```txt
Unit:
Status:
Files changed:
What was implemented:
What was not implemented:
Verification:
Risks:
Next suggested unit:
Context files updated:
```

## Bug Handling Rule

When a bug appears:

1. Reproduce it.
2. Identify affected boundary.
3. Fix root cause.
4. Add/adjust test if possible.
5. Verify no regression.
6. Update progress notes if meaningful.

Do not hide bugs with UI-only workarounds.

## Performance Rule

If a feature touches attendance punch-in/out:

- Keep request path minimal.
- Save raw punch fast.
- Avoid heavy joins where possible.
- Defer recalculation/reporting/notification if needed.
- Add indexes before production scale.
- Make duplicate submission safe.
