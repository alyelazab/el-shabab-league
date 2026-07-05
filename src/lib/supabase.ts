import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  // Surfaced early rather than as a cryptic network error later.
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const JOIN_CODE = (import.meta.env.VITE_JOIN_CODE as string) ?? '';
export const ADMIN_EMAIL = ((import.meta.env.VITE_ADMIN_EMAIL as string) ?? '').toLowerCase();
