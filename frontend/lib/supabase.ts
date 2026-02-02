
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xbnzvmgawikqzxutmoea.supabase.co';
const supabaseAnonKey = 'sb_publishable_8TYnAzAX4s-CHAPVOpmLEA_Puqwcuwo';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
