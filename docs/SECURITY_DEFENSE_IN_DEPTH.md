# P2 Security Hardening & Defense-in-Depth

## Browser and edge-facing controls
- Production static responses enforce Content-Security-Policy with same-origin defaults, blocked objects and framing, restricted forms, and HTTPS upgrade.
- COOP/CORP and legacy cross-domain policy headers reduce cross-origin abuse.
- Production uptime monitoring verifies the deployed headers, not only repository configuration.

## API abuse resistance
- Native Cloudflare rate limiting remains preferred when the binding is available.
- A D1 fixed-window limiter is an enforced fallback so missing edge bindings do not silently disable throttling.
- Login is limited more aggressively than general authenticated APIs.
- Rate-limit identifiers are protected hashes; raw email/IP values are not used as database keys.

## Session anomaly controls
- Sessions retain initial and current hashed network/device fingerprints.
- Network changes create security incidents and update the current network fingerprint.
- Device fingerprint changes create higher-severity incidents.
- SUPER_ADMIN and PAYROLL_CONTROLLER sessions are revoked on device-fingerprint change and require fresh authentication/MFA.

## Tamper-evident audit evidence
- Daily SHA-256 checkpoints seal the previous UTC day of application audit logs.
- Existing checkpoints in the rolling verification window are recomputed; any mismatch fails the workflow and opens a security incident.
- Evidence artifacts contain only hashes/counts/timestamps and are retained outside D1 for 90 days. Raw audit records are not uploaded as artifacts.
- Checkpoints complement, and do not replace, the daily D1 backup/restore drill.

## Identity assurance
- Privileged production roles require TOTP MFA plus session device binding and step-up MFA for critical payment actions.
- Cloudflare Access JWT authentication remains supported as an alternative deployment mode for organizations that require identity-provider controls.
- Application-native passkeys/WebAuthn are not claimed as implemented in this phase; they should only be marked complete after end-to-end registration, authentication, recovery, and production rollout evidence exists.

## Residual edge configuration
Repository controls cannot prove account-level Cloudflare Managed WAF rules for the default Pages domain. Where a custom zone/domain is used, managed WAF/bot rules and zone-level rate limiting should be enabled and evidenced separately rather than inferred from application code.
