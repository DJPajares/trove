# Supabase project setup

Run the relevant setup scripts in the Supabase SQL editor before testing uploads:

- `profile-photos.sql` creates the private Profile photo bucket.
- `trip-covers.sql` creates the private trip cover bucket.

Both scripts add owner-scoped Storage policies. The buckets and policies stay outside Prisma because Supabase owns the `storage` schema.
