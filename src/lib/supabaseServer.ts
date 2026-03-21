import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export type SupabaseAdminResult =
  | { ok: true; supabase: SupabaseClient }
  | { ok: false; message: string }

/** Use in API routes so missing env vars return JSON instead of an empty 500 body. */
export function tryGetSupabaseAdmin(): SupabaseAdminResult {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url?.trim()) {
    return { ok: false, message: "Missing NEXT_PUBLIC_SUPABASE_URL in environment" }
  }
  if (!serviceRoleKey?.trim()) {
    return { ok: false, message: "Missing SUPABASE_SERVICE_ROLE_KEY in environment" }
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })

  return { ok: true, supabase }
}

/** Throws if env is missing — prefer tryGetSupabaseAdmin in route handlers. */
export function getSupabaseAdmin(): SupabaseClient {
  const r = tryGetSupabaseAdmin()
  if (!r.ok) {
    throw new Error(r.message)
  }
  return r.supabase
}

