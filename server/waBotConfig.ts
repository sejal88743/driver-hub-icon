import fs from 'fs';
import path from 'path';
import { supabaseServer } from './supabaseServer.js';

const CONFIG_FILE = path.join(process.cwd(), '.wa-bot-config.json');

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

// 1. Initial read from disk cache on startup
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    cachedConfig = {
      selectedGroup: parsed.selectedGroup && parsed.selectedGroup.name ? parsed.selectedGroup : null,
      geminiApiKey: String(parsed.geminiApiKey || '').trim(),
      enabled: Boolean(parsed.enabled),
    };
  }
} catch (err) {
  console.warn('[WaBotConfig] Error reading config file:', err);
}

// 2. Sync authoritative settings from Supabase
export async function syncWaConfigFromSupabase() {
  try {
    const { data, error } = await supabaseServer
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
      if (map.gemini_api_key && cachedConfig.geminiApiKey !== map.gemini_api_key.trim()) {
        cachedConfig.geminiApiKey = map.gemini_api_key.trim();
        changed = true;
      }
      if (map.wa_bot_enabled !== undefined) {
        const nextEnabled = map.wa_bot_enabled === 'true';
        if (cachedConfig.enabled !== nextEnabled) {
          cachedConfig.enabled = nextEnabled;
          changed = true;
        }
      }

      if (changed) {
        saveConfigFile();
      }
    }
  } catch (err) {
    console.warn('[WaBotConfig] Supabase sync error:', err);
  }
}

void syncWaConfigFromSupabase();

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

  try {
    await supabaseServer.from('settings').upsert([
      { key: 'wa_group_jid', value: cachedConfig.selectedGroup?.jid || '' },
      { key: 'wa_group_name', value: cachedConfig.selectedGroup?.name || '' },
    ], { onConflict: 'key' });
  } catch {}

  return cachedConfig.selectedGroup;
}

export async function setGeminiApiKey(key: string) {
  cachedConfig.geminiApiKey = String(key || '').trim();
  saveConfigFile();

  try {
    await supabaseServer.from('settings').upsert({
      key: 'gemini_api_key',
      value: cachedConfig.geminiApiKey,
    }, { onConflict: 'key' });
  } catch {}
}

export async function setWaBotEnabled(enabled: boolean) {
  cachedConfig.enabled = Boolean(enabled);
  saveConfigFile();

  try {
    await supabaseServer.from('settings').upsert({
      key: 'wa_bot_enabled',
      value: String(enabled),
    }, { onConflict: 'key' });
  } catch {}
}

export function getEffectiveGeminiApiKey(): string {
  const custom = cachedConfig.geminiApiKey?.trim();
  if (custom) return custom;
  const envKey = (process.env.GEMINI_API_KEY || '').trim();
  if (envKey) return envKey;
  return '';
}
