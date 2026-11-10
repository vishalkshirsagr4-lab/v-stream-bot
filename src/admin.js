import { sendMessage, telegramCall } from "./telegram-api.js";
import { handleManualPaymentAdminCommand } from "./manual-payment-admin.js";
import { handleAdminExtraCommand, handleAdminExtraMessage } from "./admin-extra.js";


const ADMIN_COMMANDS = [
  { command: "helpadmin", description: "Show all administrator commands" },
  { command: "setwelcome", description: "Set or update welcome media and text" },
  { command: "deletewelcome", description: "Remove custom welcome media and text" },
  { command: "cancelwelcome", description: "Cancel welcome setup" },
  { command: "stats", description: "View bot statistics" },
  { command: "users", description: "Browse registered members" },
  { command: "search", description: "Search members" },
  { command: "payments", description: "Search payment history" },
  { command: "confirmbroadcast", description: "Confirm prepared broadcast" },
  { command: "cancelbroadcast", description: "Cancel prepared broadcast" },
  { command: "broadcast", description: "Broadcast a message to users" },
  { command: "send", description: "Send a message to one user" },
  { command: "ban", description: "Block a user" },
  { command: "unban", description: "Unblock a user" },
  { command: "addplan", description: "Create a subscription plan" },
  { command: "plansadmin", description: "List subscription plans" },
  { command: "activateplan", description: "Activate a plan" },
  { command: "deactivateplan", description: "Deactivate a plan" },
  { command: "videos", description: "List indexed videos" },
  { command: "removevideo", description: "Remove a catalogue video" },
  { command: "grant", description: "Grant complimentary access" },
  { command: "checkchannel", description: "Check channel permissions" },
  { command: "pendingpayments", description: "Review submitted UPI payments" },
  { command: "approvepayment", description: "Approve a verified payment" },
  { command: "rejectpayment", description: "Reject a payment request" },
  { command: "myid", description: "Show your Telegram ID" }
];

export async function setChatCommands(env, chatId, admin) {
  const commands = admin ? [
    { command: "start", description: "Open V-Stream" },
    { command: "help", description: "Show member commands" },
    { command: "commands", description: "Show member commands" },
    ...ADMIN_COMMANDS
  ] : [
    { command: "start", description: "Open V-Stream" },
    { command: "help", description: "Show member commands" },
    { command: "commands", description: "Show member commands" },
    { command: "utr", description: "Submit UPI payment reference" }
  ];
  await telegramCall(env, "setMyCommands", {
    commands,
    scope: { type: "chat", chat_id: chatId }
  });
}

export async function handleAdminMessage(message, env) {
  if (!message.from || !message.chat || message.chat.type !== "private") return false;
  const adminId = String(message.from.id);
  if (!isAdmin(adminId, env)) return false;
  if (await handleAdminExtraMessage(message, env)) return true;
  const session = await env.DB.prepare(
    "SELECT stage, media_type, media_file_id FROM admin_welcome_sessions WHERE admin_id=?"
  ).bind(adminId).first();
  if (!session) return false;

  const chatId = message.chat.id;
  if (message.text && message.text.trim() === "/cancelwelcome") {
    await env.DB.prepare("DELETE FROM admin_welcome_sessions WHERE admin_id=?").bind(adminId).run();
    await sendMessage(env, chatId, "Welcome setup cancelled.");
    return true;
  }

  if (session.stage === "media") {
    let mediaType = null;
    let fileId = null;
    if (message.photo && message.photo.length) {
      mediaType = "photo";
      fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.animation) {
      mediaType = "animation";
      fileId = message.animation.file_id;
    } else if (message.video) {
      mediaType = "video";
      fileId = message.video.file_id;
    }
    if (!mediaType || !fileId) {
      await sendMessage(env, chatId, "Please send one image, GIF, or video first. Use /cancelwelcome to stop.");
      return true;
    }
    await env.DB.prepare(
      "UPDATE admin_welcome_sessions SET stage='text', media_type=?, media_file_id=?, updated_at=datetime('now') WHERE admin_id=?"
    ).bind(mediaType, fileId, adminId).run();
    await sendMessage(env, chatId, "Media received! Now send the welcome text users should see.");
    return true;
  }

  if (session.stage === "text") {
    const welcomeText = (message.text || message.caption || "").trim();
    if (!welcomeText || welcomeText.startsWith("/")) {
      await sendMessage(env, chatId, "Please send the welcome text as a normal message, not a command.");
      return true;
    }
    await env.DB.prepare(
      "INSERT INTO welcome_settings(id, media_type, media_file_id, welcome_text, updated_at) VALUES (1, ?, ?, ?, datetime('now')) " +
      "ON CONFLICT(id) DO UPDATE SET media_type=excluded.media_type, media_file_id=excluded.media_file_id, welcome_text=excluded.welcome_text, updated_at=datetime('now')"
    ).bind(session.media_type, session.media_file_id, welcomeText.slice(0, 3500)).run();
    await env.DB.prepare("DELETE FROM admin_welcome_sessions WHERE admin_id=?").bind(adminId).run();
    await sendMessage(env, chatId, "Welcome saved! New users will see it the next time they use /start.");
    return true;
  }
  return false;
}

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

  if (await handleManualPaymentAdminCommand(message, env, command, args, rawText)) return true;

  const adminCommands = [
    "/setwelcome", "/deletewelcome", "/cancelwelcome",
    "/stats", "/users", "/search", "/payments", "/broadcast", "/confirmbroadcast", "/cancelbroadcast", "/send", "/ban", "/unban", "/addplan",
    "/activateplan", "/deactivateplan", "/plansadmin", "/helpadmin",
    "/videos", "/removevideo", "/grant", "/checkchannel"
  ];
  if (!adminCommands.includes(command)) return false;
  if (!isAdmin(userId, env)) {
    await sendMessage(env, chatId, "This command is available to the bot owner only.");
    return true;
  }

  if (await handleAdminExtraCommand(message, env, command, args)) return true;

  if (command === "/helpadmin") {
    await sendMessage(env, chatId,
      "👑 V-Stream admin commands\n\n" +
      "👥 MEMBERS & PAYMENTS\n" +
      "/users [PAGE] – browse registered members\n" +
      "/search QUERY – search by name, username or Telegram ID\n" +
      "/payments [QUERY] – search payment history, UTR or status\n" +
      "/pendingpayments – list submitted UTRs for review\n" +
      "/approvepayment ID – approve only after verifying bank credit\n" +
      "/rejectpayment ID [REASON] – reject a payment request\n" +
      "\n📣 BROADCAST & MESSAGES\n" +
      "/broadcast – start a text, GIF, sticker, photo or video broadcast draft\n" +
      "/confirmbroadcast – queue the previewed broadcast to all eligible members\n" +
      "/cancelbroadcast – discard the broadcast draft\n" +
      "/send USER_ID MESSAGE – send a private message to one member\n" +
      "\n⚙️ BOT & SUBSCRIPTIONS\n" +
      "/stats – view bot statistics\n" +
      "/setwelcome – set welcome image, GIF or video, then text\n" +
      "/deletewelcome – remove custom welcome media and text\n" +
      "/cancelwelcome – cancel welcome setup\n" +
      "/addplan NAME PRICE DAYS – create a subscription plan\n" +
      "/plansadmin – list subscription plans\n" +
      "/activateplan ID – activate a plan\n" +
      "/deactivateplan ID – deactivate a plan\n" +
      "/grant USER_ID DAYS [PLAN_NAME] – grant complimentary access\n" +
      "\n🎞 VIDEO CATALOGUE\n" +
      "/videos – list indexed channel videos\n" +
      "/removevideo ID – remove a video from the catalogue\n" +
      "/checkchannel – check channel permissions\n" +
      "/myid – show your Telegram ID\n\n" +
      "Tip: Open the command menu (/) to see admin command suggestions.");
    return true;
  }

  if (command === "/setwelcome") {
    await env.DB.prepare(
      "INSERT INTO admin_welcome_sessions(admin_id, chat_id, stage, media_type, media_file_id, updated_at) " +
      "VALUES (?, ?, 'media', NULL, NULL, datetime('now')) " +
      "ON CONFLICT(admin_id) DO UPDATE SET chat_id=excluded.chat_id, stage='media', media_type=NULL, media_file_id=NULL, updated_at=datetime('now')"
    ).bind(String(userId), String(chatId)).run();
    await sendMessage(env, chatId, "Send the welcome image, GIF, or video first.\n\nThen I will ask for the text shown to users.\n\nSend /cancelwelcome to cancel.");
    return true;
  }

  if (command === "/cancelwelcome") {
    await env.DB.prepare("DELETE FROM admin_welcome_sessions WHERE admin_id=?").bind(String(userId)).run();
    await sendMessage(env, chatId, "Welcome setup cancelled.");
    return true;
  }

  if (command === "/deletewelcome") {
    await env.DB.prepare("DELETE FROM welcome_settings WHERE id=1").run();
    await sendMessage(env, chatId, "Custom welcome removed. The default V-Stream greeting is active again.");
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
      const isChannelAdmin = member.status === "creator" || member.status === "administrator";
      const canPost = isChannelAdmin && (member.status === "creator" || member.can_post_messages !== false);
      await sendMessage(env, chatId,
        "Channel: " + (channel.title || channel.id) + "\nChannel ID: " + channel.id +
        "\nBot status: " + member.status +
        "\nChannel admin access: " + (isChannelAdmin ? "yes" : "no") +
        "\nPost permission: " + (canPost ? "available" : "not available") +
        "\nIndexed videos: " + (await env.DB.prepare("SELECT COUNT(*) AS n FROM videos").first()).n);
    } catch (error) {
      console.error("Channel check failed:", error);
      const detail = String(error && error.message ? error.message : error).slice(0, 350);
      await sendMessage(env, chatId,
        "Channel verification failed. Telegram says: " + detail +
        "\n\nCheck that CHANNEL_ID is the channel's numeric ID (often starts with -100), and that this bot is a channel administrator.");
    }
    return true;
  }

  return false;
}
