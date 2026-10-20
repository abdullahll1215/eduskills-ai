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

## Verified against Supabase

The confirmed Supabase project is `kfu-soft-skills-ms3` (`hjipoywmuczrfdcvbwmn`). Before provisioning it had 19 legacy tables in `public` and no `eduskills` schema. The reviewed baseline was applied transactionally using authenticated Supabase CLI 2.121.0, then recorded in `supabase_migrations.schema_migrations` as `20261020144415`.

Post-application SQL confirmed 20 application tables, RLS on all 20, revision `eduskills_0002`, browser-role schema access denied and the original 19 public tables retained. A separate restricted `eduskills_app` login was provisioned. Its owner-only local environment file is Git-ignored; no credentials are committed. Production-mode FastAPI initialization connected with this role, created 5 reference competencies and 12 learning resources, and created **zero users**. A runtime write probe succeeded and was rolled back. The production-mode API's `/api/health` returned `200` and `{"status":"ok","app":"EduSkills AI"}` while connected to this remote database.

Supabase advisors reported zero notices for `eduskills`. Three warnings remain for the existing `public.kfu_assessment`, `public.kfu_context` and `public.kfu_results` RPC functions because authenticated users can execute `SECURITY DEFINER` functions. Their definitions explicitly enforce actor/project/result access through private helpers and use an empty search path; privileges were preserved to avoid breaking the older application. This inspection is not a full security certification of those legacy functions. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

The connector's OAuth grant still targets another organization, but the separately authorized official CLI reached and verified the correct project. No other Supabase project was modified.

## Delivery boundaries

Deployment environment settings and a hosted acceptance journey remain pending. The locally running production-mode API connected to Supabase is evidence of backend/database integration, not proof that the existing Vercel deployment uses the new branch or database. Existing application users/data have not been imported into the new schema. Encryption keys must be preserved when planning any such import.

The GitHub Actions workflow is supplied; local passing checks do not establish a remote CI result. A durable hosted backup destination also remains an operational deployment requirement.

The requirements Excel workbook is not available in the current checkout. This record does not certify full Excel compliance, change N/O scoring rules, or certify the entire graduation-project delivery.

See [deployment instructions](backend-deployment.md) for exact environment settings, migration boundaries, role provisioning and reproducible verification commands.
