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

Custom-domain closure is part of the production deployment:
1. resolve the msg-os.com Cloudflare zone;
2. attach proqpay.msg-os.com to the ProQPay Pages project;
3. verify the hostname is Cloudflare-proxied; use the DNS API when the deployment token has DNS access and otherwise require public Cloudflare proxy evidence;
4. wait until the Pages custom domain is active;
5. preserve non-secret JSON evidence for 90 days.

Managed WAF closure is intentionally a separate security gate because the deployment token follows least privilege and does not carry Zone WAF permissions. The `Security Edge WAF Closure` workflow requires `CLOUDFLARE_WAF_API_TOKEN` scoped to zone `msg-os.com` with:
- Zone Read
- Zone WAF Read
- Zone WAF Edit

The WAF gate discovers the managed rulesets available to the zone/plan, selects the compatible Cloudflare managed ruleset, verifies or creates an enabled `http_request_firewall_managed` execute rule scoped to `proqpay.msg-os.com`, and preserves evidence for 90 days.

Production application deployment fails closed on custom-domain evidence. WAF compliance remains separately fail-closed and cannot be marked complete until the dedicated WAF workflow passes.

## Recovery and operational notes

Passkey recovery is intentionally more visible than ordinary login because use of the recovery path weakens the phishing-resistant primary factor. Every recovery revokes active passkeys, revokes sessions, opens a HIGH security incident, and forces re-enrollment.

Production security monitoring uses the canonical hostname after P2.1.

## Current closure rule

P2.1 Identity and canonical-domain controls may be released when their production gates pass. Full P2.1 edge closure additionally requires a successful `Security Edge WAF Closure` run; a missing or under-scoped WAF token is an explicit open security action, not an accepted exception.
