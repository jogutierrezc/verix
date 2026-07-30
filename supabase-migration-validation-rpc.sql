  -- ============================================
  -- VERIX - RPC pública para validación de certificados
  -- ============================================
  -- Ejecutar desde: Supabase Dashboard > SQL Editor
  -- ============================================

  -- ─────────────────────────────────────────────
  -- 1. CREAR LA FUNCIÓN RPC (SECURITY DEFINER)
  --    - Bypass RLS para usuarios anónimos (público)
  --    - Busca por: verification_code, code, consecutive_number
  -- ─────────────────────────────────────────────

  CREATE OR REPLACE FUNCTION public.get_certificate_for_validation(p_code TEXT)
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  BEGIN
    RETURN (
      SELECT jsonb_build_object(
        'id', cr.id,
        'code', cr.code,
        'status', cr.status,
        'created_at', cr.created_at,
        'reviewed_at', cr.reviewed_at,
        'verification_code', cr.verification_code,
        'consecutive_number', cr.consecutive_number,
        'type', cr.type,
        'batch_id', cr.batch_id,
        'batch_total', cr.batch_total,
        'rejection_reason', cr.rejection_reason,
        'revoke_reason', cr.revoke_reason,
        'revoked_at', cr.revoked_at,
        'reviewer_notes', cr.reviewer_notes,
        'certificate_url', cr.certificate_url,
        'data', cr.data,
        'template_id', cr.template_id,
        'user_id', cr.user_id,
        'reviewed_by', cr.reviewed_by,
        'user', jsonb_build_object(
          'first_name', u.first_name,
          'last_name', u.last_name,
          'document_id', u.document_id
        )
      )
      FROM public.certificate_requests cr
      LEFT JOIN public.users u ON u.id = cr.user_id
      WHERE cr.verification_code = p_code
        OR cr.code = p_code
        OR cr.consecutive_number = p_code
        OR u.document_id = p_code
        OR cr.data->>'documento_estudiante' = p_code
        OR cr.data->>'document_id' = p_code
        OR cr.data->>'documento' = p_code
      LIMIT 1
    );
  END;
  $$;

  -- ─────────────────────────────────────────────
  -- 2. PERMITIR EJECUCIÓN POR ANÓNIMOS Y AUTENTICADOS
  -- ─────────────────────────────────────────────

  GRANT EXECUTE ON FUNCTION public.get_certificate_for_validation TO anon, authenticated;

  -- ─────────────────────────────────────────────
  -- 3. (OPCIONAL) POLÍTICA RLS PARA LECTURA PÚBLICA
  --    Si prefieres no usar RPC, puedes agregar una política
  --    que permita SELECT anónimo SOLO sobre filas verificables
  -- ─────────────────────────────────────────────

  -- Policy alternativa (comentada): permite a anónimos leer
  -- certificados específicos por verification_code
  -- DROP POLICY IF EXISTS "Public can verify certificates" ON public.certificate_requests;
  -- CREATE POLICY "Public can verify certificates"
  -- ON public.certificate_requests
  -- FOR SELECT
  -- TO anon
  -- USING (verification_code IS NOT NULL);
