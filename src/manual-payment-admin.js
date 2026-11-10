import { sendMessage, answerCallbackQuery } from "./telegram-api.js";
import { approveManualPayment, rejectManualPayment } from "./payments.js";

function isOwner(userId, env) {
  return (env.ADMIN_IDS || "").split(",").map(x => x.trim()).filter(Boolean).includes(String(userId));
}

export async function notifyPaymentAdmins(env, paymentId, telegramId, utr) {
  const payment = await env.DB.prepare(
    "SELECT p.id, p.plan_name, p.amount_paise, p.duration_days, p.currency, p.utr, " +
    "u.username, u.first_name FROM payments p LEFT JOIN users u ON u.telegram_id=p.telegram_id " +
    "WHERE p.id=? AND p.telegram_id=?"
  ).bind(Number(paymentId), String(telegramId)).first();
  if (!payment) return;
  const username = payment.username ? "@" + payment.username : "Not set";
  const name = payment.first_name || "Unknown";
  const message = "🔔 NEW PAYMENT — REVIEW REQUIRED\n\n" +
    "🧾 Request: #" + payment.id + "\n" +
    "👤 User: " + name + "\n" +
    "🔗 Username: " + username + "\n" +
    "🆔 Telegram ID: " + telegramId + "\n\n" +
    "📦 Purchased plan: " + payment.plan_name + "\n" +
    "💰 Amount: ₹" + (payment.amount_paise / 100).toFixed(2) + "\n" +
    "📅 Duration: " + payment.duration_days + " days\n" +
    "🏷 UTR: " + (utr || payment.utr || "Not submitted");
  const markup = { inline_keyboard: [[
    { text: "✅ Approve", callback_data: "payreview:approve:" + payment.id },
    { text: "❌ Reject", callback_data: "payreview:reject:" + payment.id }
  ]] };
  const admins = (env.ADMIN_IDS || "").split(",").map(x => x.trim()).filter(x => /^\d+$/.test(x));
  for (const adminId of admins) {
    try { await sendMessage(env, adminId, message, markup); }
    catch (error) { console.error("Could not send payment review card to admin:", adminId, error); }
  }
}

export async function handlePaymentReviewCallback(query, env) {
  const data = String(query.data || "");
  const match = data.match(/^payreview:(approve|reject):(\d+)$/);
  if (!match) return false;
  const adminId = String(query.from && query.from.id || "");
  if (!isOwner(adminId, env)) {
    await answerCallbackQuery(env, query.id, "Owner access only.", true);
    return true;
  }
  await answerCallbackQuery(env, query.id);
  const action = match[1];
  const id = match[2];
  if (action === "approve") {
    const result = await approveManualPayment(env, id, adminId);
    await sendMessage(env, query.message.chat.id, result.ok
      ? "✅ Payment request #" + id + " approved and subscription activated."
      : "Could not approve: " + result.reason);
  } else {
    const result = await rejectManualPayment(env, id, adminId, "Payment rejected by administrator");
    await sendMessage(env, query.message.chat.id, result.ok
      ? "❌ Payment request #" + id + " rejected."
      : "Could not reject: " + result.reason);
  }
  return true;
}

export async function handleManualPaymentAdminCommand(message, env, command, args, rawText) {
  const commands = ["/pendingpayments", "/approvepayment", "/rejectpayment"];
  if (!commands.includes(command)) return false;

  const chatId = message.chat.id;
  const adminId = String(message.from.id);
  if (!isOwner(adminId, env)) {
    await sendMessage(env, chatId, "This command is available to the bot owner only.");
    return true;
  }

  if (command === "/pendingpayments") {
    const result = await env.DB.prepare(
      "SELECT p.id, p.telegram_id, p.plan_name, p.amount_paise, p.utr, p.duration_days, " +
      "u.username, u.first_name FROM payments p LEFT JOIN users u ON u.telegram_id=p.telegram_id " +
      "WHERE p.status='pending_review' ORDER BY p.id LIMIT 30"
    ).all();
    const rows = result.results || [];
    if (!rows.length) {
      await sendMessage(env, chatId, "No UPI payments are waiting for review.");
      return true;
    }
    for (const p of rows) {
      const username = p.username ? "@" + p.username : "Not set";
      const card = "🧾 PAYMENT REVIEW — #" + p.id + "\n\n" +
        "👤 User: " + (p.first_name || "Unknown") + "\n" +
        "🔗 Username: " + username + "\n" +
        "🆔 Telegram ID: " + p.telegram_id + "\n\n" +
        "📦 Purchased plan: " + p.plan_name + "\n" +
        "💰 Amount: ₹" + (p.amount_paise / 100).toFixed(2) + "\n" +
        "📅 Duration: " + p.duration_days + " days\n" +
        "🏷 UTR: " + p.utr;
      await sendMessage(env, chatId, card, { reply_markup: { inline_keyboard: [[
        { text: "✅ Approve", callback_data: "payreview:approve:" + p.id },
        { text: "❌ Reject", callback_data: "payreview:reject:" + p.id }
      ]] } });
    }
    return true;
  }

  const id = args[0];
  if (!id || !/^\d+$/.test(id)) {
    await sendMessage(env, chatId, "Usage: " + command + " REQUEST_ID");
    return true;
  }

  if (command === "/approvepayment") {
    const result = await approveManualPayment(env, id, adminId);
    await sendMessage(env, chatId, result.ok
      ? "✅ Payment request #" + id + " approved and subscription activated."
      : "Could not approve: " + result.reason);
    return true;
  }

  const reason = rawText.split(/\s+/).slice(2).join(" ") || "Payment could not be verified";
  const result = await rejectManualPayment(env, id, adminId, reason);
  await sendMessage(env, chatId, result.ok
    ? "Payment request #" + id + " rejected."
    : "Could not reject: " + result.reason);
  return true;
}
