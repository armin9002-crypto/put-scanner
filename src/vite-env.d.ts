/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_CLOUD_MIGRATION_TEST_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
