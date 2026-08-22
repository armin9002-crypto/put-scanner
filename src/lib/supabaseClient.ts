import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
  isConfigured: boolean;
}

type PublicEnvironment = Record<string, string | boolean | undefined>;
type SupabaseClientFactory = typeof createClient;

function environmentString(value: string | boolean | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isAllowedPublicUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:'
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]');
  } catch {
    return false;
  }
}

export function resolveSupabasePublicConfig(environment: PublicEnvironment): SupabasePublicConfig {
  const url = environmentString(environment.VITE_SUPABASE_URL);
  const publishableKey = environmentString(environment.VITE_SUPABASE_PUBLISHABLE_KEY);
  return {
    url,
    publishableKey,
    isConfigured: isAllowedPublicUrl(url) && /^sb_publishable_[A-Za-z0-9._-]+$/.test(publishableKey),
  };
}

export function createConfiguredSupabaseClient(
  config: SupabasePublicConfig,
  factory: SupabaseClientFactory = createClient,
): SupabaseClient | null {
  if (!config.isConfigured) return null;
  return factory(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
}

// Select only the two production public values. Passing the whole Vite env
// object would serialize unrelated development-only flags into the bundle.
const viteEnvironment: PublicEnvironment = {
  VITE_SUPABASE_URL: (import.meta as ImportMeta & { env?: PublicEnvironment }).env?.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: (import.meta as ImportMeta & { env?: PublicEnvironment }).env?.VITE_SUPABASE_PUBLISHABLE_KEY,
};

export const supabasePublicConfig = resolveSupabasePublicConfig(viteEnvironment);
export const supabaseAuthClient = createConfiguredSupabaseClient(supabasePublicConfig);
