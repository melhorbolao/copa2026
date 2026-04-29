-- ── Stadium Attendance ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stadium_attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_ids UUID[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, user_id)
);

ALTER TABLE public.stadium_attendance ENABLE ROW LEVEL SECURITY;

-- Todos os autenticados podem ver
CREATE POLICY "stadium_attendance_select" ON public.stadium_attendance
  FOR SELECT TO authenticated USING (true);

-- Cada usuário gerencia apenas sua própria presença
CREATE POLICY "stadium_attendance_insert" ON public.stadium_attendance
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "stadium_attendance_update" ON public.stadium_attendance
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "stadium_attendance_delete" ON public.stadium_attendance
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── Stadium Photos ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stadium_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path    TEXT NOT NULL,
  participant_ids UUID[] NOT NULL DEFAULT '{}',
  caption         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.stadium_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stadium_photos_select" ON public.stadium_photos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "stadium_photos_insert" ON public.stadium_photos
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "stadium_photos_delete" ON public.stadium_photos
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── Storage bucket ─────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'stadium-photos',
  'stadium-photos',
  false,
  10485760,  -- 10 MB por arquivo
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- RLS para o storage bucket (controle de delete fica no server action)
CREATE POLICY "stadium_photos_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'stadium-photos');

CREATE POLICY "stadium_photos_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'stadium-photos');

CREATE POLICY "stadium_photos_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'stadium-photos');
