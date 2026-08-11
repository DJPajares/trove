# Supabase project setup

Run `profile-photos.sql` in the Supabase SQL editor before testing profile photo uploads. It creates the private `profile-photos` bucket and owner-scoped Storage policies. The bucket and policies are intentionally kept outside Prisma because Supabase owns the `storage` schema.
