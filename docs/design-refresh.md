# EduSkills visual refresh

The interface uses an academic notebook direction: soft lavender-white surfaces, deep purple navigation with a violet accent (the team chose purple over the original dark green), restrained typography, section rules and numbered task paths. Custom vector artwork illustrates the actual assessment sources (self, peers, instructor), rather than displaying fictional scores. Brand geometry is shared between the sidebar, authentication screens and favicon.

## Scope

- Shared theme tokens, buttons, form controls, page headings, empty states, tables, KPI panels and chart series.
- Authentication composition and portal choices, retaining the existing student/staff login and registration handlers.
- Student workspace with a primary personal assessment action, secondary exploration paths and optional course membership.
- Skill rating rows, consistent score labels, Arabic translations for the built-in rubric descriptors, larger pointer targets and RTL scale direction.
- Responsive navigation, keyboard focus containment/restoration in the mobile drawer, Escape dismissal, skip-to-content and reduced-motion support.

The established Inter / IBM Plex Sans Arabic fonts remain in use. No new dependency, API change, database migration or production deployment is introduced by the visual refresh.

## Verification

- `npm run build` passes (TypeScript and Vite).
- Real-browser inspection of English and Arabic sign-in, the student workspace, the self-assessment form and the instructor console against disposable local demonstration data.
- A personal rating was edited with the keyboard in RTL, saved through the real local API and verified after a page reload.
- Responsive checks at 375, 390, 768 and 1440 pixels; no document-level horizontal overflow on the assessment view.
- Mobile navigation focus wrapping, Escape dismissal and focus restoration verified.
- Existing React Router future-version console warnings remain; no browser console errors appeared in these checks.

Local screenshots are in `.artifacts/design-refresh/` (ignored by Git). They use local sample accounts and are not evidence of a production deployment.

## Integration

This branch builds on `codex/student-independent-exploration` (`b2791e4`). Review only the visual changes against that branch, or include its functionality changes when integrating into main. The visual commit itself requires no schema changes. If the preceding functionality changes have not yet been deployed, their documented `eduskills_0005` migration and coordinated API deployment are still required.
