import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { getMyProfile, type Profile } from './lib/db';

interface AuthValue {
  loading: boolean;
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  /** True when loading the profile threw (network/permission), as opposed to a genuinely-new user
   * (null profile, no error). Lets the app show a retry screen instead of bouncing to sign-up. */
  profileError: boolean;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState(false);

  async function loadProfile() {
    try {
      // getMyProfile() uses .maybeSingle(): a genuinely-new user returns null (no throw), while a real
      // fetch/permission error throws. Only the throw is an error — don't collapse it into "no profile"
      // (which App turns into the sign-up screen), or a stale cached client gets bounced to onboarding.
      setProfile(await getMyProfile());
      setProfileError(false);
    } catch {
      setProfileError(true);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadProfile();
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      if (s) await loadProfile();
      else {
        setProfile(null);
        setProfileError(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthValue = {
    loading,
    user: session?.user ?? null,
    session,
    profile,
    profileError,
    sendCode: async (email) => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
    },
    verifyCode: async (email, token) => {
      const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
    refreshProfile: loadProfile,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}
