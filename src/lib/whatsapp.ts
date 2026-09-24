/**
 * Centralized, non-blocking WhatsApp opener.
 *
 * DIRECT PROTOCOL DISPATCH:
 * Uses the native `whatsapp://send` protocol to directly launch WhatsApp Desktop (PC/Mac)
 * or WhatsApp Mobile (Android/iOS) WITHOUT opening default browser tabs.
 *
 * PERFORMANCE & STABILITY GUARDS:
 * 1. Never opens `https://api.whatsapp.com/send` in a new tab by default (prevents 10-50 blank tabs & RAM crash).
 * 2. Never assigns `window.location.href = "whatsapp://..."` directly (which would stall Chromium's event loop).
 * 3. Dispatches via an isolated, invisible DOM anchor click without `target="_blank"`.
 * 4. Ensures the web application remains completely smooth, fast, and responsive without freezing ("chipakna").
 */

export function openWhatsApp(
  phoneOrOptions: string | { phone?: string; text: string; forceWeb?: boolean },
  textMaybe?: string
) {
  let phone = '';
  let text = '';
  let forceWeb = false;

  if (typeof phoneOrOptions === 'object' && phoneOrOptions !== null) {
    phone = phoneOrOptions.phone || '';
    text = phoneOrOptions.text || '';
    forceWeb = !!phoneOrOptions.forceWeb;
  } else {
    phone = phoneOrOptions || '';
    text = textMaybe || '';
  }

  const cleanDigits = phone.replace(/\D/g, '');
  const fullPhone = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
  const encoded = encodeURIComponent(text);

  // If forceWeb is explicitly requested (e.g., WhatsApp Web fallback)
  if (forceWeb) {
    const webUrl = fullPhone
      ? `https://web.whatsapp.com/send?phone=${fullPhone}&text=${encoded}`
      : `https://web.whatsapp.com/send?text=${encoded}`;
    window.open(webUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  // ── DIRECT WHATSAPP APP PROTOCOL (whatsapp://) ──────────────────────────────
  // Directly opens WhatsApp Desktop on PC or WhatsApp on Mobile.
  // CRITICAL: Does NOT open browser tabs, prevents Chrome memory bloat & freeze.
  const appUrl = fullPhone
    ? `whatsapp://send?phone=${fullPhone}&text=${encoded}`
    : `whatsapp://send?text=${encoded}`;

  try {
    const a = document.createElement('a');
    a.href = appUrl;
    a.style.position = 'fixed';
    a.style.top = '-9999px';
    a.style.left = '-9999px';
    a.style.opacity = '0';
    a.style.pointerEvents = 'none';
    
    // Do NOT set target="_blank" so the browser doesn't open an empty browser tab
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      try {
        if (a.parentNode) a.parentNode.removeChild(a);
      } catch {}
    }, 200);
  } catch (err) {
    console.warn('[openWhatsApp] Failed to dispatch direct WhatsApp protocol, attempting fallback:', err);
    try {
      const fallbackUrl = fullPhone
        ? `https://api.whatsapp.com/send?phone=${fullPhone}&text=${encoded}`
        : `https://api.whatsapp.com/send?text=${encoded}`;
      window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    } catch (fallbackErr) {
      console.error('[openWhatsApp] Fallback error:', fallbackErr);
    }
  }
}
