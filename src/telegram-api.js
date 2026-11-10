export async function telegramCall(env, method, payload) {
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN is not configured");
  const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const error = new Error("Telegram " + method + " failed: " + (data.description || response.status));
    error.retryAfter = data.parameters && data.parameters.retry_after;
    throw error;
  }
  return data.result;
}

export function sendMessage(env, chatId, text, extra = {}) {
  return telegramCall(env, "sendMessage", { chat_id: chatId, text, ...extra });
}

export function sendVideo(env, chatId, fileId, caption = "", protectContent = false, extra = {}) {
  return telegramCall(env, "sendVideo", {
    chat_id: chatId,
    video: fileId,
    caption: String(caption).slice(0, 900),
    supports_streaming: true,
    protect_content: Boolean(protectContent),
    ...extra
  });
}

export function answerCallbackQuery(env, callbackId, text) {
  return telegramCall(env, "answerCallbackQuery", {
    callback_query_id: callbackId,
    text: text || "",
    show_alert: false
  });
}
