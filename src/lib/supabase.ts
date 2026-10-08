import { createClient } from '@supabase/supabase-js';

// LOCKED SUPABASE CREDENTIALS (Admin permission required to alter):
// SUPABASE_URL: https://zybrzzouzleacqjvfiiu.supabase.co
// SUPABASE_PUBLISHABLE_KEY: sb_publishable_gkwGkK0YvU8q_GjkkcRNOg_XsE3AcGV
// SUPABASE_SECRET_KEY: sb_secret_CB00c8sgEOlaKcf5I2h35Q_TOAg9W7S
// SUPABASE_JWKS_URL: https://zybrzzouzleacqjvfiiu.supabase.co/auth/v1/.well-known/jwks.json

const LOCKED_SUPABASE_URL = 'https://zybrzzouzleacqjvfiiu.supabase.co';
const LOCKED_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gkwGkK0YvU8q_GjkkcRNOg_XsE3AcGV';
const LOCKED_SUPABASE_SECRET_KEY = 'sb_secret_CB00c8sgEOlaKcf5I2h35Q_TOAg9W7S';
const LOCKED_SUPABASE_JWKS_URL = 'https://zybrzzouzleacqjvfiiu.supabase.co/auth/v1/.well-known/jwks.json';

const metaEnv = (typeof import.meta !== 'undefined' && (import.meta as any)?.env) || {};
const procEnv = (typeof process !== 'undefined' && process?.env) || {};

const SUPABASE_URL =
  metaEnv.VITE_SUPABASE_URL ||
  metaEnv.SUPABASE_URL ||
  procEnv.VITE_SUPABASE_URL ||
  procEnv.SUPABASE_URL ||
  LOCKED_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  metaEnv.VITE_SUPABASE_ANON_KEY ||
  metaEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  metaEnv.SUPABASE_PUBLISHABLE_KEY ||
  metaEnv.SUPABASE_ANON_KEY ||
  procEnv.VITE_SUPABASE_ANON_KEY ||
  procEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  procEnv.SUPABASE_PUBLISHABLE_KEY ||
  procEnv.SUPABASE_ANON_KEY ||
  LOCKED_SUPABASE_PUBLISHABLE_KEY;

// Enforce that connection always points to the approved Supabase host (zybrzzouzleacqjvfiiu)
// This prevents Lovable or static host auto-injected foreign Supabase projects from breaking the app
const isApprovedHost = typeof SUPABASE_URL === 'string' && SUPABASE_URL.includes('zybrzzouzleacqjvfiiu.supabase.co');
const FINAL_URL = isApprovedHost ? SUPABASE_URL : LOCKED_SUPABASE_URL;
const FINAL_KEY = (isApprovedHost && SUPABASE_ANON_KEY) ? SUPABASE_ANON_KEY : LOCKED_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(FINAL_URL, FINAL_KEY, {
  realtime: {
    // Custom robust decoder to safely handle incoming Realtime WebSocket messages.
    // In @supabase/realtime-js, the default v2 decoder expects `const [join_ref, ref, topic, event, payload] = jsonPayload;`
    // If the server sends an object error (e.g. { error: "..." } or non-array JSON), JSON.parse returns a non-array
    // which throws "TypeError: jsonPayload is not iterable" inside Serializer.decode.
    decode: (rawPayload: ArrayBuffer | string, callback: (msg: any) => void) => {
      try {
        if (rawPayload && typeof rawPayload === 'object' && 'byteLength' in (rawPayload as any)) {
          // Binary user broadcast decode fallback
          const serializer = (supabase as any)?.realtime?.serializer;
          if (serializer && typeof serializer.decode === 'function') {
            return serializer.decode(rawPayload, callback);
          }
        }
        if (typeof rawPayload === 'string') {
          const jsonPayload = JSON.parse(rawPayload);
          if (Array.isArray(jsonPayload)) {
            const [join_ref, ref, topic, event, payload] = jsonPayload;
            return callback({ join_ref, ref, topic, event, payload });
          } else if (jsonPayload && typeof jsonPayload === 'object') {
            // Server returned non-array payload (e.g. error, status or handshake message)
            const { join_ref, ref, topic, event, payload } = jsonPayload;
            return callback({
              join_ref: join_ref ?? null,
              ref: ref ?? null,
              topic: topic ?? '',
              event: event ?? '',
              payload: payload ?? jsonPayload,
            });
          }
        }
      } catch (err) {
        console.warn('[Supabase Realtime decode error gracefully handled]:', err);
      }
      return callback({});
    },
  },
});
export const SUPABASE_URL_USED = FINAL_URL;
export const SUPABASE_KEY_USED = FINAL_KEY;

export const SUPABASE_CONFIG = {
  url: LOCKED_SUPABASE_URL,
  publishableKey: LOCKED_SUPABASE_PUBLISHABLE_KEY,
  secretKey: LOCKED_SUPABASE_SECRET_KEY,
  jwksUrl: LOCKED_SUPABASE_JWKS_URL,
};

