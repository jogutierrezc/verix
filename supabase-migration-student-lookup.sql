-- ============================================
-- VERIX - Consulta pública por documento y por nombre del estudiante
-- ============================================
-- Ejecutar en: Supabase Dashboard > SQL Editor (se puede repetir sin error)
--
-- El Excel de una importación masiva se guarda en dos sitios:
--   data           → solo las columnas mapeadas a campos de la plantilla
--   original_data  → la fila completa tal como venía en el Excel
-- Si la columna "documento" no se mapeó a un campo, solo existe en original_data.
-- Estas funciones buscan en AMBOS, con cualquier nombre de columna, ignorando
-- puntos, espacios y guiones en los documentos y tildes en los nombres.
-- ============================================

-- Valores (sin puntos/espacios) de todos los campos de la solicitud
CREATE OR REPLACE FUNCTION public.verix_doc_values(d JSONB, o JSONB)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(array_agg(regexp_replace(kv.value, '[^0-9A-Za-z]', '', 'g')), ARRAY[]::TEXT[])
  FROM (
    SELECT value FROM jsonb_each_text(CASE WHEN jsonb_typeof(d) = 'object' THEN d ELSE '{}'::jsonb END)
    UNION ALL
    SELECT value FROM jsonb_each_text(CASE WHEN jsonb_typeof(o) = 'object' THEN o ELSE '{}'::jsonb END)
  ) kv
  WHERE kv.value IS NOT NULL AND kv.value <> '';
$$;

-- Nombre del estudiante: primero data->>nombre_estudiante / nombre; si no hay,
-- cualquier columna cuyo nombre contenga "nombre" o "name" (data u original_data)
-- Candidatos a nombre de persona: valores de columnas llamadas "nombre"/"name" y,
-- además, cualquier valor que sea solo letras con dos o más palabras. Esto cubre
-- Excel sin encabezados, donde las claves de original_data son datos de otra fila.
CREATE OR REPLACE FUNCTION public.verix_name_candidates(d JSONB, o JSONB)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(array_agg(DISTINCT x.v), ARRAY[]::TEXT[])
  FROM (
    SELECT trim(kv.value) AS v, kv.key AS k
      FROM jsonb_each_text(CASE WHEN jsonb_typeof(d) = 'object' THEN d ELSE '{}'::jsonb END) kv
    UNION ALL
    SELECT trim(kv.value), kv.key
      FROM jsonb_each_text(CASE WHEN jsonb_typeof(o) = 'object' THEN o ELSE '{}'::jsonb END) kv
  ) x
  WHERE x.v <> ''
    AND (
      x.k ~* '(nombre|name)'
      OR (
        x.v ~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ. -]+$'
        AND array_length(regexp_split_to_array(x.v, '\s+'), 1) >= 2
      )
    );
$$;

-- Nombre para mostrar. nombre_estudiante / nombre tienen prioridad; si no existen
-- se toma un candidato que no sea el nombre de la plantilla.
CREATE OR REPLACE FUNCTION public.verix_holder_name(d JSONB, o JSONB, tname TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    nullif(trim(coalesce(d->>'nombre_estudiante', '')), ''),
    nullif(trim(coalesce(d->>'nombre', '')), ''),
    (SELECT c FROM unnest(public.verix_name_candidates(d, o)) c
      WHERE lower(c) <> lower(coalesce(tname, ''))
      ORDER BY c LIMIT 1)
  );
$$;

-- ─────────────────────────────────────────────
-- 1. Por documento: devuelve TODOS los certificados del número
-- ─────────────────────────────────────────────
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
  IF length(v_doc) < 5 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(r) ORDER BY r.issued_at DESC)
    FROM (
      SELECT
        coalesce(cr.verification_code, cr.code) AS verification_code,
        cr.code,
        cr.status,
        cr.consecutive_number,
        coalesce(cr.reviewed_at, cr.created_at) AS issued_at,
        public.verix_holder_name(cr.data, cr.original_data::jsonb, t.name) AS holder_name,
        t.name AS template_name
      FROM public.certificate_requests cr
      LEFT JOIN public.templates t ON t.id = cr.template_id
      WHERE cr.status IN ('APPROVED', 'SIGNED', 'REVOKED')
        AND v_doc = ANY (public.verix_doc_values(cr.data, cr.original_data::jsonb))
      ORDER BY coalesce(cr.reviewed_at, cr.created_at) DESC
      LIMIT 25
    ) r
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_certificates_by_document(TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────
-- 2. Por nombre: exige al menos dos palabras (nombre y apellido)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_certificates_by_name(p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tokens TEXT[];
BEGIN
  SELECT coalesce(array_agg(t), ARRAY[]::TEXT[]) INTO v_tokens
  FROM unnest(regexp_split_to_array(
    trim(regexp_replace(translate(lower(coalesce(p_name, '')), 'áéíóúüñ', 'aeiouun'), '[^a-z ]', ' ', 'g')),
    '\s+'
  )) AS t
  WHERE length(t) >= 2;

  IF cardinality(v_tokens) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(r) ORDER BY r.issued_at DESC)
    FROM (
      SELECT
        coalesce(cr.verification_code, cr.code) AS verification_code,
        cr.code,
        cr.status,
        cr.consecutive_number,
        coalesce(cr.reviewed_at, cr.created_at) AS issued_at,
        m.holder AS holder_name,
        t.name AS template_name
      FROM public.certificate_requests cr
      LEFT JOIN public.templates t ON t.id = cr.template_id
      CROSS JOIN LATERAL (
        -- El candidato (nombre de persona) que contiene todas las palabras buscadas
        SELECT c AS holder
        FROM unnest(public.verix_name_candidates(cr.data, cr.original_data::jsonb)) c
        WHERE lower(c) <> lower(coalesce(t.name, ''))
          AND NOT EXISTS (
            SELECT 1 FROM unnest(v_tokens) tok
            WHERE position(tok IN translate(lower(c), 'áéíóúüñ', 'aeiouun')) = 0
          )
        LIMIT 1
      ) m
      WHERE cr.status IN ('APPROVED', 'SIGNED', 'REVOKED')
      ORDER BY coalesce(cr.reviewed_at, cr.created_at) DESC
      LIMIT 25
    ) r
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_certificates_by_name(TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────
-- 3. Ficha por código/radicado/documento (orden determinista)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_certificate_for_validation(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT := regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g');
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
      OR (
        length(v_norm) >= 5
        AND cr.status IN ('APPROVED', 'SIGNED', 'REVOKED')
        AND v_norm = ANY (public.verix_doc_values(cr.data, cr.original_data::jsonb))
      )
    ORDER BY
      (cr.verification_code = p_code OR cr.code = p_code OR cr.consecutive_number = p_code) DESC,
      (cr.status IN ('APPROVED', 'SIGNED')) DESC,
      coalesce(cr.reviewed_at, cr.created_at) DESC
    LIMIT 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_certificate_for_validation(TEXT) TO anon, authenticated;
