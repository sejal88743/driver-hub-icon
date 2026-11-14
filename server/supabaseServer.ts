import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://qmnofkoxoijihgwgrefv.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_nxq5s4XWrgD6QdNOr4sPSQ_0rPdFlvK';

export const supabaseServer = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
