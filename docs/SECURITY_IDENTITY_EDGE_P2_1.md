# P2.1 Identity & Edge Closure

## Privileged identity

Production privileged roles are SUPER_ADMIN and PAYROLL_CONTROLLER.

When SECURITY_PASSKEY_ENFORCEMENT=ENFORCE:
- A privileged user with no passkey may use password + TOTP only to bootstrap WebAuthn enrollment.
- All other privileged API access fails closed until enrollment is complete.
- After at least one active passkey exists, privileged login requires WebAuthn user verification and the session is marked PASSKEY_UV.
- TOTP is no longer a normal privileged login fallback after passkey enrollment.
- Controlled recovery requires password + active TOTP, revokes all passkeys and sessions, creates a HIGH fraud/security incident, and requires fresh passkey enrollment.

WebAuthn registration requests discoverable credentials with userVerification=required. Authentication verification also requires user verification.

## Canonical relying party

Canonical production origin: https://proqpay.msg-os.com
WebAuthn RP ID: proqpay.msg-os.com

The Pages hostname remains available only for low-risk health diagnostics. Browser reads are redirected to the canonical domain and noncanonical mutating requests are rejected.

## Cloudflare edge closure

The production deployment pipeline:
1. resolves the msg-os.com Cloudflare zone;
2. attaches proqpay.msg-os.com to the ProQPay Pages project;
3. ensures a proxied CNAME to proqpay-lite.pages.dev without overwriting conflicting DNS;
4. discovers the WAF managed rulesets available to the account/plan;
5. selects the Free Managed Ruleset for a Free zone, otherwise the broader Cloudflare Managed Ruleset when available;
6. verifies or creates an enabled zone-level execute rule scoped to the ProQPay hostname;
7. waits until the Pages custom domain is active;
8. preserves non-secret JSON evidence for 90 days.

The deployment fails closed if DNS, Pages custom domain, WAF configuration, or evidence verification cannot be completed.

## Recovery and operational notes

Passkey recovery is intentionally more visible than ordinary login because use of the recovery path weakens the phishing-resistant primary factor. Every recovery revokes active passkeys, revokes sessions, opens a HIGH security incident, and forces re-enrollment.

Production security monitoring uses the canonical hostname after P2.1.
