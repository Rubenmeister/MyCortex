import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * SecureStore-backed adapter for Supabase auth persistence. Better than
 * AsyncStorage because it uses the platform Keychain/Keystore.
 *
 * SecureStore values cap at ~2 KB on iOS — Supabase sessions can exceed
 * that. We split long values into chunks transparently.
 */
const CHUNK_SIZE = 2000;
const ExpoSecureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return null;
    const head = await SecureStore.getItemAsync(key);
    if (!head) return null;
    if (!head.startsWith('@@chunked@@')) return head;
    const chunks = parseInt(head.slice('@@chunked@@'.length), 10);
    let out = '';
    for (let i = 0; i < chunks; i++) {
      out += (await SecureStore.getItemAsync(`${key}__${i}`)) ?? '';
    }
    return out;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') return;
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const chunks = Math.ceil(value.length / CHUNK_SIZE);
    await SecureStore.setItemAsync(key, `@@chunked@@${chunks}`);
    for (let i = 0; i < chunks; i++) {
      await SecureStore.setItemAsync(`${key}__${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') return;
    const head = await SecureStore.getItemAsync(key);
    if (head?.startsWith('@@chunked@@')) {
      const chunks = parseInt(head.slice('@@chunked@@'.length), 10);
      for (let i = 0; i < chunks; i++) {
        await SecureStore.deleteItemAsync(`${key}__${i}`);
      }
    }
    await SecureStore.deleteItemAsync(key);
  },
};

const url =
  Constants.expoConfig?.extra?.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey =
  Constants.expoConfig?.extra?.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!url || !anonKey) {
  console.warn('Supabase URL or anon key missing. Auth will fail.');
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Required for Supabase to refresh tokens correctly when the app comes back
// to the foreground on mobile (per Supabase docs).
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
