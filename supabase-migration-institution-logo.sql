-- ============================================
-- VERIX - Migración: Agregar logo_url a institutions
-- ============================================

-- 1. Agregar columna logo_url a la tabla institutions
ALTER TABLE public.institutions
ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT NULL;

-- 2. Crear bucket storage si no existe (ejecutar desde SQL Editor de Supabase)
-- NOTA: También se puede crear desde Supabase Dashboard > Storage > Create bucket
-- nombre: 'verix', público: true
-- Si el bucket 'verix' ya existe, se omite.
INSERT INTO storage.buckets (id, name, public, avif_autodetection)
SELECT 'verix', 'verix', true, false
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'verix');

-- 3. Política de lectura pública para logos institucionales
CREATE POLICY "Public can read institution logos"
ON storage.objects FOR SELECT
TO public
USING (
  bucket_id = 'verix'
  AND (storage.foldername(name))[1] = 'institution-logos'
);

-- 4. Política de inserción para usuarios autenticados (admins)
CREATE POLICY "Authenticated users can upload institution logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'verix'
  AND (storage.foldername(name))[1] = 'institution-logos'
);

-- 5. Política de eliminación para admins
CREATE POLICY "Authenticated users can delete institution logos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'verix'
  AND (storage.foldername(name))[1] = 'institution-logos'
);

-- 6. Actualizar el tipo InstitutionsType para reflejar el nuevo campo (opcional, solo si hay tipos en la BD)
-- Esto es solo referencia; los tipos se definen en el frontend TypeScript
