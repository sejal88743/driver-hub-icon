import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.SUPABASE_URL ||
  'https://sfyctasavfkdqiwzvghz.supabase.co';

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.SUPABASE_ANON_KEY ||
  'sb_publishable_go6TmeUGX9H7XytOiuC8lQ_c7Wjnaye';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const SUPABASE_URL_USED = SUPABASE_URL;
export const SUPABASE_KEY_USED = SUPABASE_ANON_KEY;

