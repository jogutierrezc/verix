import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { supabase, getUserProfile } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

interface Profile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'ADMIN' | 'SIGNER' | 'APPLICANT';
  institution_id?: string;
  dependency_id?: string;
  signature_url?: string;
  status: string;
}

interface AuthContextType {
  user: Profile | null;
  supabaseUser: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const profile = await getUserProfile(userId);
      setUser(profile);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setSupabaseUser(session.user);
        fetchProfile(session.user.id);
      }
      setIsLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setSupabaseUser(session.user);
          if (event === 'SIGNED_IN') {
            await fetchProfile(session.user.id);
          }
        } else {
          setSupabaseUser(null);
          setUser(null);
        }
        setIsLoading(false);
      },
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    console.log('🔐 [LOGIN] Attempting login for:', email);
    try {
      console.log('🔐 [LOGIN] Calling supabase.auth.signInWithPassword...');
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      console.log('🔐 [LOGIN] Response received', {
        hasData: !!data,
        hasUser: !!data?.user,
        hasSession: !!data?.session,
        error: error ? { message: error.message, status: error.status, name: error.name } : null,
      });

      if (error) {
        console.error('🔐 [LOGIN] Supabase Auth error details:', {
          message: error.message,
          status: error.status,
          name: error.name,
          code: (error as any)?.code,
          stack: error.stack,
        });
        throw error;
      }

      if (data.user) {
        console.log('🔐 [LOGIN] User authenticated, fetching profile...', data.user.id);
        setSupabaseUser(data.user);
        await fetchProfile(data.user.id);
        console.log('🔐 [LOGIN] Profile loaded successfully');
      }
    } catch (error: any) {
      console.error('🔐 [LOGIN] FALLÓ - Error completo:', {
        message: error?.message,
        status: error?.status,
        name: error?.name,
        code: error?.code,
        stack: error?.stack,
        supabaseError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      });
      throw error;
    } finally {
      setIsLoading(false);
      console.log('🔐 [LOGIN] Finished (success or fail)');
    }
  };

  const signUp = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
          },
        },
      });

      if (error) throw error;

      // El perfil en public.users se crea AUTOMÁTICAMENTE
      // mediante el trigger handle_new_user() en la base de datos.
      // No es necesario insertar manualmente aquí.
    } catch (error: any) {
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setSupabaseUser(null);
    } catch (error: any) {
      console.error('Logout error:', error);
    }
  };

  const refreshUser = async () => {
    if (supabaseUser) {
      await fetchProfile(supabaseUser.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, supabaseUser, isLoading, login, signUp, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
}
