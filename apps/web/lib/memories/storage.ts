import type { SupabaseClient } from '@supabase/supabase-js';

export const MEMORY_PHOTOS_BUCKET = 'memory-photos';

export const allowedMemoryPhotoTypes = new Set([
  'image/heic',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const maxMemoryPhotoSize = 15 * 1024 * 1024;

export function isAllowedMemoryPhoto(contentType: string, sizeBytes: number) {
  return allowedMemoryPhotoTypes.has(contentType) && sizeBytes <= maxMemoryPhotoSize;
}

/**
 * The stored object path is decided when the traveller captures the photo, not
 * when it uploads. A queued photo therefore keeps the same destination across
 * retries, which is what lets an interrupted upload repeat safely and lets the
 * server recognise a photo it has already registered.
 */
export function memoryPhotoPath(
  userId: string,
  tripId: string,
  memoryId: string,
  photoId: string,
  fileName: string,
) {
  const extension =
    fileName
      .split('.')
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'jpg';
  return `${userId}/${tripId}/${memoryId}/${photoId}.${extension}`;
}

/**
 * Overwrites rather than rejects an existing object so a partially uploaded photo
 * can be sent again without leaving a half-written file behind.
 */
export async function uploadMemoryPhotoObject(
  supabase: SupabaseClient,
  path: string,
  body: Blob,
  contentType: string,
) {
  const { error } = await supabase.storage.from(MEMORY_PHOTOS_BUCKET).upload(path, body, {
    cacheControl: '3600',
    contentType,
    upsert: true,
  });
  return !error;
}

export async function removeMemoryPhotoObject(supabase: SupabaseClient, path: string) {
  await supabase.storage.from(MEMORY_PHOTOS_BUCKET).remove([path]);
}
