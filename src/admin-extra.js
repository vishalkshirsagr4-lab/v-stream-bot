import { sendMessage, telegramCall } from "./telegram-api.js";

export async function handleAdminExtraMessage(message, env) {
  if (!message.from || !message.chat || message.chat.type !== "private") return false;
  const adminId = String(message.from.id);
  const chatId = message.chat.id;
  const dm = await env.DB.prepare("SELECT target_user_id FROM admin_dm_sessions WHERE admin_id=?").bind(adminId).first();
  if (dm) {
    const target = dm.target_user_id;
    try {
      if (message.text) await sendMessage(env, target, message.text);
      else if (message.sticker) await telegramCall(env, "sendSticker", { chat_id: target, sticker: message.sticker.file_id });
      else if (message.animation) await telegramCall(env, "sendAnimation", { chat_id: target, animation: message.animation.file_id, caption: (message.caption || "").slice(0, 900) });
      else if (message.photo && message.photo.length) await telegramCall(env, "sendPhoto", { chat_id: target, photo: message.photo[message.photo.length - 1].file_id, caption: (message.caption || "").slice(0, 900) });
      else if (message.video) await telegramCall(env, "sendVideo", { chat_id: target, video: message.video.file_id, caption: (message.caption || "").slice(0, 900) });
      else if (message.document) await telegramCall(env, "sendDocument", { chat_id: target, document: message.document.file_id, caption: (message.caption || "").slice(0, 900) });
      else if (message.voice) await telegramCall(env, "sendVoice", { chat_id: target, voice: message.voice.file_id });
      else if (message.audio) await telegramCall(env, "sendAudio", { chat_id: target, audio: message.audio.file_id, caption: (message.caption || "").slice(0, 900) });
      else {
        await sendMessage(env, chatId, "That format isn't supported. Send text, GIF, sticker, photo, video, document, voice or audio. Use Cancel to stop.");
        return true;
      }
      await env.DB.prepare("DELETE FROM admin_dm_sessions WHERE admin_id=?").bind(adminId).run();
      await sendMessage(env, chatId, "✅ Message delivered to member " + target + ".");
    } catch (error) {
      console.error("Admin direct message failed:", error);
      await env.DB.prepare("DELETE FROM admin_dm_sessions WHERE admin_id=?").bind(adminId).run();
      await sendMessage(env, chatId, "❌ Could not deliver the message. The member may have blocked the bot or not be reachable.");
    }
    return true;
  }
  const draft = await env.DB.prepare("SELECT stage FROM admin_broadcast_sessions WHERE admin_id=?").bind(adminId).first();
  if (!draft) return false;
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
    const members = result.results || [];
    const lines = members.map(u => (u.first_name || "Unknown") +
      (u.username ? " (@" + u.username + ")" : "") + "\nID: " + u.telegram_id +
      " | " + (u.is_blocked ? "Blocked" : "Active") + " | Trial: " + u.trial_remaining +
      "\nLast seen: " + u.last_seen_at);
    const keyboard = members.map(u => [
      { text: "✉️ Message", callback_data: "adm:msg:" + u.telegram_id },
      { text: "❌ Cancel Subscription", callback_data: "adm:subcancel:" + u.telegram_id }
    ]);
    await sendMessage(env, chatId, (q ? "🔎 Search: " + q : "👥 Users — page " + page + " | Total: " + total.n) +
      "\n\n" + (lines.join("\n\n") || "No matches.") + (q ? "" : "\n\nNext: /users " + (page + 1)),
      { reply_markup: { inline_keyboard: keyboard } });
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

export async function handleAdminExtraCallback(query, env) {
  const adminId = String(query.from && query.from.id || "");
  if (!adminId || !(env.ADMIN_IDS || "").split(",").map(x => x.trim()).includes(adminId)) return false;
  const data = String(query.data || "");
  const chatId = query.message && query.message.chat && query.message.chat.id;
  if (!chatId) return false;
  if (data === "adm:msg:cancel") {
    await env.DB.prepare("DELETE FROM admin_dm_sessions WHERE admin_id=?").bind(adminId).run();
    await sendMessage(env, chatId, "Message cancelled.");
    return true;
  }
  if (data.startsWith("adm:msg:")) {
    const target = data.slice("adm:msg:".length);
    if (!/^\\d+$/.test(target)) return true;
    const exists = await env.DB.prepare("SELECT telegram_id FROM users WHERE telegram_id=?").bind(target).first();
    if (!exists) { await sendMessage(env, chatId, "Member not found."); return true; }
    await env.DB.prepare("INSERT INTO admin_dm_sessions(admin_id,target_user_id) VALUES (?,?) ON CONFLICT(admin_id) DO UPDATE SET target_user_id=excluded.target_user_id,created_at=datetime('now')").bind(adminId, target).run();
    await sendMessage(env, chatId, "✉️ Send the message for member " + target + ". You can send text, GIF, sticker, photo, video, document, voice or audio.\n\nUse the Cancel button below to stop.", { reply_markup: { inline_keyboard: [[{ text: "✖️ Cancel", callback_data: "adm:msg:cancel" }]] } });
    return true;
  }
  if (data.startsWith("adm:subcancel:")) {
    const target = data.slice("adm:subcancel:".length);
    if (!/^\\d+$/.test(target)) return true;
    const result = await env.DB.prepare("UPDATE subscriptions SET status='cancelled' WHERE telegram_id=? AND status='active' AND expires_at > datetime('now')").bind(target).run();
    await sendMessage(env, chatId, result.meta.changes
      ? "✅ Active subscription cancelled for member " + target + "."
      : "No active subscription found for member " + target + ".");
    return true;
  }
  return false;
}
