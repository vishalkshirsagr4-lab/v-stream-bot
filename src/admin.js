import { sendMessage, telegramCall } from "./telegram-api.js";

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

  const adminCommands = [
    "/stats", "/broadcast", "/send", "/ban", "/unban", "/addplan",
    "/activateplan", "/deactivateplan", "/plansadmin", "/helpadmin",
    "/videos", "/removevideo", "/grant", "/checkchannel"
  ];
  if (!adminCommands.includes(command)) return false;
  if (!isAdmin(userId, env)) {
    await sendMessage(env, chatId, "This command is available to the bot owner only.");
    return true;
  }

  if (command === "/helpadmin") {
    await sendMessage(env, chatId,
      "👑 V-Stream owner commands\n\n" +
      "/stats – bot statistics\n" +
      "/broadcast MESSAGE – send announcement to all users\n" +
      "/send USER_ID MESSAGE – message one user\n" +
      "/ban USER_ID and /unban USER_ID\n" +
      "/addplan NAME PRICE DAYS – create a plan\n" +
      "/plansadmin – list plans\n" +
      "/activateplan ID and /deactivateplan ID\n" +
      "/videos – list indexed channel videos\n" +
      "/removevideo ID – remove a video from the bot catalogue\n" +
      "/grant USER_ID DAYS [PLAN_NAME] – grant complimentary access\n" +
      "/checkchannel – check bot channel permissions\n" +
      "/myid – show your Telegram ID");
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
      " queued. Delivery runs in small batches.");
    return true;
  }

  if (command === "/send") {
    const target = args[0];
    const body = rawText.split(/\s+/).slice(2).join(" ");
    if (!target || !/^\d+$/.test(target) || !body) {
      await sendMessage(env, chatId, "Usage: /send USER_ID Your message");
      return true;
    }
    try {
      await sendMessage(env, target, body);
      await sendMessage(env, chatId, "Message sent.");
    } catch {
      await sendMessage(env, chatId, "Could not message that user. They may not have started the bot or may have blocked it.");
    }
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

  if (command === "/videos") {
    const result = await env.DB.prepare(
      "SELECT id, caption, created_at FROM videos ORDER BY id DESC LIMIT 30"
    ).all();
    const rows = result.results || [];
    const lines = rows.map(function (v) {
      const label = (v.caption || "No caption").replace(/[\r\n]+/g, " ").slice(0, 55);
      return "#" + v.id + " – " + label;
    });
    await sendMessage(env, chatId, lines.length ? "🎞 Latest indexed videos (max 30):\n" + lines.join("\n") :
      "No videos indexed yet. Add the bot as an administrator to your channel and publish a new video.");
    return true;
  }

  if (command === "/removevideo") {
    const id = Number(args[0]);
    if (!Number.isInteger(id) || id < 1) {
      await sendMessage(env, chatId, "Usage: /removevideo VIDEO_ID (get IDs from /videos)");
      return true;
    }
    const result = await env.DB.prepare("DELETE FROM videos WHERE id=?").bind(id).run();
    await sendMessage(env, chatId, result.meta.changes ? "Video removed from the bot catalogue." : "Video not found.");
    return true;
  }

  if (command === "/grant") {
    const target = args[0];
    const days = Number(args[1]);
    const planName = (args.slice(2).join(" ") || "Complimentary").slice(0, 50);
    if (!target || !/^\d+$/.test(target) || !Number.isInteger(days) || days < 1 || days > 3650) {
      await sendMessage(env, chatId, "Usage: /grant USER_ID DAYS [PLAN_NAME]");
      return true;
    }
    const targetUser = await env.DB.prepare("SELECT telegram_id FROM users WHERE telegram_id=?").bind(target).first();
    if (!targetUser) {
      await sendMessage(env, chatId, "That user has not started the bot yet.");
      return true;
    }
    await env.DB.prepare(
      "INSERT INTO subscriptions(payment_id, telegram_id, plan_name, starts_at, expires_at, status) " +
      "VALUES (NULL, ?, ?, datetime('now'), datetime('now', '+' || ? || ' days'), 'active')"
    ).bind(target, planName, days).run();
    await sendMessage(env, chatId, "Granted " + days + " days of " + planName + " access to " + target + ".");
    try {
      await sendMessage(env, target, "🎉 The administrator granted you " + days + " days of " + planName + " access.");
    } catch (error) {
      console.error("Could not notify granted user:", error);
    }
    return true;
  }

  if (command === "/checkchannel") {
    if (!env.CHANNEL_ID) {
      await sendMessage(env, chatId, "CHANNEL_ID is not configured yet. Create your channel, add the bot as administrator, then set the CHANNEL_ID Worker secret.");
      return true;
    }
    try {
      const channel = await telegramCall(env, "getChat", { chat_id: env.CHANNEL_ID });
      const me = await telegramCall(env, "getMe", {});
      const member = await telegramCall(env, "getChatMember", { chat_id: env.CHANNEL_ID, user_id: me.id });
      const canPost = member.status === "administrator" && member.can_post_messages !== false;
      await sendMessage(env, chatId,
        "Channel: " + (channel.title || channel.id) + "\nBot status: " + member.status +
        "\nChannel post access: " + (canPost ? "available" : "check admin permissions") +
        "\nIndexed videos: " + (await env.DB.prepare("SELECT COUNT(*) AS n FROM videos").first()).n);
    } catch (error) {
      console.error("Channel check failed:", error);
      await sendMessage(env, chatId, "Could not verify channel. Check CHANNEL_ID and make sure the bot is an administrator.");
    }
    return true;
  }

  return false;
}
