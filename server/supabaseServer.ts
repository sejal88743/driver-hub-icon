import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://dyeerksnenfyvgevqskp.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_CmOpnx0qPWRyhczXGRb2gQ_xVbZwFaz';

export const supabaseServer = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
