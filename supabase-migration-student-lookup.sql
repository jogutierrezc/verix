-- ============================================
-- VERIX - Consulta pública por identificación del estudiante
-- ============================================
-- Ejecutar en: Supabase Dashboard > SQL Editor
--
-- 1. search_certificates_by_document: devuelve TODOS los certificados vigentes o
--    revocados de un número de documento (antes un documento con varios
--    certificados devolvía uno solo, arbitrario).
-- 2. get_certificate_for_validation: misma firma que antes, pero con orden
--    determinista (código exacto primero, luego el más reciente).
--
-- Solo se exponen datos mínimos para identificar el certificado; el detalle y la
-- descarga siguen pasando por /validate/:codigo.
-- ============================================

CREATE OR REPLACE FUNCTION public.search_certificates_by_document(p_document TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc TEXT := regexp_replace(coalesce(p_document, ''), '[^0-9A-Za-z]', '', 'g');
BEGIN
  -- Evita barridos con valores cortos ("1", "12"...)
  IF length(v_doc) < 5 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(r) ORDER BY r.issued_at DESC)
    FROM (
      SELECT
        cr.verification_code,
        cr.code,
        cr.status,
        cr.consecutive_number,
        coalesce(cr.reviewed_at, cr.created_at) AS issued_at,
        nullif(trim(coalesce(cr.data->>'nombre_estudiante', cr.data->>'nombre', '')), '') AS holder_name,
        t.name AS template_name
      FROM public.certificate_requests cr
      LEFT JOIN public.templates t ON t.id = cr.template_id
      WHERE cr.status IN ('APPROVED', 'SIGNED', 'REVOKED')
        AND cr.verification_code IS NOT NULL
        AND v_doc IN (
          regexp_replace(coalesce(cr.data->>'documento_estudiante', ''), '[^0-9A-Za-z]', '', 'g'),
          regexp_replace(coalesce(cr.data->>'document_id', ''), '[^0-9A-Za-z]', '', 'g'),
          regexp_replace(coalesce(cr.data->>'documento', ''), '[^0-9A-Za-z]', '', 'g')
        )
      ORDER BY coalesce(cr.reviewed_at, cr.created_at) DESC
      LIMIT 25
    ) r
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_certificates_by_document(TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────
-- Orden determinista en la consulta por código
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_certificate_for_validation(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
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
    ORDER BY
      (cr.verification_code = p_code OR cr.code = p_code OR cr.consecutive_number = p_code) DESC,
      (cr.status IN ('APPROVED', 'SIGNED')) DESC,
      coalesce(cr.reviewed_at, cr.created_at) DESC
    LIMIT 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_certificate_for_validation(TEXT) TO anon, authenticated;
