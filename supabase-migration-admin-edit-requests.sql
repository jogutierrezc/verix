-- ============================================
-- VERIX - El administrador puede corregir solicitudes
-- ============================================
-- Ejecutar en: Supabase Dashboard > SQL Editor (se puede repetir sin error)
--
-- Permite al rol ADMIN actualizar solicitudes en cualquier estado salvo SIGNED
-- (un documento firmado digitalmente no se modifica: se revoca y se emite otro).
-- La corrección devuelve la solicitud a PENDING para que el firmante la valide.
-- ============================================

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

DROP POLICY IF EXISTS "Admins can correct requests" ON public.certificate_requests;
CREATE POLICY "Admins can correct requests"
ON public.certificate_requests
FOR UPDATE
TO authenticated
USING (
  public.get_user_role() = 'ADMIN'
  AND status IN ('DRAFT', 'PENDING', 'IN_REVIEW', 'REJECTED', 'APPROVED')
)
WITH CHECK (
  public.get_user_role() = 'ADMIN'
);
