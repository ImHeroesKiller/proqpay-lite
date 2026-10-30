# Employee directory & individual ESS passwords

Baseline: main `69b7e02f8bd1b05d1dba570c6f0b8ad30bd536ca`.

## Changes

- Removed the employee completeness KPI, quality filter, issue badges and NIK/BPJS completeness helper. Directory content now follows the identity, placement, bank and period-payroll detail already available. Existing stored employee data and backend validation of supplied values remain intact.
- Removed the bulk “Kelola akses ESS” component and header entry point. Existing credential API compatibility is retained; this UI only invokes the individual RESET operation.
- Added “Generate password ESS” with confirmation inside the employee profile. The existing backend upsert supports both first issuance and reset. A labelled, read-only text field displays the returned temporary password, with a copy button. The password remains only in drawer memory and is cleared when the profile closes. No old password is fetched, persisted in browser storage or added to employee-list responses.
- Replaced contract and completeness columns with Status ESS on desktop and mobile. ESS filters and summary use backend credential state: not issued, must change password, active, locked, inactive or unknown. A successful generate immediately updates the directory status.
- Preserved writer-only actions, inactive employee rejection, session revocation, mandatory password rotation, hashed storage and audit behavior.
- Scoped CSS fixes preserve the immutable legacy cascade. Account editing, unsaved-change confirmation, focus trapping and mobile scrolling remain functional.

## Verification

- 1,110 node tests passed, including real D1-mock credential lifecycle, initial issuance/reset, invalidation of the old password, session revocation, non-disclosure, role denial and inactive-account rejection.
- Typecheck and production build/CSS/CSP passed. Lint: 0 errors; existing warnings remain. Cloudflare preflight: 9/9 passed.
- Seven local browser tests passed: desktop/mobile generation, cancellation, API error/retry, clipboard copy, transient password lifetime, ESS filters/status updates, fresh backend state replacing optimistic state, inactive action, axe contrast, profile account editing, nested modal focus and existing support evidence.
- Dedicated preview CI repeats the role, accessibility and modal regression gates before deployment.

All screenshots use synthetic employees and a synthetic password. No production credentials were generated or reset during implementation.

| View | Desktop | Mobile |
| --- | --- | --- |
| Directory | [1440px](screenshots/directory-1440.webp) | [390px](screenshots/directory-390.webp) |
| Profile / generated password | [1440px](screenshots/detail-1440.webp) | [390px](screenshots/detail-390.webp) |
