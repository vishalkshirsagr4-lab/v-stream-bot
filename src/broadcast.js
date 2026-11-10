import { sendMessage, telegramCall } from "./telegram-api.js";

async function deliver(env, userId, job) {
  if (!job.media_type) return sendMessage(env, userId, job.message_text || "");
  const method = job.media_type === "animation" ? "sendAnimation"
    : job.media_type === "sticker" ? "sendSticker"
    : job.media_type === "photo" ? "sendPhoto"
    : job.media_type === "video" ? "sendVideo" : null;
  if (!method) throw new Error("Unsupported broadcast media type");
  const field = job.media_type;
  const payload = { chat_id: userId, [field]: job.media_file_id };
  if (job.message_text && job.media_type !== "sticker") payload.caption = String(job.message_text).slice(0, 900);
  return telegramCall(env, method, payload);
}

export async function processBroadcasts(env) {
  const job = await env.DB.prepare(
    "SELECT * FROM broadcast_jobs WHERE status='queued' ORDER BY id LIMIT 1"
  ).first();
  if (!job) return;

  const batch = await env.DB.prepare(
    "SELECT id, telegram_id FROM users WHERE id>? AND is_blocked=0 ORDER BY id LIMIT 15"
  ).bind(job.cursor_user_id).all();
  const recipients = batch.results || [];
  if (!recipients.length) {
    await env.DB.prepare("UPDATE broadcast_jobs SET status='completed', completed_at=datetime('now') WHERE id=?").bind(job.id).run();
    return;
  }

  let sent = 0, failed = 0, cursor = job.cursor_user_id;
  for (const user of recipients) {
    cursor = user.id;
    try {
      await deliver(env, user.telegram_id, job);
      sent++;
    } catch (error) {
      failed++;
      const detail = String(error.message || error).toLowerCase();
      if (detail.includes("blocked") || detail.includes("chat not found") || detail.includes("deactivated")) {
        await env.DB.prepare("UPDATE users SET is_blocked=1 WHERE telegram_id=?").bind(user.telegram_id).run();
      }
      console.error("Broadcast delivery failed for user", user.telegram_id, error);
    }
  }

  await env.DB.prepare(
    "UPDATE broadcast_jobs SET cursor_user_id=?, sent_count=sent_count+?, failed_count=failed_count+? WHERE id=?"
  ).bind(cursor, sent, failed, job.id).run();
  if (recipients.length < 15) {
    await env.DB.prepare("UPDATE broadcast_jobs SET status='completed', completed_at=datetime('now') WHERE id=?").bind(job.id).run();
  }
}
