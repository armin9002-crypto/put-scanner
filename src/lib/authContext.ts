import { createContext, useContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isAuthLoading: boolean;
  isConfigured: boolean;
  authError: string | null;
  signInWithEmail: (email: string) => Promise<boolean>;
  signOut: () => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
