export async function sendTelegram(text, opts = {}) {
  const token = opts.token ?? process.env.TELEGRAM_BOT_TOKEN;
  const chatId = opts.chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, skipped: true, reason: 'TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID mancanti' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Telegram error ${res.status}: ${JSON.stringify(data)}`);
  return data;
}
