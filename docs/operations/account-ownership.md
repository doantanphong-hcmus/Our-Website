# Production account ownership

- Status: In progress
- Last verified: 2026-08-27
- Rule: the project owner must control every production account and recovery
  method; the technician must never be the sole owner.

## Account inventory

| Service | Project account/owner | Current evidence | MFA | Recovery |
|---|---|---|---|---|
| GitHub | `doantanphong-hcmus` | Repository remote is `doantanphong-hcmus/Our-Website` | Owner must verify | Owner must store recovery codes offline |
| Cloudflare | Not yet verified | No production account is connected to the repository | Pending | Pending |
| Google Cloud / Maps | Not yet verified | No project or billing account is connected to the repository | Pending | Pending |

Do not put account email addresses, recovery codes, passwords, API keys, or MFA
secrets in this file, Git, issue trackers, or chat.

## Required controls

For each service before it is used:

1. The project owner signs in with an account they control long-term.
2. Enable MFA with a passkey, security key, or authenticator app; SMS alone is
   not the preferred recovery method.
3. Generate recovery codes and store them offline in a location controlled by
   the project owner.
4. Invite the technician with the narrowest role needed instead of sharing the
   owner's password.
5. Record only the non-secret account handle or project ID in the inventory.
6. Remove stale sessions, unused access tokens, and former collaborators.

## Service checklist

### GitHub

- [x] Repository owner identified from the configured remote.
- [ ] Owner confirms the repository is private.
- [ ] Owner confirms MFA is enabled at https://github.com/settings/security.
- [ ] Owner confirms recovery codes are stored offline.
- [ ] Review repository collaborators and remove anyone not needed.

### Cloudflare

- [ ] Owner creates or selects the long-lived project account.
- [ ] Owner enables MFA in Cloudflare profile authentication settings.
- [ ] Owner stores recovery codes offline.
- [ ] Technician receives scoped access; no shared owner password.
- [ ] Confirm Workers Free is selected and no paid subscription is enabled.

### Google Cloud / Maps

- [ ] Owner creates or selects the long-lived Google account and Cloud project.
- [ ] Owner enables 2-Step Verification at https://myaccount.google.com/security.
- [ ] Owner stores backup codes offline.
- [ ] Technician receives a scoped IAM role; no shared owner password.
- [ ] Billing and hard API quotas remain blocked until P0.4/P0.5 approve them.

## Completion gate

P0.3 is complete only when every checkbox above is verified by the project
owner. Verification means recording the date and non-secret account/project ID
in this file; screenshots of security settings and recovery codes must not be
committed.
