
import { createClient } from '@supabase/supabase-js';

// Use environment variables for Supabase credentials
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xbnzvmgawikqzxutmoea.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_8TYnAzAX4s-CHAPVOpmLEA_Puqwcuwo';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
