import { sendMessage } from "./telegram-api.js";

export async function handleAdminExtraMessage(message, env) {
  if (!message.from || !message.chat || message.chat.type !== "private") return false;
  const adminId = String(message.from.id);
  const draft = await env.DB.prepare("SELECT stage FROM admin_broadcast_sessions WHERE admin_id=?").bind(adminId).first();
  if (!draft) return false;
  const chatId = message.chat.id;
  const body = String(message.text || message.caption || "").trim();
  if (body === "/cancelbroadcast") {
    await env.DB.prepare("DELETE FROM admin_broadcast_sessions WHERE admin_id=?").bind(adminId).run();
    await sendMessage(env, chatId, "Broadcast cancelled.");
    return true;
  }
  if (draft.stage !== "content") return false;
  let type = null, fileId = null;
  if (message.sticker) { type = "sticker"; fileId = message.sticker.file_id; }
  else if (message.animation) { type = "animation"; fileId = message.animation.file_id; }
  else if (message.photo && message.photo.length) { type = "photo"; fileId = message.photo[message.photo.length - 1].file_id; }
  else if (message.video) { type = "video"; fileId = message.video.file_id; }
  if (!type && (!body || body.startsWith("/"))) {
    await sendMessage(env, chatId, "Send text, GIF, sticker, photo, or video. Use /cancelbroadcast to stop.");
    return true;
  }
  await env.DB.prepare("UPDATE admin_broadcast_sessions SET stage='confirm', media_type=?, media_file_id=?, message_text=?, updated_at=datetime('now') WHERE admin_id=?")
    .bind(type, fileId, body.slice(0, 900), adminId).run();
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE is_blocked=0").first();
  await sendMessage(env, chatId, "📣 Preview ready\nRecipients: " + count.n + "\nType: " + (type || "Text") +
    (body ? "\nCaption/message: " + body : "") + "\n\nSend /confirmbroadcast to queue or /cancelbroadcast to discard.");
  return true;
}

export async function handleAdminExtraCommand(message, env, command, args) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  if (command === "/users" || command === "/search") {
    const q = command === "/search" ? args.join(" ").trim() : "";
    const page = Math.max(1, Math.min(100000, Number(args[0]) || 1));
    const pattern = "%" + q.replace(/[\\%_]/g, "") + "%";
    const result = q
      ? await env.DB.prepare("SELECT telegram_id, username, first_name, is_blocked, trial_remaining, last_seen_at FROM users WHERE telegram_id LIKE ? OR username LIKE ? OR first_name LIKE ? ORDER BY last_seen_at DESC LIMIT 15").bind(pattern, pattern, pattern).all()
      : await env.DB.prepare("SELECT telegram_id, username, first_name, is_blocked, trial_remaining, last_seen_at FROM users ORDER BY id DESC LIMIT 10 OFFSET ?").bind((page - 1) * 10).all();
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
    const lines = (result.results || []).map(u => (u.first_name || "Unknown") +
      (u.username ? " (@" + u.username + ")" : "") + "\nID: " + u.telegram_id +
      " | " + (u.is_blocked ? "Blocked" : "Active") + " | Trial: " + u.trial_remaining +
      "\nLast seen: " + u.last_seen_at);
    await sendMessage(env, chatId, (q ? "🔎 Search: " + q : "👥 Users — page " + page + " | Total: " + total.n) +
      "\n\n" + (lines.join("\n\n") || "No matches.") + (q ? "" : "\n\nNext: /users " + (page + 1)));
    return true;
  }
  if (command === "/payments") {
    const q = args.join(" ").trim();
    const pattern = "%" + q.replace(/[\\%_]/g, "") + "%";
    const result = await env.DB.prepare("SELECT p.id,p.telegram_id,p.plan_name,p.amount_paise,p.duration_days,p.utr,p.status,p.created_at,p.paid_at,u.username,u.first_name FROM payments p LEFT JOIN users u ON u.telegram_id=p.telegram_id WHERE (?='' OR CAST(p.id AS TEXT) LIKE ? OR p.telegram_id LIKE ? OR COALESCE(p.utr,'') LIKE ? OR p.status LIKE ? OR p.plan_name LIKE ? OR COALESCE(u.username,'') LIKE ? OR COALESCE(u.first_name,'') LIKE ?) ORDER BY p.id DESC LIMIT 15")
      .bind(q, pattern, pattern, pattern, pattern, pattern, pattern, pattern).all();
    const lines = (result.results || []).map(p => "#" + p.id + " — " + p.status +
      "\n" + (p.first_name || "Unknown") + (p.username ? " (@" + p.username + ")" : "") +
      " | ID: " + p.telegram_id + "\n" + p.plan_name + " | ₹" + (p.amount_paise / 100).toFixed(2) +
      " | " + p.duration_days + " days\nUTR: " + (p.utr || "Not submitted") +
      "\nCreated: " + p.created_at + " | Paid: " + (p.paid_at || "—"));
    await sendMessage(env, chatId, "💳 Payment history" + (q ? " — " + q : "") +
      "\n\n" + (lines.join("\n\n") || "No matching payments."));
    return true;
  }
  if (command === "/broadcast") {
    await env.DB.prepare("INSERT INTO admin_broadcast_sessions(admin_id,stage) VALUES (?,'content') ON CONFLICT(admin_id) DO UPDATE SET stage='content',media_type=NULL,media_file_id=NULL,message_text=NULL,updated_at=datetime('now')").bind(userId).run();
    await sendMessage(env, chatId, "Send the text, GIF, sticker, photo, or video to broadcast. A preview and recipient count will appear before sending.\nUse /cancelbroadcast to stop.");
    return true;
  }
  if (command === "/confirmbroadcast") {
    const draft = await env.DB.prepare("SELECT * FROM admin_broadcast_sessions WHERE admin_id=? AND stage='confirm'").bind(userId).first();
    if (!draft || (!draft.media_type && !draft.message_text)) {
      await sendMessage(env, chatId, "No broadcast is ready. Start with /broadcast.");
      return true;
    }
    const result = await env.DB.prepare("INSERT INTO broadcast_jobs(message_text,media_type,media_file_id) VALUES (?,?,?)")
      .bind(draft.message_text || "", draft.media_type, draft.media_file_id).run();
    await env.DB.prepare("DELETE FROM admin_broadcast_sessions WHERE admin_id=?").bind(userId).run();
    await sendMessage(env, chatId, "Broadcast #" + result.meta.last_row_id + " queued for batch delivery.");
    return true;
  }
  if (command === "/cancelbroadcast") {
    await env.DB.prepare("DELETE FROM admin_broadcast_sessions WHERE admin_id=?").bind(userId).run();
    await sendMessage(env, chatId, "Broadcast draft cancelled.");
    return true;
  }
  return false;
}
