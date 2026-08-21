import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  endAuthSession,
  requestMagicLink,
  restoreAuthSession,
  subscribeToAuthSession,
  type AuthOnlyClient,
} from './authActions';
import { supabaseAuthClient } from './supabaseClient';
import { AuthContext, type AuthContextValue } from './authContext';

export function AuthProvider({
  children,
  client = supabaseAuthClient,
}: {
  children: ReactNode;
  client?: AuthOnlyClient | null;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(client !== null);
  const [authError, setAuthError] = useState<string | null>(null);
  const isConfigured = client !== null;

  useEffect(() => {
    if (!client) {
      setIsAuthLoading(false);
      return undefined;
    }

    let active = true;
    const unsubscribe = subscribeToAuthSession(client, nextSession => {
      if (!active) return;
      setSession(nextSession);
      setIsAuthLoading(false);
      if (nextSession) setAuthError(null);
    });

    void restoreAuthSession(client).then(result => {
      if (!active) return;
      setSession(result.session);
      setAuthError(result.error);
      setIsAuthLoading(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  const signInWithEmail = useCallback(async (email: string) => {
    if (!client) return false;
    setAuthError(null);
    const result = await requestMagicLink(client, email, window.location.origin);
    setAuthError(result.error);
    return result.ok;
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return false;
    setAuthError(null);
    const result = await endAuthSession(client);
    setAuthError(result.error);
    if (result.ok) setSession(null);
    return result.ok;
  }, [client]);

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    session,
    isAuthLoading,
    isConfigured,
    authError,
    signInWithEmail,
    signOut,
  }), [authError, isAuthLoading, isConfigured, session, signInWithEmail, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
