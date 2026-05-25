import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

// apiFetch — drop-in replacement for fetch() on all /.netlify/functions/* calls.
// Injects Authorization: Bearer <access_token> from the active Supabase session.
// When no session exists (before auth is enabled), makes the request unauthenticated.
export async function apiFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { ...(options.headers ?? {}) };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return fetch(url, { ...options, headers });
}
