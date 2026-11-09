import { sendMessage } from "./telegram-api.js";

export function isAdmin(userId, env) {
  return (env.ADMIN_IDS || "").split(",").map(function (id) { return id.trim(); })
    .filter(Boolean).includes(String(userId));
}

export async function handleAdminCommand(message, env, command, args, rawText) {
  const chatId = message.chat.id;
  const userId = message.from.id;

  if (command === "/myid") {
    await sendMessage(env, chatId, "Your Telegram user ID: " + userId);
    return true;
  }

  const adminCommands = ["/stats", "/broadcast", "/send", "/ban", "/unban", "/addplan", "/activateplan", "/deactivateplan", "/plansadmin"];
  if (!adminCommands.includes(command)) return false;
  if (!isAdmin(userId, env)) {
    await sendMessage(env, chatId, "This command is available to the bot owner only.");
    return true;
  }

  if (command === "/stats") {
    const row = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM users) AS users, " +
      "(SELECT COUNT(*) FROM videos) AS videos, " +
      "(SELECT COUNT(*) FROM subscriptions WHERE status='active' AND expires_at > datetime('now')) AS active_subscriptions, " +
      "(SELECT COUNT(*) FROM payments WHERE status='paid') AS paid_payments"
    ).first();
    await sendMessage(env, chatId,
      "📊 Bot statistics\nUsers: " + row.users + "\nVideos: " + row.videos +
      "\nActive subscriptions: " + row.active_subscriptions + "\nPaid payments: " + row.paid_payments);
    return true;
  }

  if (command === "/broadcast") {
    const body = rawText.slice("/broadcast".length).trim();
    if (!body) {
      await sendMessage(env, chatId, "Usage: /broadcast Your announcement");
      return true;
    }
    const result = await env.DB.prepare(
      "INSERT INTO broadcast_jobs(message_text) VALUES (?)"
    ).bind(body).run();
    await sendMessage(env, chatId, "Broadcast job #" + result.meta.last_row_id +
      " queued. It will be delivered in small batches by the scheduled Worker.");
    return true;
  }

  if (command === "/send") {
    const target = args[0];
    const body = rawText.split(/\s+/).slice(2).join(" ");
    if (!target || !/^\d+$/.test(target) || !body) {
      await sendMessage(env, chatId, "Usage: /send USER_ID Your message");
      return true;
    }
    await sendMessage(env, target, body);
    await sendMessage(env, chatId, "Message sent.");
    return true;
  }

  if (command === "/ban" || command === "/unban") {
    const target = args[0];
    if (!target || !/^\d+$/.test(target)) {
      await sendMessage(env, chatId, "Usage: " + command + " USER_ID");
      return true;
    }
    const blocked = command === "/ban" ? 1 : 0;
    const result = await env.DB.prepare("UPDATE users SET is_blocked=? WHERE telegram_id=?")
      .bind(blocked, target).run();
    await sendMessage(env, chatId, result.meta.changes
      ? (blocked ? "User blocked." : "User unblocked.")
      : "User not found.");
    return true;
  }

  if (command === "/addplan") {
    const name = args[0];
    const rupees = Number(args[1]);
    const days = Number(args[2]);
    if (!name || !Number.isFinite(rupees) || rupees <= 0 || rupees > 1000000 ||
        !Number.isInteger(days) || days < 1 || days > 3650) {
      await sendMessage(env, chatId, "Usage: /addplan NAME PRICE_IN_RUPEES DURATION_DAYS\nExample: /addplan Monthly 99 30");
      return true;
    }
    const paise = Math.round(rupees * 100);
    await env.DB.prepare("INSERT INTO plans(name, amount_paise, duration_days) VALUES (?, ?, ?)")
      .bind(name.slice(0, 50), paise, days).run();
    await sendMessage(env, chatId, "Plan added: " + name + " – ₹" + (paise / 100).toFixed(2) + " for " + days + " days.");
    return true;
  }

  if (command === "/activateplan" || command === "/deactivateplan") {
    const id = Number(args[0]);
    if (!Number.isInteger(id) || id < 1) {
      await sendMessage(env, chatId, "Usage: " + command + " PLAN_ID");
      return true;
    }
    const active = command === "/activateplan" ? 1 : 0;
    const result = await env.DB.prepare("UPDATE plans SET active=? WHERE id=?").bind(active, id).run();
    await sendMessage(env, chatId, result.meta.changes ? "Plan updated." : "Plan not found.");
    return true;
  }

  if (command === "/plansadmin") {
    const plans = await env.DB.prepare("SELECT id, name, amount_paise, duration_days, active FROM plans ORDER BY id").all();
    const lines = (plans.results || []).map(function (p) {
      return "#" + p.id + " " + p.name + " ₹" + (p.amount_paise / 100).toFixed(2) +
        " / " + p.duration_days + " days / " + (p.active ? "active" : "inactive");
    });
    await sendMessage(env, chatId, lines.length ? lines.join("\n") : "No plans configured.");
    return true;
  }

  return false;
}
