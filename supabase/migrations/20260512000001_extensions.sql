-- Enable extensions Neurex relies on. pgcrypto provides gen_random_uuid().
-- Both extensions are pre-installed in every Supabase project; this is idempotent.

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;