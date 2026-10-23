# Security Standard

Practical, risk-based security requirements for every One Small project. Apply what fits the project: a static showcase site needs far less than an application holding personal or financial data. The `security-privacy-review` gate in [definition-of-done.md](definition-of-done.md) is satisfied by working through the applicable sections below and recording the result as evidence.

**Automated scanning is never enough on its own.** A clean `npm audit`, secret scan or CodeQL run is evidence for one part of a review, not proof of compliance or of the absence of vulnerabilities. Say what was checked and what was not.

## Severity and release blocking

| Severity | Examples | Release |
| --- | --- | --- |
| Critical | Live credential exposed; remote code execution; auth bypass; one user reading another's data; exploitable injection in production | **Blocks.** Fix before release. A live credential is revoked or rotated first. |
| High | Stored XSS; CSRF on a state-changing endpoint; missing authorization check; known-exploitable dependency on a reachable path; personal data publicly exposed | **Blocks** until remediated, or a documented exception approved by Joshua Small (below). |
| Medium | Missing rate limit on a form; verbose error leaking stack traces; outdated dependency with a non-reachable advisory; overly broad token scope | Does not block if tracked with an owner and a fix date. |
| Low | Missing security header on a static page; informational advisories | Track; fix opportunistically. |

Critical and high-severity **exploitable** findings block release. An exception needs a written justification, the compensating control, an expiry date, and Joshua Small's explicit approval recorded as evidence in the registry. An AI assistant cannot grant an exception.

## Requirements

### Repository visibility and public exposure
- Confirm each repository's visibility matches intent (most active projects are public). Anything public is assumed read by everyone, forever.
- Never commit `.env` files, database dumps, private notes, customer data or personal documents. Commit only `.env.example` with names, never values.

### Credentials and secret scanning
- Enable GitHub secret scanning and push protection where available.
- Scan the working tree before release and whenever a new contributor or AI tool starts work.
- **Full Git-history review:** before a first public release, scan the entire history (for example `gitleaks detect` or `trufflehog git`), not just the current tree.
- **An exposed live credential must be revoked or rotated first.** History rewriting is cleanup, not remediation: assume the secret was already copied. Rotate, confirm the old value no longer works, then decide whether cleanup is worth it.
- History rewrites are a separate, owner-approved task. Never rewrite another repository's history as a side effect of other work.

### Personal information
- Do not publish home address, phone number, full birth date, financial details or other people's personal data. Prefer contact forms over published email addresses where spam is a concern.
- Photos and media: strip location metadata (EXIF GPS) before publishing unless intended.

### Dependencies
- Commit a lockfile. Run `npm audit` (or equivalent) in CI or before release and record the result.
- Remove unused dependencies. Prefer fewer, well-maintained packages.
- Review new dependencies before adding them: maintenance, download base, install scripts, permissions.

### Environment variables
- Secrets live in the hosting provider's environment settings (Vercel, Render) or GitHub Actions secrets, never in code or client bundles.
- Only variables intended for the browser use a public prefix (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`). Review that list at release.
- Separate preview and production credentials where the provider allows.

### Least-privilege permissions
- Tokens, OAuth scopes and API keys get the smallest scope that works (for example Cortex's read-only Drive scope).
- Database users have only the rights the app needs. Service accounts are not personal accounts.

### GitHub Actions
- Set `permissions:` explicitly, defaulting to `contents: read`; grant write scopes per job only when needed.
- Pin third-party actions to a commit SHA. Use `persist-credentials: false` on checkout unless a job pushes.
- Never echo secrets; avoid `pull_request_target` with untrusted code; treat PR titles and bodies as untrusted input in scripts.

### Package supply chain
- Inspect the packed artifact (`npm pack --dry-run`) for secrets, tests, `.env` and stray files.
- Publish from CI with `npm publish --provenance` where possible; protect the npm account with 2FA and use granular, short-lived tokens.
- Prefer zero runtime dependencies for developer tools; verify signatures (`npm audit signatures`).
- A CDN is only introduced when it serves a specific purpose (versioned browser assets, public configuration files, documentation assets). An npm package alone does not need one.

### Authentication and authorization
- Hash passwords with a slow algorithm (bcrypt, argon2). Expire sessions and tokens; handle expiry visibly.
- Check authorization on the server for every request that reads or changes data, scoped to the owner.
- AI agents acting for a user get only the permissions that user granted and cannot approve their own actions.

### Injection
- Use parameterized queries or ORM APIs; never build queries, shell commands or file paths from unvalidated input.
- Validate request bodies against a schema at the boundary.

### XSS and CSRF (where applicable)
- Rely on framework escaping; review every raw-HTML path (`dangerouslySetInnerHTML`, `set:html`, `innerHTML`). Sanitize rendered Markdown or user content.
- Add a Content Security Policy where practical. State-changing endpoints using cookies need CSRF protection or `SameSite` cookies plus origin checks.

### Rate limiting and abuse prevention
- Public forms and auth endpoints have rate limits and basic bot protection (honeypot, captcha or provider firewall). This applies to the Studio contact form and any login.

### File uploads and path handling
- Validate type and size server-side, store outside the web root or in object storage with generated names, and never trust client file names or paths.

### Data retention and privacy
- Record what personal data each project collects, where it is stored and for how long. Delete what is no longer needed (for example old contact-form submissions).
- Analytics: use privacy-respecting defaults and disclose them.

### Logging and error handling
- Log security-relevant events (sign-in failures, permission denials, approvals) without secrets, tokens or full personal data.
- Users see generic errors; stack traces stay in server logs.

### Third-party scripts and services
- Inventory third-party scripts (analytics, embeds such as SoundCloud) and keep them to what the page needs. Prefer self-hosted fonts and assets.

### Vulnerability remediation
- Triage new advisories by severity and reachability. Critical: same day where possible. High: before the next release. Record what was done.
- Post-release security fixes follow the maintenance path in [release.md](release.md#post-release-regressions).

### Credential rotation
- Rotate any credential that was exposed, shared with a tool that should not keep it, or belonged to someone who no longer needs it.
- Keep a private (not in this repository) list of which credentials each project uses so they can be rotated quickly.

## Recording a security review

Add an evidence record (type `audit` or `document`) that links the committed review notes or PR, names what was checked and with which tools and versions, lists findings with severity and status, and states what was **not** checked. Mark `security-privacy-review` `verified` only when no open critical or high findings remain (or an approved exception exists).
