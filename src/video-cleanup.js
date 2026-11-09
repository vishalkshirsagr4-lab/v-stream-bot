import { telegramCall } from "./telegram-api.js";

export async function processExpiredVideoMessages(env) {
  const due = await env.DB.prepare(
    "SELECT id, chat_id, message_id FROM scheduled_message_deletions " +
    "WHERE delete_at <= datetime('now') ORDER BY id LIMIT 50"
  ).all();

  for (const item of due.results || []) {
    try {
      await telegramCall(env, "deleteMessage", {
        chat_id: item.chat_id,
        message_id: item.message_id
      });
      await env.DB.prepare("DELETE FROM scheduled_message_deletions WHERE id=?").bind(item.id).run();
    } catch (error) {
      // Keep transient failures for the next cron run; discard messages Telegram says are already gone.
      const message = String(error && error.message ? error.message : error).toLowerCase();
      if (message.includes("message to delete not found") || message.includes("message can't be deleted") ||
          message.includes("message_id_invalid")) {
        await env.DB.prepare("DELETE FROM scheduled_message_deletions WHERE id=?").bind(item.id).run();
      } else {
        console.error("Scheduled video deletion failed for queue item", item.id, error);
      }
    }
  }
}
