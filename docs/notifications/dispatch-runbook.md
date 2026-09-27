# Background reminder dispatch

Trove keeps in-app reminders when Web Push is unavailable. Browser delivery
requires a supported browser or installed PWA, permission, an active account on
that device, connectivity, and a working one-minute dispatch job. Timing is best
effort. The dispatch reads only Trove's database and fresh permitted route-cache
evidence; it makes no provider requests.

## Rollout order

1. Apply the `20260927000000_add_web_push_delivery` database migration. Check
   `push_subscriptions` and `push_deliveries` are private and browser roles have
   no privileges. Do not use `prisma db push` against production.
2. Generate a VAPID key pair using the API workspace's `web-push` package.
   Set `TROVE_VAPID_PUBLIC_KEY`, `TROVE_VAPID_PRIVATE_KEY`, and a contact
   `TROVE_VAPID_SUBJECT` on **trove-api only**. Keep the pair stable across
   deployments; changing it invalidates existing browser subscriptions.
3. Set a long random `TROVE_NOTIFICATION_DISPATCH_SECRET` on **trove-api only**.
   Deploy API before web, then deploy web. Confirm the authenticated
   `/notifications/push-config` reports available and a device can register.
4. In the connected Supabase project, enable `pg_cron` and `pg_net` using the
   Dashboard extensions UI. Vault is already installed. Store the production
   API URL ending in `/maintenance/notification-dispatch` and the _same_ dispatch
   secret as Vault secrets named `trove_notification_dispatch_url` and
   `trove_notification_dispatch_secret`. This instance-specific setup is not a
   Prisma migration. Use the SQL Editor as an administrator:

   ```sql
   select vault.create_secret(
     'https://YOUR-API-DOMAIN/maintenance/notification-dispatch',
     'trove_notification_dispatch_url'
   );
   select vault.create_secret(
     'YOUR-DISPATCH-SECRET',
     'trove_notification_dispatch_secret'
   );

   select cron.schedule(
     'trove-notification-dispatch',
     '* * * * *',
     $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'trove_notification_dispatch_url'),
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'trove_notification_dispatch_secret')
       ),
       body := '{}'::jsonb,
       timeout_milliseconds := 10000
     );
     $$
   );
   ```

   If either Vault name exists already, update that secret instead of creating
   a duplicate. Never paste real secret values into a committed file or issue.

5. Verify `cron.job_run_details`, `net._http_response`, and API dispatch
   reports. The API reports candidate, accepted, attempted, retryable, pending,
   and oldest-pending-age counts without trip text or endpoints. A missing
   secret/key fails visibly. Test one disposable near-future event on a
   supported browser with Trove closed, then move/cancel it and verify no stale
   alert. An iOS/iPadOS check needs an installed Home Screen app.

The send claim is durable and at-most-once. A transport timeout is an attempted
delivery and will not be retried, avoiding duplicate lock-screen alerts. A
definite rate-limit response can retry while the event is still future. In-app
reminders stay available. Revoke the cron job with
`select cron.unschedule('trove-notification-dispatch');` before rotating the
dispatch secret; then update both Vault and API and restore the job.
