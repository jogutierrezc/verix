import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '❌ Falta VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el archivo .env',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// ============================================
// Helpers tipados para operaciones comunes
// ============================================

// ============================================
// Configuración de Storage Buckets
// ============================================
export const STORAGE = {
  BUCKET: 'verix',
  PATHS: {
    /** Firmas manuscritas: signatures/{userId}/{file} */
    SIGNATURES: (userId: string) => `signatures/${userId}`,
    /** Firmas autorizadas: authorized-signatures/{sigId}/{file} */
    AUTHORIZED_SIGNATURES: (sigId: string) => `authorized-signatures/${sigId}`,
    /** Logos institucionales: templates/logos/{id}/{file} */
    TEMPLATE_LOGOS: (id: string) => `templates/logos/${id}`,
    /** Documentos PDF: documents/{id}/{file} */
    DOCUMENTS: (id?: string) => id ? `documents/${id}` : 'documents',
    /** Certificados emitidos: certificates/{id}/{file} */
    CERTIFICATES: (id?: string) => id ? `certificates/${id}` : 'certificates',
  },
  /** Límite: 50MB */
  MAX_FILE_SIZE: 50 * 1024 * 1024,
  /** Tipos MIME permitidos */
  ALLOWED_MIME_TYPES: ['image/png', 'image/jpeg', 'image/svg+xml', 'application/pdf'] as const,
} as const;

export type Tables = {
  audit_logs: any;
  users: any;
  sessions: any;
  institutions: any;
  dependencies: any;
  templates: any;
  consecutives: any;
  certificate_requests: any;
  parameters: any;
};

/**
 * Obtiene el usuario actual desde Supabase Auth
 */
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Obtiene el perfil completo del usuario desde la tabla users
 */
export async function getUserProfile(userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('*, institution:institutions(*), dependency:dependencies(*)')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}
