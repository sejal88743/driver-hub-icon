import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { pool } from './db.js';

const CONFIG_FILE = path.join(process.cwd(), '.wa-bot-config.json');

const SUPABASE_URL = 'https://zybrzzouzleacqjvfiiu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gkwGkK0YvU8q_GjkkcRNOg_XsE3AcGV';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export type WaBotConfig = {
  selectedGroup: { jid: string; name: string } | null;
  geminiApiKey: string;
  enabled: boolean;
};

let cachedConfig: WaBotConfig = {
  selectedGroup: null,
  geminiApiKey: '',
  enabled: false,
};

// 1. Initial read from file on startup
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    cachedConfig = {
      selectedGroup: parsed.selectedGroup && parsed.selectedGroup.name ? parsed.selectedGroup : null,
      geminiApiKey: String(parsed.geminiApiKey || '').trim(),
      enabled: Boolean(parsed.enabled),
    };
    console.log('[WaBotConfig] Loaded persistent config from disk:', {
      group: cachedConfig.selectedGroup?.name,
      hasCustomApiKey: Boolean(cachedConfig.geminiApiKey),
      enabled: cachedConfig.enabled,
    });
  }
} catch (err) {
  console.warn('[WaBotConfig] Error reading config file:', err);
}

// 2. Sync from Supabase settings table in background
async function syncFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['wa_group_jid', 'wa_group_name', 'gemini_api_key', 'wa_bot_enabled']);

    if (!error && Array.isArray(data)) {
      const map: Record<string, string> = {};
      for (const row of data) {
        map[row.key] = String(row.value || '');
      }

      let changed = false;
      if (map.wa_group_name && (!cachedConfig.selectedGroup || cachedConfig.selectedGroup.name !== map.wa_group_name)) {
        cachedConfig.selectedGroup = {
          jid: map.wa_group_jid || '',
          name: map.wa_group_name,
        };
        changed = true;
      }
      if (map.gemini_api_key && !cachedConfig.geminiApiKey) {
        cachedConfig.geminiApiKey = map.gemini_api_key.trim();
        changed = true;
      }
      if (map.wa_bot_enabled !== undefined) {
        cachedConfig.enabled = map.wa_bot_enabled === 'true';
      }

      if (changed) {
        saveConfigFile();
        console.log('[WaBotConfig] Synced from Supabase settings:', {
          group: cachedConfig.selectedGroup?.name,
          enabled: cachedConfig.enabled,
        });
      }
    }
  } catch (err) {
    console.warn('[WaBotConfig] Supabase sync error:', err);
  }
}

// Run initial Supabase sync
syncFromSupabase();

function saveConfigFile() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cachedConfig, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[WaBotConfig] Failed to save config file:', err);
  }
}

export function getWaBotConfig(): WaBotConfig {
  return cachedConfig;
}

export async function setSavedGroup(jid: string, name: string): Promise<{ jid: string; name: string } | null> {
  const cleanName = String(name || '').trim();
  const cleanJid = String(jid || '').trim();

  if (!cleanName && !cleanJid) {
    cachedConfig.selectedGroup = null;
  } else {
    cachedConfig.selectedGroup = {
      jid: cleanJid,
      name: cleanName || cleanJid,
    };
  }

  saveConfigFile();
  console.log('[WaBotConfig] Permanent group saved:', cachedConfig.selectedGroup);

  // Sync to Supabase
  try {
    await supabase.from('settings').upsert([
      { key: 'wa_group_jid', value: cachedConfig.selectedGroup?.jid || '' },
      { key: 'wa_group_name', value: cachedConfig.selectedGroup?.name || '' },
    ], { onConflict: 'key' });
  } catch {}

  // Sync to local DB pool if available
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('wa_group_jid', $1), ('wa_group_name', $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [cachedConfig.selectedGroup?.jid || '', cachedConfig.selectedGroup?.name || '']
    );
  } catch {}

  return cachedConfig.selectedGroup;
}

export async function setGeminiApiKey(key: string) {
  cachedConfig.geminiApiKey = String(key || '').trim();
  saveConfigFile();

  try {
    await supabase.from('settings').upsert({
      key: 'gemini_api_key',
      value: cachedConfig.geminiApiKey,
    }, { onConflict: 'key' });
  } catch {}

  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('gemini_api_key', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [cachedConfig.geminiApiKey]
    );
  } catch {}
}

export async function setWaBotEnabled(enabled: boolean) {
  cachedConfig.enabled = Boolean(enabled);
  saveConfigFile();

  try {
    await supabase.from('settings').upsert({
      key: 'wa_bot_enabled',
      value: String(enabled),
    }, { onConflict: 'key' });
  } catch {}

  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('wa_bot_enabled', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(enabled)]
    );
  } catch {}
}

/**
 * Returns effective Gemini API key:
 * 1. Custom user key saved in Admin UI (highest priority)
 * 2. process.env.GEMINI_API_KEY (fallback)
 */
export function getEffectiveGeminiApiKey(): string {
  const custom = cachedConfig.geminiApiKey?.trim();
  if (custom) return custom;
  const envKey = (process.env.GEMINI_API_KEY || '').trim();
  if (envKey) return envKey;
  return '';
}
