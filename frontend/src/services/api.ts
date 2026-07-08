import { supabase, STORAGE } from '../lib/supabase';

// ============================================
// VERIX - API Service
// Ahora usando Supabase directamente (sin backend local)
// ============================================

// --- Auth API (manejado por Supabase Auth) ---
export const authApi = {
  login: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  signUp: async (email: string, password: string, firstName: string, lastName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName, last_name: lastName } },
    });
    if (error) throw error;

    // El perfil en public.users se crea AUTOMÁTICAMENTE
    // mediante el trigger handle_new_user() en la BD.
    return data;
  },

  logout: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  getProfile: async (userId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('*, institution:institutions(*), dependency:dependencies(*)')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  },
};

// --- Users API ---
export const usersApi = {
  findAll: async (params?: { page?: number; limit?: number; search?: string }) => {
    let query = supabase
      .from('users')
      .select('*, institution:institutions(name), dependency:dependencies(name)', { count: 'exact' });

    if (params?.search) {
      query = query.or(
        `first_name.ilike.%${params.search}%,last_name.ilike.%${params.search}%,email.ilike.%${params.search}%`,
      );
    }

    const from = params?.page && params?.limit
      ? (params.page - 1) * params.limit
      : 0;
    const to = params?.page && params?.limit
      ? from + params.limit - 1
      : 49;

    const { data, error, count } = await query.range(from, to).order('created_at', { ascending: false });
    if (error) throw error;
    return { data, total: count || 0 };
  },

  findOne: async (id: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('*, institution:institutions(*), dependency:dependencies(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  create: async (userData: any) => {
    // Crear usuario via RPC (SECURITY DEFINER -> bypass RLS)
    const { data, error } = await supabase.rpc('admin_create_user', {
      p_email: userData.email,
      p_password: userData.password || 'temporal123',
      p_first_name: userData.first_name || 'Usuario',
      p_last_name: userData.last_name || '',
      p_role: userData.role || 'APPLICANT',
      p_institution_id: userData.institution_id || null,
      p_dependency_id: userData.dependency_id || null,
      p_document_id: userData.document_id || null,
      p_phone: userData.phone || null,
    });
    if (error) throw error;
    return data;
  },

  update: async (id: string, userData: any) => {
    const { data, error } = await supabase.from('users').update(userData).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  remove: async (id: string) => {
    // Eliminar usuario via RPC (SECURITY DEFINER -> bypass RLS)
    const { data, error } = await supabase.rpc('admin_delete_user', {
      p_user_id: id,
    });
    if (error) throw error;
    return data;
  },

  resetPassword: async (userId: string, newPassword: string) => {
    const { data, error } = await supabase.rpc('admin_reset_user_password', {
      p_user_id: userId,
      p_new_password: newPassword,
    });
    if (error) throw error;
    return data;
  },
};

// --- Institutions API ---
export const institutionsApi = {
  findAll: async (params?: { page?: number; limit?: number }) => {
    const from = params?.page && params?.limit ? (params.page - 1) * params.limit : 0;
    const to = params?.page && params?.limit ? from + params.limit - 1 : 49;

    const { data, error, count } = await supabase
      .from('institutions')
      .select('*', { count: 'exact' })
      .range(from, to)
      .order('name');

    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },

  findOne: async (id: string) => {
    const { data, error } = await supabase.from('institutions').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  create: async (data: any) => {
    const { data: result, error } = await supabase.from('institutions').insert(data).select().single();
    if (error) throw error;
    return result;
  },

  update: async (id: string, data: any) => {
    const { data: result, error } = await supabase.from('institutions').update(data).eq('id', id).select().single();
    if (error) throw error;
    return result;
  },

  remove: async (id: string) => {
    const { error } = await supabase.from('institutions').delete().eq('id', id);
    if (error) throw error;
  },

};

// --- Templates API ---
export const templatesApi = {
  findAll: async (params?: { page?: number; limit?: number; institutionId?: string }) => {
    let query = supabase.from('templates').select('*, institution:institutions(name)', { count: 'exact' });

    if (params?.institutionId) {
      query = query.eq('institution_id', params.institutionId);
    }

    const from = params?.page && params?.limit ? (params.page - 1) * params.limit : 0;
    const to = params?.page && params?.limit ? from + params.limit - 1 : 49;

    const { data, error, count } = await query.range(from, to).order('name');
    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },

  findOne: async (id: string) => {
    const { data, error } = await supabase.from('templates').select('*, institution:institutions(*)').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  create: async (data: any) => {
    const { data: result, error } = await supabase.from('templates').insert(data).select().single();
    if (error) throw error;
    return result;
  },

  update: async (id: string, data: any) => {
    const { data: result, error } = await supabase.from('templates').update(data).eq('id', id).select().single();
    if (error) throw error;
    return result;
  },

  remove: async (id: string) => {
    const { error } = await supabase.from('templates').delete().eq('id', id);
    if (error) throw error;
  },

  duplicate: async (id: string) => {
    // Load the original template
    const { data: original, error: fetchError } = await supabase
      .from('templates')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchError) throw fetchError;

    // Create a duplicate with a modified name and code
    const { data: result, error } = await supabase
      .from('templates')
      .insert({
        name: `${original.name} (copia)`,
        code: `${original.code}-copy`,
        category: original.category,
        orientation: original.orientation,
        config: original.config,
        variables: original.variables,
        institution_id: original.institution_id,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    return result;
  },
};

// --- Certificate Requests API ---
export const requestsApi = {
  findAll: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    userId?: string;
    reviewerId?: string;
  }) => {
    let query = supabase
      .from('certificate_requests')
      .select('*, user:users!certificate_requests_user_id_fkey(first_name, last_name, email), template:templates(name)', { count: 'exact' });

    if (params?.status) query = query.eq('status', params.status);
    if (params?.userId) query = query.eq('user_id', params.userId);
    if (params?.reviewerId) query = query.eq('reviewed_by', params.reviewerId);

    const from = params?.page && params?.limit ? (params.page - 1) * params.limit : 0;
    const to = params?.page && params?.limit ? from + params.limit - 1 : 49;

    const { data, error, count } = await query.range(from, to).order('created_at', { ascending: false });
    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },

  findOne: async (id: string) => {
    const { data, error } = await supabase
      .from('certificate_requests')
      .select('*, user:users!certificate_requests_user_id_fkey(*), template:templates(*), reviewer:users!certificate_requests_reviewed_by_fkey(first_name, last_name)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  create: async (data: any) => {
    const { data: result, error } = await supabase.from('certificate_requests').insert(data).select().single();
    if (error) throw error;
    return result;
  },

  createMassive: async (requests: any[]) => {
    const batchId = crypto.randomUUID();
    const dataWithBatch = requests.map((r) => ({ ...r, batch_id: batchId }));
    const { data, error } = await supabase.from('certificate_requests').insert(dataWithBatch).select();
    if (error) throw error;
    return { data, batchId };
  },

  update: async (id: string, data: any) => {
    const { data: result, error } = await supabase
      .from('certificate_requests')
      .update(data)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return result;
  },

  approve: async (id: string, notes?: string) => {
    const { data, error } = await supabase
      .from('certificate_requests')
      .update({
        status: 'APPROVED',
        reviewed_at: new Date().toISOString(),
        reviewer_notes: notes,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  reject: async (id: string, reason: string, notes?: string) => {
    const { data, error } = await supabase
      .from('certificate_requests')
      .update({
        status: 'REJECTED',
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
        reviewer_notes: notes,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  revoke: async (id: string, reason: string) => {
    const { data, error } = await supabase
      .from('certificate_requests')
      .update({
        status: 'REVOKED',
        revoked_at: new Date().toISOString(),
        revoke_reason: reason,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  download: async (id: string) => {
    const { data, error } = await supabase
      .from('certificate_requests')
      .select('certificate_url')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data?.certificate_url;
  },
};

/**
 * Obtiene la IP pública del cliente usando ipify.org
 * Fallback a '0.0.0.0' si hay error o timeout (3s)
 */
export async function getClientIP(): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return '0.0.0.0';
    const data = await response.json();
    return data.ip || '0.0.0.0';
  } catch {
    return '0.0.0.0';
  }
}

// --- Audit API ---
export const auditApi = {
  findAll: async (params?: {
    page?: number;
    limit?: number;
    module?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    let query = supabase.from('audit_logs').select('*', { count: 'exact' });

    if (params?.module) query = query.eq('module', params.module);
    if (params?.action) query = query.eq('action', params.action);
    if (params?.startDate) query = query.gte('created_at', params.startDate);
    if (params?.endDate) query = query.lte('created_at', params.endDate);

    const from = params?.page && params?.limit ? (params.page - 1) * params.limit : 0;
    const to = params?.page && params?.limit ? from + params.limit - 1 : 49;

    const { data, error, count } = await query.range(from, to).order('created_at', { ascending: false });
    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },

  log: async (entry: {
    user_id?: string;
    user_email?: string;
    user_name?: string;
    module: string;
    action: string;
    entity_id?: string;
    entity_type?: string;
    ip_address?: string;
    old_values?: any;
    new_values?: any;
    description?: string;
  }) => {
    const { error } = await supabase.from('audit_logs').insert({
      ...entry,
      old_values: entry.old_values ? JSON.stringify(entry.old_values) : null,
      new_values: entry.new_values ? JSON.stringify(entry.new_values) : null,
    });
    if (error) console.error('Audit log error:', error);
  },
};

// --- Dashboard API ---
export const dashboardApi = {
  getStats: async (userId?: string, role?: string) => {
    let query = supabase.from('certificate_requests').select('*', { count: 'exact', head: true });

    const totalQuery = await supabase.from('certificate_requests').select('*', { count: 'exact', head: true });
    const total = totalQuery.count || 0;

    const pendingQuery = await supabase
      .from('certificate_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'PENDING');
    const pending = pendingQuery.count || 0;

    const approvedQuery = await supabase
      .from('certificate_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'APPROVED');
    const approved = approvedQuery.count || 0;

    const rejectedQuery = await supabase
      .from('certificate_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'REJECTED');
    const rejected = rejectedQuery.count || 0;

    return { total, pending, approved, rejected };
  },
};

// --- Authorized Signatures API ---
export const authorizedSignaturesApi = {
  findAll: async (params?: { institutionId?: string; userId?: string }) => {
    let query = supabase
      .from('authorized_signatures')
      .select('*, user:users(first_name, last_name, email)', { count: 'exact' });

    if (params?.institutionId) query = query.eq('institution_id', params.institutionId);
    if (params?.userId) query = query.eq('user_id', params.userId);

    const { data, error, count } = await query.order('is_primary', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },

  findOne: async (id: string) => {
    const { data, error } = await supabase.from('authorized_signatures').select('*, user:users(first_name, last_name, email)').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  create: async (data: {
    user_id: string;
    institution_id: string;
    title: string;
    full_name: string;
    document_id?: string;
    signature_image_url?: string;
    is_primary?: boolean;
    is_active?: boolean;
  }) => {
    const { data: result, error } = await supabase.from('authorized_signatures').insert(data).select().single();
    if (error) throw error;
    return result;
  },

  update: async (id: string, data: any) => {
    const { data: result, error } = await supabase
      .from('authorized_signatures')
      .update(data)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return result;
  },

  remove: async (id: string) => {
    const { error } = await supabase.from('authorized_signatures').delete().eq('id', id);
    if (error) throw error;
  },

  promoteFromUser: async (userId: string) => {
    const { data, error } = await supabase.rpc('promote_user_signature_to_authorized', {
      p_user_id: userId,
    });
    if (error) throw error;
    return data;
  },

  getPrimary: async (userId: string) => {
    const { data, error } = await supabase.rpc('get_primary_signature', {
      p_user_id: userId,
    });
    if (error) throw error;
    return data;
  },

  uploadSignature: async (signatureId: string, file: File) => {
    const path = `${STORAGE.PATHS.AUTHORIZED_SIGNATURES(signatureId)}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE.BUCKET).upload(path, file);
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from(STORAGE.BUCKET).getPublicUrl(path);

    // Update the record with the new URL
    await authorizedSignaturesApi.update(signatureId, { signature_image_url: publicUrl });

    return { path, publicUrl };
  },
};

// --- User Certificates (P12/PFX) API ---
export const userCertificatesApi = {
  findByUser: async (userId: string) => {
    const { data, error } = await supabase
      .from('user_certificates')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  findAllByInstitution: async (institutionId: string) => {
    const { data, error } = await supabase
      .from('user_certificates')
      .select('*, user:users(first_name, last_name, email)')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  create: async (data: {
    user_id: string;
    institution_id: string;
    storage_path: string;
    original_filename: string;
    thumbprint?: string;
    issuer?: string;
    subject?: string;
    valid_from?: string;
    valid_to?: string;
    serial_number?: string;
  }) => {
    const { data: result, error } = await supabase.from('user_certificates').insert(data).select().single();
    if (error) throw error;
    return result;
  },

  update: async (id: string, data: any) => {
    const { data: result, error } = await supabase
      .from('user_certificates')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return result;
  },

  remove: async (id: string) => {
    const { error } = await supabase.from('user_certificates').delete().eq('id', id);
    if (error) throw error;
  },

  /** Sube el archivo .p12/.pfx a Storage y devuelve la ruta */
  uploadFile: async (userId: string, file: File) => {
    const path = `${STORAGE.PATHS.P12_CERTIFICATES(userId)}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE.BUCKET).upload(path, file);
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from(STORAGE.BUCKET).getPublicUrl(path);
    return { path, publicUrl };
  },

  /** Elimina un archivo de Storage */
  deleteFile: async (storagePath: string) => {
    const { error } = await supabase.storage.from(STORAGE.BUCKET).remove([storagePath]);
    if (error) throw error;
  },
};

// --- Upload API (Supabase Storage) ---
export const uploadApi = {
  upload: async (bucket: string, path: string, file: File) => {
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (error) throw error;

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
    return { path: data.path, publicUrl: urlData.publicUrl };
  },

  delete: async (bucket: string, path: string) => {
    const { error } = await supabase.storage.from(bucket ? bucket : STORAGE.BUCKET).remove([path]);
    if (error) throw error;
  },
};
