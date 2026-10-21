# Course onboarding and instructor assignment

This change builds on main `c3eaa49`, including the showcase course, existing-instructor ownership, and restored ivory/dark-green theme. It keeps the current assessment and report rules. It requires no database migration, environment variable, package dependency, production data reset, or demo-account reset.

## Behavior

- A student may still create a new course and team. The UI first reads a course preview, then asks for confirmation when the number is new. Cancel and Escape do not create records.
- `POST /api/student/team/create` now requires `confirm_new_course: true` only when the course does not exist. Without confirmation it returns 409. Creating a team in an existing course is unchanged. Existing clients that silently created unknown courses will receive this intentional confirmation error; deploy the frontend and backend together.
- `GET /api/student/team/course-preview?code=...` is student-authenticated and read-only. It normalizes and validates the number and reports whether a course exists, its active state and supervisor.
- Student team responses add the course number and instructor. The interface distinguishes pending supervision from an assigned instructor and explains the academic report prerequisites without blocking personal exploration.
- `PUT /api/projects/{id}/instructor` is admin-only and accepts an active instructor account. It changes the supervisor without replacing milestones, teams, memberships or assessments, and records an audit event. The same role/active-account validation applies to changed assignments through the existing management endpoints; an unchanged legacy admin owner is preserved when editing other course fields.
- Readable invite codes are accepted up to the existing database limit of 60 characters. Previously the join API and input stopped at 20 characters even when creation produced a longer valid code.
- The Personal assessment link uses `?context=personal`, and the assessment context survives reloads and milestone URL updates.
- The in-browser demo API mirrors the new preview, confirmation and assignment routes. Generated standalone demo files are not regenerated in this PR; build:demo was verified locally.

## Visual scope

The academic workspace, joining/creation forms, course confirmation dialog, supervision state, and project portfolio headings use the established palette, typography and shared controls. English and Arabic copy is supplied. The native confirmation dialog contains keyboard focus and supports Escape cancellation. Motion honors the existing reduced-motion rule. No unrelated global redesign or routing replacement is included.

Multiple-course academic navigation remains outside this change: the existing student assessment hook still defaults to the first course. The UI does not advertise adding another course to an already-enrolled student. Existing memberships can still be displayed with their own supervision states.

## Validation

- Baseline before changes: 78 SQLite tests passed, one PostgreSQL-only test skipped; production frontend build passed.
- Updated full PostgreSQL suite: 87 passed; initial SQL protection, migration replay and concurrent startup checks passed on disposable databases. An existing Starlette/httpx deprecation warning remains.
- Ruff static checks and TypeScript/Vite production build passed.
- Standalone demo build passed, with its existing large-single-bundle warning.
- Real local browser flow: preview and cancellation write nothing; confirmed creation persists; pending supervision is visible; admin assignment preserves team/milestone data; assigned course appears to its instructor; another student can join by invite code; personal assessment remains independent; Arabic mobile view has no document overflow in the checked view; no page errors in the checked scenario.
- A separate browser check verifies the personal-assessment link opens personal mode and preserves it after reload.

Local evidence is in `.artifacts/course-experience/` (ignored). All browser accounts and writes are against disposable local demonstration data. These checks do not certify a production deployment or a full security audit.

## Integration

Apply this PR on top of current main. Deploy its frontend and backend in the same release. Review the diff against main, not the older design branch. Existing migrations and stored assessments are retained. After a release, verify the new-course dialog and assignment with authorized test accounts; do not regenerate showcase data to validate this feature.
