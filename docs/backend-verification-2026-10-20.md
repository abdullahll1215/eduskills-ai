# Backend verification — 20 October 2026

Repository: `abdullahll1215/eduskills-ai`; branch: `codex/backend-reliability-supabase`.
Upstream integration base: `385c2cc`; core implementation: `8a13819`; integration merge: `bf2945d`.

## Verified locally

| Check | Observed result |
| --- | --- |
| Python 3.12.14 / SQLite API and regression suite | 66 passed, 1 PostgreSQL-only test skipped |
| PostgreSQL 16.2 API and concurrency suite | 67 passed |
| Ruff (`app tests migrations tools`) | Passed |
| TypeScript + Vite production build | Passed |
| Private-schema bootstrap | 20 tables including Alembic revision; RLS on all tables |
| Database role boundaries | Browser roles cannot use application schema; backend role can read/write application data and cannot read unrelated public data |
| Migration replay | Existing users and unrelated public marker preserved |
| Concurrent cold initialization | Reference data created once, no demonstration users |
| Native PostgreSQL backup and restore | Actual `pg_dump` → `pg_restore`; all row counts/content checksums matched; nonempty restore target refused; archive mode 0600 |
| Local browser smoke check | Sign-in page rendered; student registration has no team self-assignment; administrator login, live health dashboard and updated backup page rendered |

One upstream test-client deprecation warning remains (`Starlette` / `httpx`); it is not an API-test failure. Tests use deterministic AI fallback. A real Gemini response and hosted production journey were not tested.

## Reproduced defects covered by regressions

- Adding/deleting/editing assessment inputs cannot leave a stale report available through student, instructor, cohort, advisor or export readers.
- Report generation and source updates serialize per student/milestone. Scoring/rubric/resource updates cannot interleave with report computation on PostgreSQL.
- Hidden strengths do not create blind-spot interventions. Configured scoring weights are reflected in reports, prompts and coach explanations.
- Feedback profiles default to disabled; enabled profiles require shared active teams and return only authorized courses. Registration cannot self-assign team membership. Course membership gates peer assessment.
- Insufficient peer counts do not expose provisional peer averages. Progress counts cannot exceed 100% because of unrelated evaluations.
- Invalid numeric/boolean settings, nonfinite values and Unicode numeric edge cases return validation errors without partial settings writes.
- Production refuses ephemeral SQLite, default secrets and demonstration seeding; versioned migrations replace runtime schema patching, and health checks query the database.
- PostgreSQL JSON exports no longer claim restore verification. Exports contain application tables only, from a consistent snapshot.

An independent code review identified five additional defects: cross-course feedback disclosure, global-setting/report race, stale cohort team summary, concurrent reference-data initialization, and Unicode numeric validation. Each was fixed and regression-covered before the final runs above.

## Hosted integration still pending

The intended Supabase project is `kfu-soft-skills-ms3` (`hjipoywmuczrfdcvbwmn`). Earlier inspection found 19 legacy tables in `public` and no `eduskills` schema. The proposed migration keeps those legacy tables and creates the current FastAPI application's separate private schema.

At the latest connection check, OAuth exposed only `knf7's Project` in another organization; fetching the intended project returned a permission error. **No new schema migration or role credentials have been applied to either remote project.** The migration is prepared and tested locally, but remote schema verification, Supabase advisors, runtime credentials, deployed environment settings and a hosted acceptance journey remain pending correct-organization access.

The GitHub Actions workflow is supplied; local passing checks do not establish a remote CI result. A durable hosted backup destination also remains an operational deployment requirement.

The requirements Excel workbook is not available in the current checkout. This record does not certify full Excel compliance, change N/O scoring rules, or certify the entire graduation-project delivery.

See [deployment instructions](backend-deployment.md) for exact environment settings, migration boundaries, role provisioning and reproducible verification commands.
