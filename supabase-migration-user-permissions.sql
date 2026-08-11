-- ============================================
-- VERIX - Tabla de permisos de usuario
-- Permite controlar qué plantillas puede usar cada usuario
-- ============================================

-- ─────────────────────────────────────────────
-- 1. TABLA: user_permissions
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  allowed_template_ids UUID[] DEFAULT '{}',  -- Array de IDs de plantillas permitidas
  can_create_requests BOOLEAN DEFAULT TRUE,  -- Puede crear solicitudes
  can_view_all_requests BOOLEAN DEFAULT FALSE, -- Puede ver todas las solicitudes (no solo las propias)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id) -- Un solo registro de permisos por usuario
);

-- ─────────────────────────────────────────────
-- 2. HABILITAR RLS
-- ─────────────────────────────────────────────
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- 3. POLÍTICAS RLS
-- ─────────────────────────────────────────────

-- Admin puede todo
CREATE POLICY "Admin can manage all user permissions"
ON public.user_permissions
FOR ALL
TO authenticated
USING (public.get_user_role() = 'ADMIN')
WITH CHECK (public.get_user_role() = 'ADMIN');

-- Usuarios pueden leer sus propios permisos
CREATE POLICY "Users can read own permissions"
ON public.user_permissions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- ─────────────────────────────────────────────
-- 4. FUNCIÓN RPC: Obtener permisos del usuario actual
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id UUID)
RETURNS TABLE (
  allowed_template_ids UUID[],
  can_create_requests BOOLEAN,
  can_view_all_requests BOOLEAN
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT 
    COALESCE(up.allowed_template_ids, '{}'),
    COALESCE(up.can_create_requests, TRUE),
    COALESCE(up.can_view_all_requests, FALSE)
  FROM public.user_permissions up
  WHERE up.user_id = p_user_id;
$$;

-- ─────────────────────────────────────────────
-- 5. FUNCIÓN RPC: Verificar si un usuario puede usar una plantilla
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_can_use_template(
  p_user_id UUID,
  p_template_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  -- Si el usuario es ADMIN, siempre puede
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.users WHERE id = p_user_id AND role = 'ADMIN'
    ) THEN TRUE
    -- Si no tiene permisos registrados, puede usar todas (backward compatible)
    WHEN NOT EXISTS (
      SELECT 1 FROM public.user_permissions WHERE user_id = p_user_id
    ) THEN TRUE
    -- Si tiene permisos, verificar que la plantilla esté en la lista
    ELSE EXISTS (
      SELECT 1 FROM public.user_permissions up
      WHERE up.user_id = p_user_id
      AND (
        array_length(up.allowed_template_ids, 1) IS NULL  -- Array vacío = todas permitidas
        OR p_template_id = ANY(up.allowed_template_ids)   -- O la plantilla está en la lista
      )
    )
  END;
$$;

-- ─────────────────────────────────────────────
-- 6. FUNCIÓN RPC: Guardar/actualizar permisos de usuario
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_user_permissions(
  p_user_id UUID,
  p_allowed_template_ids UUID[],
  p_can_create_requests BOOLEAN DEFAULT TRUE,
  p_can_view_all_requests BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_permissions (
    user_id, 
    allowed_template_ids, 
    can_create_requests, 
    can_view_all_requests,
    updated_at
  )
  VALUES (
    p_user_id, 
    p_allowed_template_ids, 
    p_can_create_requests, 
    p_can_view_all_requests,
    NOW()
  )
  ON CONFLICT (user_id) 
  DO UPDATE SET
    allowed_template_ids = EXCLUDED.allowed_template_ids,
    can_create_requests = EXCLUDED.can_create_requests,
    can_view_all_requests = EXCLUDED.can_view_all_requests,
    updated_at = NOW();
END;
$$;

-- ─────────────────────────────────────────────
-- 7. FUNCIÓN RPC: Eliminar permisos de usuario
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_user_permissions(p_user_id UUID)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
  DELETE FROM public.user_permissions WHERE user_id = p_user_id;
$$;

-- ─────────────────────────────────────────────
-- 8. ÍNDICES para mejorar rendimiento
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON public.user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_template_ids ON public.user_permissions USING GIN(allowed_template_ids);

-- ─────────────────────────────────────────────
-- 9. TRIGGER: Actualizar updated_at automáticamente
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_user_permissions_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_user_permissions_timestamp
  BEFORE UPDATE ON public.user_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_permissions_timestamp();

-- ─────────────────────────────────────────────
-- 10. COMENTARIOS en las columnas
-- ─────────────────────────────────────────────
COMMENT ON TABLE public.user_permissions IS 'Almacena los permisos de acción y acceso a plantillas por usuario';
COMMENT ON COLUMN public.user_permissions.allowed_template_ids IS 'Array de UUIDs de plantillas que el usuario puede usar. Array vacío = todas las permitidas.';
COMMENT ON COLUMN public.user_permissions.can_create_requests IS 'Indica si el usuario puede crear nuevas solicitudes de certificados';
COMMENT ON COLUMN public.user_permissions.can_view_all_requests IS 'Indica si el usuario puede ver todas las solicitudes (no solo las propias). Solo aplica para APPLICANT.';
