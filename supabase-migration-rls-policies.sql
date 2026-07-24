-- ============================================
-- VERIX - Políticas RLS para solicitantes
-- ============================================
-- Ejecutar desde: Supabase Dashboard > SQL Editor
-- ============================================

-- ─────────────────────────────────────────────
-- 0. FUNCIÓN AUXILIAR: Obtener el rol del usuario
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- ─────────────────────────────────────────────
-- 1. ASEGURAR RLS ESTÉ HABILITADO
-- ─────────────────────────────────────────────

ALTER TABLE public.certificate_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- 2. POLÍTICAS PARA certificate_requests
-- ─────────────────────────────────────────────

-- 2a. Permitir a solicitantes ELIMINAR sus propias solicitudes
--     siempre que estén en estados editables
DROP POLICY IF EXISTS "Applicants can delete own requests" ON public.certificate_requests;
CREATE POLICY "Applicants can delete own requests"
ON public.certificate_requests
FOR DELETE
TO authenticated
USING (
  auth.uid() = user_id
  AND public.get_user_role() = 'APPLICANT'
  AND status IN ('DRAFT', 'PENDING', 'IN_REVIEW', 'REJECTED')
);

-- 2b. Permitir a solicitantes ACTUALIZAR sus propias solicitudes
--     (necesario para editar solicitudes desde el formulario)
DROP POLICY IF EXISTS "Applicants can update own requests" ON public.certificate_requests;
CREATE POLICY "Applicants can update own requests"
ON public.certificate_requests
FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id
  AND public.get_user_role() = 'APPLICANT'
  AND status IN ('DRAFT', 'PENDING', 'IN_REVIEW', 'REJECTED')
)
WITH CHECK (
  auth.uid() = user_id
  AND public.get_user_role() = 'APPLICANT'
  AND status IN ('DRAFT', 'PENDING', 'IN_REVIEW', 'REJECTED')
);

-- ─────────────────────────────────────────────
-- 3. POLÍTICAS PARA audit_logs
-- ─────────────────────────────────────────────

-- 3a. Permitir a usuarios autenticados INSERTAR registros de auditoría
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 3b. Permitir a usuarios autenticados LEER registros de auditoría
--     (admis ven todo; otros roles solo sus propios registros)
DROP POLICY IF EXISTS "Users can read audit logs" ON public.audit_logs;
CREATE POLICY "Users can read audit logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
  public.get_user_role() = 'ADMIN'
  OR user_id = auth.uid()
);

-- ─────────────────────────────────────────────
-- 4. POLÍTICA PARA users (permitir lectura del propio rol)
-- ─────────────────────────────────────────────
-- Necesaria para que get_user_role() pueda leer el rol sin recursion
DROP POLICY IF EXISTS "Users can read own data" ON public.users;
CREATE POLICY "Users can read own data"
ON public.users
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR public.get_user_role() = 'ADMIN'
);
