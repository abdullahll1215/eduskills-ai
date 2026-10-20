# Independent student exploration

Students can explore the system without entering a course code or joining a team. Personal self-assessments are private, editable, and stored independently of academic milestone assessments. They do not generate a fabricated 360° report or satisfy the academic self-assessment requirement.

Peer evaluations are restricted by the API to students who currently share a team in an active course. A shared course alone is insufficient. An explicit milestone must also belong to that shared-team course. Code matching remains mandatory only when submitting the optional team creation/join form.

Registered students can search published profiles across teams. Non-teammates receive released aggregate peer scores only; written comments and instructor notes stay limited to shared-team courses. The minimum reviewer release threshold still applies. Personal self-assessments and reviewer identities are never included in public profiles. Administrators can disable profile search through `public_feedback_profiles`.

## Deployment order

This change is delivered on GitHub. No database migration or production deployment was performed as part of this change. The separately requested demo instructor was created and its staff login and lack of admin access were verified; credentials remain in a local ignored file.

1. Verify the target project and take a recoverable backup.
2. Coordinate the API deployment with migration `eduskills_0005`. **The previous API version checks for its exact Alembic head and will reject a newer database revision on cold start. Do not apply this migration to the shared production database while leaving the old API running.** Use a maintenance window or an isolated preview database to validate deployment first.
3. Apply either `backend/migrations/versions/eduskills_0005_personal_self_assessment.py` using Alembic, or the equivalent Supabase SQL migration, **not both**. The migration creates one private table and enables published score profiles as requested. It preserves users, course membership, and existing evaluations. RLS denies browser roles direct access to the new table; only the restricted backend role receives DML access.
4. Deploy the matching API/frontend and verify `/api/health`, a fresh student without enrollment, personal save/reload, optional invalid/valid code handling, teammate evaluation, cross-team rejection, and public score-only profiles. The new API requires Alembic revision `eduskills_0005`.

## Validation

- Regression cases cover independent personal save/edit, privacy between owners, invalid/incomplete ratings, failed optional course join without losing access, cross-team submission rejection (including explicit milestones), and released public summaries with private comments withheld.
- The PostgreSQL harness runs the full suite, migrations/replay, restricted-role checks, and concurrent startup against disposable local databases. It does not point tests at Supabase production.
- Frontend verification uses a real browser against the locally built application, including a new account with no course membership.

Verified in this change: PostgreSQL **75 passed**, SQLite **74 passed / 1 PostgreSQL-only test skipped**, Ruff passed, and `npm run build` passed. The equivalent Supabase SQL upgrade from revision 0004 to 0005 was also executed against disposable PostgreSQL: the revision, profile setting, RLS, denied browser privileges, and restricted backend access were checked. Existing Starlette test-client and React Router future-version warnings remain; they did not fail verification.

Browser evidence: a student registered without a team, reached the exploration dashboard, saved all five personal skill ratings, and reloaded the page with the saved values intact. A non-teammate search result opens a read-only profile rather than the evaluation form.
