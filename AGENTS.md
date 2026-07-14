# RECAFCO HRMS — Spec-Driven Coding Instructions

This project must be built using a spec-driven workflow. Before implementing, refactoring, or making any architectural decision, read the context files in this exact order:

1. `context/project-overview.md` — product definition, goals, modules, scope, and success criteria
2. `context/architecture.md` — stack, system boundaries, attendance engine, storage model, deployment, and invariants
3. `context/ui-context.md` — visual language, layout conventions, component rules, and accessibility expectations
4. `context/code-standards.md` — TypeScript, API, database, mobile, security, testing, and deployment rules
5. `context/ai-workflow-rules.md` — development workflow, scoping rules, anti-hallucination rules, and delivery approach
6. `context/progress-tracker.md` — current phase, completed work, next units, open questions, and architecture decisions

Update `context/progress-tracker.md` after each meaningful implementation change.

If implementation changes the architecture, feature scope, data model, security model, UI conventions, or coding standards documented in the context files, update the relevant context file before continuing.

## Mission

Build a fast, reliable, payroll-safe internal HRMS for RECAFCO with:

- Web application for HR, managers, management, and employee self-service
- Android and iOS mobile app for employees and managers
- Central attendance engine that accepts punches from mobile, office punching devices, biometric devices, manual corrections, and future integrations
- Strict anti-fraud controls for mobile attendance
- Payroll-safe attendance summaries, monthly closing, audit logs, and rollback-safe deployment

This is not a demo application. It is an enterprise internal system for a company with 2000+ employees.

## Non-Negotiable Principles

1. Attendance is payroll-critical and must be treated like a financial transaction.
2. Never calculate salary directly from raw punches.
3. Every punch attempt must be stored, including rejected and suspicious attempts.
4. Raw punch logs must be immutable except for controlled system metadata.
5. Payroll-locked attendance cannot be silently edited.
6. Manual corrections always require reason, approver, before/after values, and audit log.
7. Mobile punches must pass fraud and location validation before becoming official.
8. Device punches and mobile punches must flow into the same central attendance engine.
9. The system must be fast and reliable during peak punch times.
10. Build small, verifiable units. Do not implement broad speculative changes.

## Default Tech Stack

- Monorepo: pnpm workspace
- Web: Next.js + TypeScript
- Mobile: React Native + TypeScript
- Backend: NestJS + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Cache/Queue: Redis + BullMQ
- File Storage: MinIO / S3-compatible storage
- Reverse Proxy: Nginx or Caddy
- Deployment: Internal server, preferably Linux VM + Docker Compose; Windows + PM2 acceptable for early internal deployment if required
- Monitoring: Uptime Kuma first, then Prometheus + Grafana + Loki

## Safe Implementation Rule

Before modifying code:

1. Identify the feature unit.
2. Confirm which context file defines it.
3. If missing or ambiguous, update `progress-tracker.md` open questions first.
4. Implement the smallest end-to-end slice.
5. Add validation, tests, and audit logging where relevant.
6. Run build/typecheck/tests.
7. Update `progress-tracker.md`.

## Output Expectations for AI Coding Agents

When completing a unit, report:

- Files changed
- What was implemented
- What was not implemented
- How it was verified
- Any risks or follow-up tasks
- Whether context files were updated
