import type { SupabaseClient } from '@supabase/supabase-js';

import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { forgetCachedMediaPath } from '@/lib/media/storage-cache-key';

export type Profile = {
  appearance: 'dark' | 'light' | null;
  avatarPath: string | null;
  avatarUrl: string | null;
  dateFormat: 'dmy' | 'mdy' | 'ymd' | null;
  displayName: string | null;
  distanceUnit: 'km' | 'mi' | null;
  homeCurrencyCode: string | null;
  homeLocation: string | null;
  id: string;
  temperatureUnit: 'celsius' | 'fahrenheit' | null;
  timeFormat: '12h' | '24h' | null;
};

export type ProfileUpdate = Partial<Omit<Profile, 'avatarUrl' | 'id'>>;

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

async function getAuthContext() {
  const supabase = createBrowserSupabaseClient();

  if (!supabase) {
    throw new Error('supabase_not_configured');
  }

  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    throw new Error('not_authenticated');
  }

  return { accessToken: data.session.access_token, supabase, userId: data.session.user.id };
}

async function profileRequest(path: string, init?: RequestInit) {
  const { accessToken } = await getAuthContext();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`profile_request_failed_${response.status}`);
  }

  return response.json() as Promise<{ profile: Profile }>;
}

export async function fetchProfile() {
  return profileRequest('/profile/me');
}

export async function saveProfile(changes: ProfileUpdate) {
  return profileRequest('/profile/me', {
    body: JSON.stringify(changes),
    method: 'PATCH',
  });
}

export async function uploadProfilePhoto(file: File) {
  const { supabase, userId } = await getAuthContext();
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

  if (!allowedTypes.has(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('invalid_profile_photo');
  }

  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.slice('image/'.length);
  const path = `${userId}/avatar-${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('profile-photos').upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw new Error('profile_photo_upload_failed');
  }

  return { path, supabase };
}

export async function removeProfilePhoto(supabase: SupabaseClient, path: string) {
  await supabase.storage.from('profile-photos').remove([path]);
  await forgetCachedMediaPath('profile-photos', path);
}
