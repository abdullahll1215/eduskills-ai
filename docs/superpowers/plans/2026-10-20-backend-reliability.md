# Backend reliability and Supabase implementation plan

**Goal:** Correct verified backend defects and provision/verify its database on Supabase without touching the old public schema.
**Architecture:** Preserve FastAPI, SQLAlchemy and current frontend contracts; use input-fingerprinted current reports and a private Supabase PostgreSQL schema.
**Spec:** docs/superpowers/specs/2026-10-20-backend-reliability-design.md
**Base:** a6de9c5

## Constraints
- No public-schema replacement, data deletion, fabricated acceptance, or credential exposure.
- Preserve current stages API and cross-team evaluation within an assigned course.
- Authorization to execute comes from the user's explicit request following the audited findings; continue through routine repairs.

## Review focus
- A changed/deleted input must never leave an old report presented as current.
- A newly registered account must not gain academic data access by choosing a team ID.
- Zero, NaN, infinity and malformed setting values must fail atomically.
- Underestimation must not produce a critical-blind-spot intervention.
- A database outage must fail readiness; migration replay must preserve data and role isolation.

### Task 1: Report integrity
- [x] Add isolated database fixtures and failing tests for fourth peer, deleted inputs and stale exports.
- [x] Fingerprint report inputs and guard readers; refresh changed sources and serialize PostgreSQL writes.
- [ ] Run targeted tests and full suite; commit evidence.

### Task 2: Privacy and validation
- [x] Add failing tests for no-membership access, self-assigned team, invalid settings and hidden-strength alerts.
- [x] Enforce staff membership, shared-team opt-in feedback, shared-course peer access, finite settings and directional interventions.
- [ ] Adapt affected UI/test expectations explicitly; run full suite and frontend build.

### Task 3: Database lifecycle
- [x] Add failing configuration/readiness tests and versioned Alembic baseline.
- [x] Fail closed in production, remove runtime schema patching and silent init errors, support private schema and least-privilege connections.
- [ ] Apply and verify fresh/replayed migrations, legacy-schema preservation and a connected PostgreSQL API flow.

### Task 4: Recovery and delivery
- [x] Correct backup verification claims and test the restore path.
- [ ] Run regressions and independent review; address material findings with tests.
- [ ] Commit/push a reviewable branch and draft PR; report precise deployment status and remaining external blockers.
