import { supabase } from '@/integrations/supabase/client';

export type DriverDownloadType = 'TPL' | 'RPT';

export interface DriverDownloadRecord {
  downloaded: boolean;
  timestamp: number;
  format?: string; // 'IMG' | 'PDF' | 'XLS'
}

export interface DayDownloadStatus {
  tpl?: DriverDownloadRecord;
  rpt?: DriverDownloadRecord;
}

const STORAGE_KEY = 'vt_driver_downloads_v1';
const SETTING_KEY = 'vt_driver_downloads';

let _syncInitialized = false;

export function normalizeDateToISO(dateStr: string): string {
  if (!dateStr) return '';
  const clean = dateStr.trim();
  if (clean.includes('-') && clean.length === 10) {
    return clean; // Already YYYY-MM-DD
  }
  if (clean.includes('/')) {
    const parts = clean.split('/');
    if (parts.length === 3) {
      const [d, m, y] = parts;
      const fullYear = y.length === 2 ? '20' + y : y;
      return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }
  return clean;
}

export function getAllDriverDownloads(): Record<string, DayDownloadStatus> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading driver downloads:', err);
    return {};
  }
}

export function applyDriverDownloadsFromServer(data: Record<string, DayDownloadStatus>) {
  if (!data || typeof data !== 'object') return;
  try {
    const local = getAllDriverDownloads();
    const merged: Record<string, DayDownloadStatus> = { ...local };
    for (const [k, v] of Object.entries(data)) {
      if (!merged[k]) {
        merged[k] = v;
      } else {
        merged[k] = {
          tpl: v.tpl?.downloaded ? v.tpl : merged[k].tpl,
          rpt: v.rpt?.downloaded ? v.rpt : merged[k].rpt,
        };
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vt-driver-downloads-updated'));
    }
  } catch (err) {
    console.error('Error applying driver downloads from server:', err);
  }
}

export function initDriverDownloadsRealtimeSync() {
  if (typeof window === 'undefined' || _syncInitialized) return;
  _syncInitialized = true;

  // 1. Initial fetch from Supabase settings
  (async () => {
    try {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', SETTING_KEY)
        .maybeSingle();
      if (!error && data?.value) {
        try {
          const parsed = JSON.parse(data.value);
          applyDriverDownloadsFromServer(parsed);
        } catch {}
      }
    } catch {}
  })();

  // 2. Realtime listener on settings table
  try {
    if (supabase) {
      supabase
        .channel('public:settings:driver_downloads')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'settings', filter: `key=eq.${SETTING_KEY}` },
          (payload: any) => {
            const rawVal = payload?.new?.value;
            if (rawVal) {
              try {
                const parsed = JSON.parse(rawVal);
                applyDriverDownloadsFromServer(parsed);
              } catch {}
            }
          }
        )
        .subscribe();
    }
  } catch {}
}

export function getDriverDownloadStatus(dateStr: string): {
  tplDownloaded: boolean;
  rptDownloaded: boolean;
  tplRecord?: DriverDownloadRecord;
  rptRecord?: DriverDownloadRecord;
} {
  // Ensure sync is running
  initDriverDownloadsRealtimeSync();

  const isoKey = normalizeDateToISO(dateStr);
  const all = getAllDriverDownloads();
  const day = all[isoKey] || all[dateStr] || {};
  return {
    tplDownloaded: !!day.tpl?.downloaded,
    rptDownloaded: !!day.rpt?.downloaded,
    tplRecord: day.tpl,
    rptRecord: day.rpt,
  };
}

export function recordDriverDownload(
  type: DriverDownloadType,
  dateStr: string,
  format: 'IMG' | 'PDF' | 'XLS' = 'PDF'
): void {
  if (typeof window === 'undefined') return;
  try {
    const isoKey = normalizeDateToISO(dateStr);
    const all = getAllDriverDownloads();
    const currentDay = all[isoKey] || {};

    const record: DriverDownloadRecord = {
      downloaded: true,
      timestamp: Date.now(),
      format,
    };

    if (type === 'TPL') {
      currentDay.tpl = record;
    } else {
      currentDay.rpt = record;
    }

    all[isoKey] = currentDay;
    // Also save under exact dateStr if different
    if (dateStr && dateStr !== isoKey) {
      all[dateStr] = currentDay;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));

    // Dispatch custom event for real-time reactive UI update across components locally
    window.dispatchEvent(
      new CustomEvent('vt-driver-downloads-updated', {
        detail: { type, date: dateStr, isoKey, record },
      })
    );

    // Sync to Supabase in background so ALL other devices get the green indicator immediately
    (async () => {
      try {
        if (!supabase) return;
        await supabase
          .from('settings')
          .upsert({ key: SETTING_KEY, value: JSON.stringify(all) }, { onConflict: 'key' });
      } catch (e) {
        console.warn('Failed to sync driver downloads to Supabase:', e);
      }
    })();
  } catch (err) {
    console.error('Error saving driver download status:', err);
  }
}

