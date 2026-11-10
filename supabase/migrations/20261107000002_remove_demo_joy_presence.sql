-- Remove the fixed demo presence entry that advertised Joy as permanently online.
DELETE FROM public.user_presence
WHERE user_id = 'a0000000-0000-0000-0000-000000000001'::UUID
  AND LOWER(username) = 'joy';
