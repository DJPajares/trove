# Email authentication rollout

Trove uses the shared Supabase Auth project `zqidfkofbzusvpikftdf`. The reviewed
app must be deployed before changing its email templates. These settings are
shared with other apps; capture the existing configuration for rollback and
smoke-test their explicit email redirect destinations before rollout.

## Redirect configuration

Set **Authentication → URL Configuration → Site URL** to
`https://trove.wndrhive.com`. This replaces the current `http://localhost:3000`
fallback, including for callers that do not specify a redirect. Other apps must
pass their own allowed redirect explicitly; check this before changing the
shared fallback. Preserve any existing redirect entries and append:

```text
https://trove.wndrhive.com/auth/confirm?**
https://trove.wndrhive.com/auth/callback?**
https://trove-djpajares-projects.vercel.app/auth/confirm?**
https://trove-djpajares-projects.vercel.app/auth/callback?**
https://trove-*-djpajares-projects.vercel.app/auth/confirm?**
https://trove-*-djpajares-projects.vercel.app/auth/callback?**
http://localhost:3000/auth/confirm?**
http://localhost:3000/auth/callback?**
http://127.0.0.1:3000/auth/confirm?**
http://127.0.0.1:3000/auth/callback?**
```

The callback query always includes `flow` and `next`; the SDK may also append
`sb_flow_id`. Supabase matches redirect queries as well as paths. Never broaden
the preview hostname to all Vercel apps. Vercel-protected previews require the
tester's normal deployment access; do not put protection bypass secrets in email
URLs or disable deployment protection.

The app uses its current browser origin for every email request. Do not force
preview/development to production with a public Site URL environment variable.
Local links require the local server on the device opening the email; use a
preview for tests across devices. Supabase's Site URL is the production fallback,
not an environment selector. See [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Resend and Cloudflare

1. Create or select the owner's Resend account and add sending domain
   `auth.wndrhive.com`. Account agreement and credential entry are performed by
   the owner. Keep open and click tracking disabled for this domain.
2. Add the exact domain-verification records provided by Resend in Cloudflare
   for `wndrhive.com`, including DKIM and SPF/return-path records. Use DNS-only
   records where applicable. Preserve the website CNAME and existing root mail
   records; do not replace a root SPF record or configure inbound receiving.
3. Wait until Resend reports the domain verified. Use sender
   `wndrhive <no-reply@auth.wndrhive.com>` because SMTP From applies to every app
   using this Auth project. Trove-specific branding lives in its template branch.
4. Create a sending-only Resend API key restricted to `auth.wndrhive.com`. Enter
   it directly into **Supabase Authentication → Email → SMTP Settings**:

   | Setting        | Value                        |
   | -------------- | ---------------------------- |
   | Custom SMTP    | Enabled                      |
   | Sender address | `no-reply@auth.wndrhive.com` |
   | Sender name    | `wndrhive`                   |
   | Host           | `smtp.resend.com`            |
   | Port           | `587` (STARTTLS)             |
   | Username       | `resend`                     |
   | Password       | Restricted Resend API key    |

Keep the key out of source control, chat, logs, Vercel/browser env variables, and
screenshots. Supabase sends the emails; Trove needs no Resend SDK or API key.
Retain current Auth password requirements, confirmation settings, OTP expiry
(currently 3600 seconds), and send-rate limits. See
[Resend SMTP](https://resend.com/docs/send-with-smtp) and
[Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Recovery signing key

Before deploying the recovery fix, configure `AUTH_RECOVERY_SECRET` on the
**Trove web** Vercel project (not trove-api). Use a Secret/sensitive variable with
separate random values for Production and Preview. For local development, keep a
separate value in the gitignored `apps/web/.env.local`. Generate each value with:

```sh
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))'
```

Enter the output directly into the environment-variable field, keep it out of
chat/source/screenshots, and redeploy the approved app after saving. This is an
internal signing key, separate from the Resend API key and Supabase keys.

Supabase's token-hash recovery verification returns `amr: otp`, not `recovery`.
After successful provider verification, Trove signs a one-hour HttpOnly,
SameSite=Strict, host-only receipt bound to the verified user and session. Server
pages and password updates verify its signature, expiry, and current Auth identity.
Ordinary OTP claims and URL hints alone cannot authorize recovery. The receipt is
cleared after a successful password change or a different confirmation sign-in.
Production uses a Secure `__Host-` cookie. Missing signing configuration fails
before consuming the one-use email link. Key rotation invalidates outstanding
receipts; request a fresh recovery email afterward. Retain the key across normal
builds so refresh and redeploy do not interrupt an active reset.

Legacy PKCE callbacks with provider-signed recovery AMR retain their existing
validation. Legacy bearer fragments without that signed marker require a fresh
email; their unsigned `type=recovery` hint cannot prove the authentication method.

## Templates and release order

1. Merge the human-reviewed implementation PR and deploy the app through the
   approved release workflow. Confirm both callback pages and reset endpoints
   exist before updating templates.
2. Verify the DNS domain and SMTP settings, then update the redirect configuration.
3. Paste [confirmation.html](../../supabase/templates/en/confirmation.html) into
   **Confirm signup** and [recovery.html](../../supabase/templates/en/recovery.html)
   into **Reset password**. Retain the neutral existing subjects. The English
   templates are localization resources, separate from next-intl app messages.
4. Trove destinations use `.RedirectTo` plus `.TokenHash`. Production/local
   callback prefixes and the allowlisted Trove preview hostname select the Trove
   branch. Other destinations keep `.ConfirmationURL`. Preview classification
   relies on the project-specific allow list above; never allow unrelated
   `trove-*` hosts in this shared project. Do not classify requests by user metadata.
5. Loading Trove's link consumes nothing. An explicit button POST verifies the
   token and writes the SSR session. Recovery is authorized by successful recovery-hash verification and its signed
   receipt, or provider-signed recovery AMR for legacy PKCE; both require the
   matching user/session and a one-hour recovery window. Query `type`/`flow` alone
   grant nothing. Existing PKCE callbacks and fragments with signed recovery AMR
   remain supported. Previously consumed/expired links require a fresh email.
6. Keep `SIGN_UP_DISABLED` unchanged in production. Exercise signup in an
   approved test environment; existing-account recovery remains available while
   signup is closed.

## Acceptance checks

- Test local, preview and production requests. Inspect each received href's host,
  callback, encoded `next`, and token type. Opening an email in a fresh browser
  must work without the initiating browser's PKCE verifier for new template links.
- Confirm signup, complete required onboarding, and arrive at the original trip
  including its query/anchor. Do not repeat onboarding for complete profiles.
- Request a reset, open the email, tap Continue, and see the verified account email
  and password form. Refresh the form and complete the reset. Continue to the
  original destination with the current session retained.
- Confirm the old password fails, the new one works, and another browser's refresh
  session is revoked. Supabase password update performs revocation; already-issued
  access tokens can remain valid until their expiry.
- Test already-open browser/PWA and account switches with offline data. Confirm
  no other user's private data remains visible. PWA window reuse is progressive
  enhancement; platforms without link capture complete the flow in the browser.
- Test missing/duplicate/mixed parameters, invalid/expired/used links, offline and
  rate limits, ordinary signed-in access to reset, and another-tab account changes.
  None may mutate the wrong password or substitute an existing session for a failed link.
- Repeated GET/prefetch requests must not consume tokens. Tokens disappear from
  browser history after capture; auth responses are private/no-store/no-referrer
  and are excluded from service-worker caches. Never copy real email tokens into logs.
- Check Resend delivery/bounce results and Supabase Auth error events without
  recording credentials. Check each other app's confirmation and recovery flow.

If the deployment needs rollback, restore the captured templates, SMTP and redirect
settings together with the app version. Retain deployed callback compatibility
while outstanding valid email links still reference it.
