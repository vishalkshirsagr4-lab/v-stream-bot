import { sendMessage } from "./telegram-api.js";

export async function processBroadcasts(env) {
  const job = await env.DB.prepare(
    "SELECT * FROM broadcast_jobs WHERE status='queued' ORDER BY id LIMIT 1"
  ).first();
  if (!job) return;

  const batch = await env.DB.prepare(
    "SELECT id, telegram_id FROM users WHERE id>? AND is_blocked=0 ORDER BY id LIMIT 20"
  ).bind(job.cursor_user_id).all();
  const recipients = batch.results || [];
  if (!recipients.length) {
    await env.DB.prepare(
      "UPDATE broadcast_jobs SET status='completed', completed_at=datetime('now') WHERE id=?"
    ).bind(job.id).run();
    return;
  }

  let sent = 0;
  let failed = 0;
  let cursor = job.cursor_user_id;
  for (const user of recipients) {
    cursor = user.id;
    try {
      await sendMessage(env, user.telegram_id, job.message_text);
      sent++;
    } catch (error) {
      failed++;
      if (String(error.message || "").includes("blocked") ||
          String(error.message || "").includes("chat not found")) {
        await env.DB.prepare("UPDATE users SET is_blocked=1 WHERE telegram_id=?")
          .bind(user.telegram_id).run();
      }
      console.error("Broadcast delivery failed for user", user.telegram_id, error);
    }
  }

  await env.DB.prepare(
    "UPDATE broadcast_jobs SET cursor_user_id=?, sent_count=sent_count+?, failed_count=failed_count+? WHERE id=?"
  ).bind(cursor, sent, failed, job.id).run();

  if (recipients.length < 20) {
    await env.DB.prepare(
      "UPDATE broadcast_jobs SET status='completed', completed_at=datetime('now') WHERE id=?"
    ).bind(job.id).run();
  }
}
