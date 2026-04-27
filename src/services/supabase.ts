import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SavedScripture } from '../types';

// IMPORTANT: The frontend client MUST ONLY use the public anon key.
// NEVER use the service_role key in the browser as it bypasses Row Level Security.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isValidUrl = (url: string | undefined) => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

// Initialize the Supabase client
// If the key starts with 'eyJ' and contains 'service_role', Supabase will throw an error in the browser.
export const supabase: SupabaseClient | null = (isValidUrl(supabaseUrl) && supabaseAnonKey) 
  ? createClient(supabaseUrl!, supabaseAnonKey)
  : null;

export const isSupabaseConfigured = !!supabase;

export const saveScripture = async (userId: string, scripture: { verse: string, reference: string, explanation?: string }, version: string, category?: string) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  
  const { data, error } = await supabase
    .from('saved_scriptures')
    .insert({
      user_id: userId,
      text: scripture.verse,
      reference: scripture.reference,
      explanation: scripture.explanation || '',
      version: version,
      category: category || 'Uncategorized',
      is_memorized: false,
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
};

export const getSavedScriptures = async (userId: string) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  
  const { data, error } = await supabase
    .from('saved_scriptures')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data as SavedScripture[];
};

export const toggleMemorized = async (id: string, isMemorized: boolean) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  
  const { error } = await supabase
    .from('saved_scriptures')
    .update({ is_memorized: isMemorized })
    .eq('id', id);
  
  if (error) throw error;
};

export const updateScriptureCategory = async (id: string, category: string) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  
  const { error } = await supabase
    .from('saved_scriptures')
    .update({ category })
    .eq('id', id);
  
  if (error) throw error;
};

export const deleteSavedScripture = async (id: string) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  
  const { error } = await supabase
    .from('saved_scriptures')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
};

export const getProfile = async (userId: string) => {
  if (!supabase) throw new Error("Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.");
  
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error) throw error;
  return data;
};

export const saveAIFeedback = async (userId: string, responseType: 'chat' | 'mood', responseText: string, isHelpful: boolean) => {
  if (!supabase) return;
  
  const { error } = await supabase
    .from('ai_feedback')
    .insert({
      user_id: userId,
      response_type: responseType,
      response_text: responseText,
      is_helpful: isHelpful,
      created_at: new Date().toISOString()
    });
  
  if (error) {
    console.error('Error saving AI feedback:', error);
  }
};
