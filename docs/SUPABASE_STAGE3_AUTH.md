# Stage 3A Supabase authentication foundation

Status: authentication identity only. No Put Scanner user-state synchronization exists in this stage.

## Architecture

`src/lib/supabaseClient.ts` is the only Supabase client initializer. It creates a browser client only when both public configuration values are present and valid. The client enables Supabase-managed session persistence, automatic refresh, and magic-link URL detection. If configuration is missing or malformed, no client is created, the Account control is hidden, and the local-first application renders normally.

`src/lib/authActions.ts` is an auth-only port. Its available operations are session restoration, auth-state subscription, `signInWithOtp`, and `signOut`; it exposes no database query method. `src/lib/auth.tsx` owns identity/session state, `src/lib/authContext.ts` exposes that state to account UI, and the provider renders its children without an authentication gate. Portfolio, Watchlist, Preferences, backup, and market-data modules do not import the auth layer.

The account control appears at the end of the desktop top bar and in the normal mobile contextual header beside the theme control. It is not a route or a sixth bottom-navigation item. The dedicated mobile Options workflow keeps its existing compact trading header; the account control remains available after returning to a normal app route.

## Public environment configuration

Only these two public browser values are used:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

For local development, copy `.env.example` to `.env.local` and fill in the Project URL and current Publishable key from Supabase Dashboard project settings. `.env.local` is covered by the repository's `*.local` ignore rule. Never commit the populated file.

For Vercel, add the same two names under Project Settings → Environment Variables for the intended environments, then redeploy. Do not add a database password, access token, secret key, or service-role key. The browser needs no secret value.

## Magic-link and session flow

The signed-out form calls `supabase.auth.signInWithOtp` with the entered email, `shouldCreateUser: true`, and the current application's origin as `emailRedirectTo`. A new email therefore creates an account automatically. Supabase must allow the redirect origin.

Configure Supabase Auth URL settings manually:

- Site URL: `https://put-scanner.vercel.app`
- Production redirect: `https://put-scanner.vercel.app/**`
- Local redirect: `http://localhost:5173/**`

Do not modify Dashboard Auth configuration programmatically. Supabase documents the redirect allow-list requirement in its [redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls) and the email flow in its [passwordless authentication guide](https://supabase.com/docs/guides/auth/auth-email-passwordless).

Supabase-js owns its auth-session storage, token refresh, and magic-link callback detection. Put Scanner does not copy, log, expose, or place access/refresh/magic-link tokens in its durable-state storage or diagnostics. The provider restores the session and listens for auth changes without delaying application rendering.

## Sign-out and failure behavior

Sign-out calls only `supabase.auth.signOut()`. It does not read, write, clear, migrate, or reset any Put Scanner localStorage key. Signing out does not delete cloud data. If Auth is unavailable, only the account surface reports the error; Scanner, Portfolio, Watchlist, ETF pages, Screener, ETF Pulse, backups, local data, and market requests continue independently.

## Explicit database boundary

Stage 3A makes zero calls to `public.user_state` or any Supabase database API. Signing in creates/restores an Auth session only. It does not inspect or upload Portfolio/history, Watchlist, or Preferences, and it does not create empty cloud namespace rows.

Future cloud synchronization must be introduced as a separate `src/lib/cloudState/` layer after a controlled migration design. That layer may consume authenticated identity from AuthContext, but database reads/writes, local/cloud inventory comparison, user consent, backups, and conflict handling must never be folded into the authentication provider.

## Email delivery before launch

Supabase's built-in email sender is suitable only for restricted development/testing. Before public passwordless authentication, configure and validate custom SMTP outside the codebase; do not commit SMTP credentials. See [Supabase custom SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp).
