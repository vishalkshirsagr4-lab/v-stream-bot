import { sendMessage, sendVideo, answerCallbackQuery, telegramCall } from "./telegram-api.js";
import { upsertUser, getUser, getActiveSubscription, listPlans, getRandomVideo } from "./db.js";
import { createManualPaymentRequest, submitManualUtr } from "./payments.js";
import { handleAdminCommand, handleAdminMessage, setChatCommands, isAdmin } from "./admin.js";

const HELP_TEXT =
  "🎬 V-Stream — Member Commands\n\n" +
  "/start — Open the welcome menu\n" +
  "/help — Show this help\n" +
  "/commands — Show available member commands\n" +
  "/utr REQUEST_ID UTR_NUMBER — Submit your UPI reference\n\n" +
  "🎁 Use Trial Videos for up to five free videos.\n" +
  "💳 Use Subscription to view available plans.\n" +
  "🎲 Random Video is available with an active subscription.\n" +
  "👑 My Subscription shows your current plan and expiry.\n\n" +
  "Administrator commands are not shown to members.";

function trialLimit(env) {
  const n = Number(env.TRIAL_VIDEO_LIMIT || 5);
  return Number.isInteger(n) && n > 0 && n <= 20 ? n : 5;
}

function welcomeMarkup() {
  return {
    inline_keyboard: [
      [{ text: "❓ Help", callback_data: "help" }, { text: "🎁 Trial – 5 Videos", callback_data: "trial" }],
      [{ text: "💳 Subscription", callback_data: "plans" }, { text: "🎲 Random Video", callback_data: "random" }]
    ]
  };
}

function replyKeyboard() {
  return {
    keyboard: [
      [{ text: "🎲 Random Video" }, { text: "👑 My Subscription" }],
      [{ text: "🎁 Trial Videos" }, { text: "💳 Subscription" }],
      [{ text: "❓ Help" }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

async function sendWelcome(env, chatId) {
  const saved = await env.DB.prepare(
    "SELECT media_type, media_file_id, welcome_text FROM welcome_settings WHERE id=1"
  ).first();
  const welcomeText = saved && saved.welcome_text
    ? saved.welcome_text
    : "🎬 Welcome to V-Stream!\\n\\nExplore the available videos and choose an option below.";
  const markup = { reply_markup: welcomeMarkup() };

  if (saved && saved.media_file_id) {
    const method = saved.media_type === "photo" ? "sendPhoto" : saved.media_type === "animation" ? "sendAnimation" : "sendVideo";
    const field = saved.media_type === "photo" ? "photo" : saved.media_type === "animation" ? "animation" : "video";
    const payload = { chat_id: chatId, [field]: saved.media_file_id };
    if (welcomeText.length <= 1024) {
      payload.caption = welcomeText;
      payload.reply_markup = markup.reply_markup;
    }
    try {
      await telegramCall(env, method, payload);
      return;
    } catch (error) {
      console.error("Welcome media could not be sent; falling back to text:", error);
    }
  }
  return sendMessage(env, chatId, welcomeText, markup);
}

export async function handleMessage(message, env) {
  if (!message.from || !message.chat || message.chat.type !== "private") return;
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  await upsertUser(env.DB, message.from, trialLimit(env));

  const blocked = await env.DB.prepare("SELECT is_blocked FROM users WHERE telegram_id=?").bind(userId).first();
  if (blocked && blocked.is_blocked) return;

  if (await handleAdminMessage(message, env)) return;

  const text = (message.text || "").trim();
  if (text.startsWith("/")) {
    const parts = text.split(/\s+/);
    const command = parts[0].split("@")[0].toLowerCase();
    const args = parts.slice(1);
    if (command === "/start") {
      try { await setChatCommands(env, chatId, isAdmin(userId, env)); }
      catch (error) { console.error("Could not set chat command menu:", error); }
      return sendWelcome(env, chatId);
    }
    if (command === "/help" || command === "/commands") return sendMessage(env, chatId, HELP_TEXT, { reply_markup: replyKeyboard() });
    if (command === "/utr") return submitManualUtr(env, userId, args[0], args[1], chatId);
    if (await handleAdminCommand(message, env, command, args, text)) return;
    return sendMessage(env, chatId, "Unknown command. Send /help for available options.");
  }

  if (/^[A-Z0-9]{8,30}$/i.test(text)) {
    const session = await env.DB.prepare(
      "SELECT payment_id FROM payment_utr_sessions WHERE telegram_id=?"
    ).bind(userId).first();
    if (session) {
      await env.DB.prepare("DELETE FROM payment_utr_sessions WHERE telegram_id=?").bind(userId).run();
      return submitManualUtr(env, userId, String(session.payment_id), text, chatId);
    }
  }

  if (text === "🎲 Random Video") return deliverRandom(env, chatId, userId);
  if (text === "👑 My Subscription") return showSubscription(env, chatId, userId);
  if (text === "🎁 Trial Videos") return deliverTrial(env, chatId, userId);
  if (text === "💳 Subscription") return showPlans(env, chatId);
  if (text === "❓ Help") return sendMessage(env, chatId, HELP_TEXT);
}

export async function handleCallback(query, env) {
  const chatId = query.message && query.message.chat && query.message.chat.id;
  const userId = query.from && String(query.from.id);
  if (!chatId || !userId) return;
  await upsertUser(env.DB, query.from, trialLimit(env));
  await answerCallbackQuery(env, query.id);

  const user = await getUser(env.DB, userId);
  if (user && user.is_blocked) return sendMessage(env, chatId, "Your access to this bot is disabled.");

  if (query.data === "help") return sendMessage(env, chatId, HELP_TEXT);
  if (query.data === "trial") return deliverTrial(env, chatId, userId);
  if (query.data === "random") return deliverRandom(env, chatId, userId);
  if (query.data === "plans") return showPlans(env, chatId);
  if (query.data && query.data.startsWith("paid:")) {
    const paymentId = Number(query.data.slice(5));
    if (!Number.isSafeInteger(paymentId) || paymentId < 1) return sendMessage(env, chatId, "Invalid payment request.");
    const payment = await env.DB.prepare(
      "SELECT id FROM payments WHERE id=? AND telegram_id=? AND status='awaiting_payment'"
    ).bind(paymentId, userId).first();
    if (!payment) return sendMessage(env, chatId, "This payment request is not available. Start a new subscription request if needed.");
    await env.DB.prepare(
      "INSERT INTO payment_utr_sessions(telegram_id, payment_id, updated_at) VALUES (?, ?, datetime('now')) " +
      "ON CONFLICT(telegram_id) DO UPDATE SET payment_id=excluded.payment_id, updated_at=datetime('now')"
    ).bind(userId, paymentId).run();
    return sendMessage(env, chatId, "✅ After completing the payment, send your UTR/reference number here as a message. I’ll forward it for admin verification. Do not share your UPI PIN or OTP.");
  }
  if (query.data && query.data.startsWith("buy:")) {
    const planId = Number(query.data.slice(4));
    if (!Number.isInteger(planId) || planId < 1) return sendMessage(env, chatId, "Invalid plan.");
    return startPurchase(env, chatId, userId, planId);
  }
}

export async function handleChannelPost(message, env) {
  if (!env.CHANNEL_ID || String(message.chat.id) !== String(env.CHANNEL_ID)) return;
  const media = message.video ||
    (message.document && String(message.document.mime_type || "").startsWith("video/") ? message.document : null);
  if (!media || !media.file_id) return;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO videos(file_id, file_unique_id, caption, channel_message_id) VALUES (?, ?, ?, ?)"
  ).bind(media.file_id, media.file_unique_id || null, message.caption || "", message.message_id).run();
}


async function deliverProtectedVideo(env, chatId, userId, video) {
  const sent = await sendVideo(env, chatId, video.file_id, video.caption || "", true);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO user_video_history(telegram_id, video_id, sent_at) VALUES (?, ?, datetime('now'))"
  ).bind(String(userId), video.id).run();
  await env.DB.prepare(
    "INSERT INTO scheduled_message_deletions(chat_id, message_id, delete_at) VALUES (?, ?, datetime('now', '+2 hours'))"
  ).bind(String(chatId), sent.message_id).run();
  return sent;
}

async function deliverTrial(env, chatId, userId) {
  const video = await getRandomVideo(env.DB, userId);
  if (!video) return sendMessage(env, chatId, "No videos are available yet. Please try again later.");
  const reserved = await env.DB.prepare(
    "UPDATE users SET trial_remaining=trial_remaining-1 WHERE telegram_id=? AND trial_remaining>0 AND is_blocked=0 RETURNING trial_remaining"
  ).bind(userId).first();
  if (!reserved) return sendMessage(env, chatId, "Your five-video trial has been used. Choose a subscription to continue.");
  try {
    await deliverProtectedVideo(env, chatId, userId, video);
    await sendMessage(env, chatId, "🎁 Trial video sent. " + reserved.trial_remaining + " trial video(s) remaining.");
  } catch (error) {
    await env.DB.prepare("UPDATE users SET trial_remaining=trial_remaining+1 WHERE telegram_id=?")
      .bind(userId).run();
    throw error;
  }
}

async function deliverRandom(env, chatId, userId) {
  const sub = await getActiveSubscription(env.DB, userId);
  if (!sub) {
    return sendMessage(env, chatId,
      "🔒 Random videos require an active subscription. You can still use any remaining trial videos.",
      { reply_markup: replyKeyboard() });
  }
  const video = await getRandomVideo(env.DB, userId);
  if (!video) return sendMessage(env, chatId, "No videos are available yet. Please try again later.");
  return deliverProtectedVideo(env, chatId, userId, video);
}

async function showSubscription(env, chatId, userId) {
  const sub = await getActiveSubscription(env.DB, userId);
  if (!sub) return sendMessage(env, chatId, "You don't have an active subscription. Choose Subscription to view plans.");
  return sendMessage(env, chatId, "👑 Active plan: " + sub.plan_name + "\nExpires: " + sub.expires_at + " UTC");
}

async function showPlans(env, chatId) {
  const plans = await listPlans(env.DB);
  if (!plans.length) return sendMessage(env, chatId, "No plans are available yet. Please check back later.");
  const keyboard = plans.map(function (plan) {
    return [{
      text: plan.name + " – ₹" + (plan.amount_paise / 100).toFixed(2) + " / " + plan.duration_days + " days",
      callback_data: "buy:" + plan.id
    }];
  });
  return sendMessage(env, chatId, "💳 Choose a subscription plan:", {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function startPurchase(env, chatId, userId, planId) {
  try {
    const request = await createManualPaymentRequest(env, userId, planId);
    const amount = (request.plan.amount_paise / 100).toFixed(2);
    const upiUri = "upi://pay?pa=" + encodeURIComponent(request.upiId) +
      "&pn=" + encodeURIComponent(request.payeeName) +
      "&am=" + encodeURIComponent(amount) + "&cu=INR&tn=" + encodeURIComponent("V-Stream request #" + request.id);
    const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=12&data=" + encodeURIComponent(upiUri);
    return telegramCall(env, "sendPhoto", {
      chat_id: chatId,
      photo: qrUrl,
      caption: "📲 Scan this QR with your UPI app. Check the payee and amount in your UPI app before paying.\n\n" +
        "Plan: " + request.plan.name + "\nAmount: ₹" + amount +
        "\nPayment request: #" + request.id,
      reply_markup: {
        inline_keyboard: [[{ text: "✅ Paid — Submit UTR", callback_data: "paid:" + request.id }]]
      }
    });
  } catch (error) {
    console.error("Could not create manual UPI request:", error);
    return sendMessage(env, chatId, "UPI payment could not be started. Please contact the administrator.");
  }
}
