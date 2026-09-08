/**
 * Centralized, non-blocking WhatsApp opener.
 *
 * CRITICAL PERFORMANCE & STABILITY NOTE:
 * Never use `window.location.href = "whatsapp://..."`.
 * In modern Chromium browsers, assigning `window.location.href` to an external OS scheme
 * stalls the JavaScript event loop, freezes timers, breaks active WebSockets (triggering
 * Supabase Realtime heartbeat timeouts), triggers long task violations (>400ms), and
 * causes third-party browser extensions (content scripts) to crash on invalid DOM contexts.
 *
 * `openWhatsApp` uses the official https://api.whatsapp.com/send URL opened in a new tab/window,
 * which cleanly bridges to WhatsApp Desktop or WhatsApp Web without interrupting or freezing the app.
 */

export function openWhatsApp(phoneOrOptions: string | { phone?: string; text: string }, textMaybe?: string) {
  let phone = '';
  let text = '';

  if (typeof phoneOrOptions === 'object' && phoneOrOptions !== null) {
    phone = phoneOrOptions.phone || '';
    text = phoneOrOptions.text || '';
  } else {
    phone = phoneOrOptions || '';
    text = textMaybe || '';
  }

  const cleanDigits = phone.replace(/\D/g, '');
  const fullPhone = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
  const encoded = encodeURIComponent(text);

  const url = fullPhone
    ? `https://api.whatsapp.com/send?phone=${fullPhone}&text=${encoded}`
    : `https://api.whatsapp.com/send?text=${encoded}`;

  try {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened || opened.closed || typeof opened.closed === 'undefined') {
      // Fallback in case popup blockers intercept window.open
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  } catch (err) {
    console.warn('[openWhatsApp] Failed to open window:', err);
  }
}
