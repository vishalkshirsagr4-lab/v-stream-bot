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

function welcomeMarkup(env) {
  const username = String(env.DEVELOPER_USERNAME || "").trim().replace(/^@/, "");
  const keyboard = [
    [{ text: "🎁 Start Free Trial", callback_data: "trial" }],
    [{ text: "💳 Subscription", callback_data: "plans" }, { text: "🎲 Random Video", callback_data: "random" }],
    [{ text: "❓ Help", callback_data: "help" }]
  ];

  if (username) {
    keyboard.push([{ text: "👨‍💻 Contact Developer", url: "https://t.me/" + encodeURIComponent(username) }]);
  }

  return { inline_keyboard: keyboard };
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
  const developerId = env.DEVELOPER_ID || "Not configured";
  const developerUsername = env.DEVELOPER_USERNAME || "";
  const developerLine = "👨‍💻 Developer: " + (developerUsername || "V-Stream Team") +
    "\n🆔 Developer ID: " + developerId;
  const saved = await env.DB.prepare(
    "SELECT media_type, media_file_id, welcome_text FROM welcome_settings WHERE id=1"
  ).first();
  const welcomeText = saved
    ? saved.welcome_text + "\n\n━━━━━━━━━━━━━━━━━━\n" + developerLine
    : "🎬 Welcome to V-Stream!\n\nYour place to discover and stream videos.\n🎁 Enjoy up to 5 free trial videos, or explore a subscription plan.\n\n━━━━━━━━━━━━━━━━━━\n" + developerLine + "\n━━━━━━━━━━━━━━━━━━\n\nChoose an option to get started 👇";
  const markup = { reply_markup: welcomeMarkup(env) };
  if (saved && saved.media_file_id) {
    const method = saved.media_type === "photo" ? "sendPhoto" : saved.media_type === "animation" ? "sendAnimation" : "sendVideo";
    const field = saved.media_type === "photo" ? "photo" : saved.media_type === "animation" ? "animation" : "video";
    const payload = { chat_id: chatId, [field]: saved.media_file_id };
    if (welcomeText.length <= 1024) {
      payload.caption = welcomeText;
      payload.reply_markup = markup.reply_markup;
      return telegramCall(env, method, payload);
    }
    await telegramCall(env, method, payload);
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
    const pending = await env.DB.prepare(
      "SELECT id FROM payments WHERE telegram_id=? AND status='awaiting_payment' ORDER BY id DESC LIMIT 2"
    ).bind(userId).all();
    const requests = pending.results || [];
    if (requests.length === 1) return submitManualUtr(env, userId, String(requests[0].id), text, chatId);
    if (requests.length > 1) return sendMessage(env, chatId,
      "You have more than one unpaid request. Send /utr REQUEST_ID UTR_NUMBER so I can match it correctly.");
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

async function deliverTrial(env, chatId, userId) {
  const video = await getRandomVideo(env.DB);
  if (!video) return sendMessage(env, chatId, "No videos are available yet. Please try again later.");
  const reserved = await env.DB.prepare(
    "UPDATE users SET trial_remaining=trial_remaining-1 WHERE telegram_id=? AND trial_remaining>0 AND is_blocked=0 RETURNING trial_remaining"
  ).bind(userId).first();
  if (!reserved) return sendMessage(env, chatId, "Your five-video trial has been used. Choose a subscription to continue.");
  try {
    await sendVideo(env, chatId, video.file_id, video.caption || "");
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
  const video = await getRandomVideo(env.DB);
  if (!video) return sendMessage(env, chatId, "No videos are available yet. Please try again later.");
  return sendVideo(env, chatId, video.file_id, video.caption || "");
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
    return sendMessage(env, chatId,
      "💳 UPI payment instructions\n\n" +
      "Plan: " + request.plan.name + "\n" +
      "Amount: ₹" + (request.plan.amount_paise / 100).toFixed(2) + "\n" +
      "UPI ID: " + request.upiId + "\n" +
      "Payee: " + request.payeeName + "\n\n" +
      "Payment request ID: #" + request.id + "\n\n" +
      "After paying the exact amount, simply send your UTR number in this chat.\n" +
      "Or use: /utr " + request.id + " YOUR_UTR_NUMBER\n\n" +
      "Your subscription stays pending until the administrator verifies the payment in the receiving bank account. Do not send your UPI PIN or OTP to anyone.");
  } catch (error) {
    console.error("Could not create manual UPI request:", error);
    return sendMessage(env, chatId,
      "UPI payments are not configured yet. Please contact the administrator.");
  }
}
