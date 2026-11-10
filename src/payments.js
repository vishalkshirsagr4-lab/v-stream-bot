import { sendMessage } from "./telegram-api.js";

export async function createManualPaymentRequest(env, telegramId, planId) {
  if (!env.UPI_ID || !/^[\w.-]{2,256}@[\w.-]{2,64}$/.test(env.UPI_ID)) {
    throw new Error("A valid UPI_ID Worker secret is not configured");
  }
  const plan = await env.DB.prepare(
    "SELECT id, name, amount_paise, duration_days FROM plans WHERE id=? AND active=1"
  ).bind(planId).first();
  if (!plan) throw new Error("Plan not found or inactive");

  const reference = "manual-" + crypto.randomUUID().replace(/-/g, "");
  const result = await env.DB.prepare(
    "INSERT INTO payments(telegram_id, plan_id, plan_name, duration_days, payment_link_id, amount_paise, currency, status) " +
    "VALUES (?, ?, ?, ?, ?, ?, 'INR', 'awaiting_payment')"
  ).bind(String(telegramId), plan.id, plan.name, plan.duration_days, reference, plan.amount_paise).run();

  return {
    id: Number(result.meta.last_row_id),
    plan,
    upiId: env.UPI_ID,
    payeeName: env.UPI_PAYEE_NAME || "Payment account"
  };
}

export async function submitManualUtr(env, telegramId, requestIdText, utrText, chatId) {
  const requestId = Number(requestIdText);
  const utr = String(utrText || "").trim().toUpperCase();
  if (!Number.isSafeInteger(requestId) || requestId < 1 || !/^[A-Z0-9]{8,30}$/.test(utr)) {
    await sendMessage(env, chatId,
      "Format: /utr REQUEST_ID UTR_NUMBER\nExample: /utr 12 123456789012");
    return;
  }

  try {
    const result = await env.DB.prepare(
      "UPDATE payments SET utr=?, status='pending_review' " +
      "WHERE id=? AND telegram_id=? AND status='awaiting_payment' AND utr IS NULL"
    ).bind(utr, requestId, String(telegramId)).run();

    if (!result.meta.changes) {
      await sendMessage(env, chatId,
        "I couldn't match that request. Check the request ID, and make sure it hasn't already been submitted.");
      return;
    }
  } catch (error) {
    if (String(error && error.message || error).toLowerCase().includes("unique")) {
      await sendMessage(env, chatId, "That UTR has already been submitted. Please check the number or contact support.");
      return;
    }
    throw error;
  }

  try {
    await sendMessage(env, chatId,
      "🧾 UTR received for payment request #" + requestId +
      ". Your subscription is pending admin verification. It will activate only after the payment is confirmed in the receiving account.");
  } catch (error) {
    console.error("Could not acknowledge UTR submission to buyer:", error);
  }

  const payment = await env.DB.prepare(
    "SELECT p.id, p.plan_name, p.amount_paise, p.duration_days, u.username, u.first_name " +
    "FROM payments p LEFT JOIN users u ON u.telegram_id=p.telegram_id WHERE p.id=?"
  ).bind(requestId).first();
  const username = payment && payment.username ? "@" + payment.username : "Not set";
  const card = "🔔 NEW PAYMENT — REVIEW REQUIRED\\n\\n" +
    "🧾 Request: #" + requestId + "\\n" +
    "👤 User: " + (payment && payment.first_name || "Unknown") + "\\n" +
    "🔗 Username: " + username + "\\n" +
    "🆔 Telegram ID: " + telegramId + "\\n\\n" +
    "📦 Purchased plan: " + (payment && payment.plan_name || "Unknown") + "\\n" +
    "💰 Amount: ₹" + (payment ? (payment.amount_paise / 100).toFixed(2) : "Unknown") + "\\n" +
    "📅 Duration: " + (payment ? payment.duration_days + " days" : "Unknown") + "\\n" +
    "🏷 UTR: " + utr;
  const markup = { reply_markup: { inline_keyboard: [[
    { text: "✅ Approve", callback_data: "payreview:approve:" + requestId },
    { text: "❌ Reject", callback_data: "payreview:reject:" + requestId }
  ]] } };
  const admins = (env.ADMIN_IDS || "").split(",").map(x => x.trim()).filter(x => /^\\d+$/.test(x));
  for (const adminId of admins) {
    try { await sendMessage(env, adminId, card, markup); }
    catch (error) { console.error("Could not notify payment admin:", adminId, error); }
  }
}

export async function approveManualPayment(env, paymentId, adminId) {
  const id = Number(paymentId);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid payment request ID." };

  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE payments SET status='paid', paid_at=datetime('now'), reviewed_by=?, reviewed_at=datetime('now') " +
      "WHERE id=? AND status='pending_review' AND utr IS NOT NULL"
    ).bind(String(adminId), id),
    env.DB.prepare(
      "INSERT OR IGNORE INTO subscriptions(payment_id, telegram_id, plan_name, starts_at, expires_at, status) " +
      "SELECT id, telegram_id, plan_name, " +
      "datetime(MAX(julianday('now'), COALESCE((SELECT MAX(julianday(expires_at)) FROM subscriptions " +
      "WHERE telegram_id=payments.telegram_id AND status='active'), julianday('now')))), " +
      "datetime(MAX(julianday('now'), COALESCE((SELECT MAX(julianday(expires_at)) FROM subscriptions " +
      "WHERE telegram_id=payments.telegram_id AND status='active'), julianday('now'))) + duration_days), " +
      "'active' FROM payments WHERE id=? AND status='paid'"
    ).bind(id)
  ]);

  const changed = Number(results[0] && results[0].meta && results[0].meta.changes || 0);
  if (!changed) return { ok: false, reason: "Request not found, already reviewed, or UTR not submitted." };

  const record = await env.DB.prepare(
    "SELECT telegram_id, plan_name, expires_at FROM subscriptions WHERE payment_id=?"
  ).bind(id).first();
  if (record) {
    try {
      await sendMessage(env, record.telegram_id,
        "✅ Your payment was verified. Your " + record.plan_name +
        " subscription is active until " + record.expires_at + " UTC.");
    } catch (error) {
      console.error("Payment approval notification failed:", error);
    }
  }
  return { ok: true, record };
}

export async function rejectManualPayment(env, paymentId, adminId, reason) {
  const id = Number(paymentId);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid payment request ID." };
  const record = await env.DB.prepare(
    "SELECT telegram_id FROM payments WHERE id=? AND status='pending_review'"
  ).bind(id).first();
  if (!record) return { ok: false, reason: "Pending request not found or already reviewed." };

  const result = await env.DB.prepare(
    "UPDATE payments SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), review_note=? " +
    "WHERE id=? AND status='pending_review'"
  ).bind(String(adminId), String(reason || "Payment could not be verified").slice(0, 200), id).run();
  if (!result.meta.changes) return { ok: false, reason: "Request was already reviewed." };

  try {
    await sendMessage(env, record.telegram_id,
      "❌ Your payment request #" + id + " could not be verified. Please contact the administrator if you believe this is a mistake.");
  } catch (error) {
    console.error("Payment rejection notification failed:", error);
  }
  return { ok: true };
}
