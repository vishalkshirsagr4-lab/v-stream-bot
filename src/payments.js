import { sendMessage } from "./telegram-api.js";

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature)).map(function (b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createPaymentLink(env, telegramId, planId) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new Error("Payment credentials are missing");
  const plan = await env.DB.prepare(
    "SELECT id, name, amount_paise, duration_days FROM plans WHERE id=? AND active=1"
  ).bind(planId).first();
  if (!plan) throw new Error("Plan not found or inactive");

  const referenceId = "vs-" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const auth = btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET);
  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      authorization: "Basic " + auth,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      amount: plan.amount_paise,
      currency: "INR",
      accept_partial: false,
      reference_id: referenceId,
      description: "V-Stream " + plan.name + " subscription",
      notes: {
        telegram_id: String(telegramId),
        plan_id: String(plan.id),
        reference_id: referenceId
      },
      notify: { sms: false, email: false },
      reminder_enable: false
    })
  });
  const data = await response.json();
  if (!response.ok || !data.id || !data.short_url) {
    throw new Error(data.error && data.error.description ? data.error.description : "Payment provider request failed");
  }

  await env.DB.prepare(
    "INSERT INTO payments(telegram_id, plan_id, plan_name, duration_days, payment_link_id, amount_paise, currency) " +
    "VALUES (?, ?, ?, ?, ?, ?, 'INR')"
  ).bind(String(telegramId), plan.id, plan.name, plan.duration_days, data.id, plan.amount_paise).run();

  return { id: data.id, short_url: data.short_url };
}

export async function handleRazorpayWebhook(request, env) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return new Response("Webhook secret is not configured", { status: 503 });
  const rawBody = await request.text();
  const supplied = request.headers.get("X-Razorpay-Signature") || "";
  const expected = await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
  if (!safeEqual(expected, supplied)) return new Response("Invalid signature", { status: 401 });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (event.event === "payment_link.expired" || event.event === "payment_link.cancelled") {
    const link = event.payload && event.payload.payment_link && event.payload.payment_link.entity;
    if (link && link.id) {
      await env.DB.prepare("UPDATE payments SET status=? WHERE payment_link_id=? AND status='created'")
        .bind(event.event === "payment_link.expired" ? "expired" : "cancelled", link.id).run();
    }
    return Response.json({ ok: true });
  }

  if (event.event !== "payment_link.paid") return Response.json({ ok: true, ignored: true });

  const link = event.payload && event.payload.payment_link && event.payload.payment_link.entity;
  const payment = event.payload && event.payload.payment && event.payload.payment.entity;
  if (!link || !payment || !link.id || !payment.id) return new Response("Missing payment details", { status: 400 });
  if (link.status !== "paid" || link.currency !== "INR" || payment.currency !== "INR" ||
      Number(link.amount) <= 0 || Number(link.amount) !== Number(payment.amount)) {
    return new Response("Payment amount or status validation failed", { status: 400 });
  }

  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE payments SET status='paid', provider_payment_id=?, paid_at=datetime('now') " +
      "WHERE payment_link_id=? AND status='created' AND amount_paise=? AND currency='INR' AND provider_payment_id IS NULL"
    ).bind(payment.id, link.id, Number(link.amount)),
    env.DB.prepare(
      "INSERT OR IGNORE INTO subscriptions(payment_id, telegram_id, plan_name, starts_at, expires_at, status) " +
      "SELECT id, telegram_id, plan_name, " +
      "datetime(MAX(julianday('now'), COALESCE((SELECT MAX(julianday(expires_at)) FROM subscriptions " +
      "WHERE telegram_id=payments.telegram_id AND status='active'), julianday('now')))), " +
      "datetime(MAX(julianday('now'), COALESCE((SELECT MAX(julianday(expires_at)) FROM subscriptions " +
      "WHERE telegram_id=payments.telegram_id AND status='active'), julianday('now'))) + duration_days), " +
      "'active' FROM payments WHERE provider_payment_id=? AND status='paid'"
    ).bind(payment.id)
  ]);

  const activated = results[0] && results[0].meta ? Number(results[0].meta.changes || 0) : 0;
  if (activated > 0) {
    const record = await env.DB.prepare("SELECT telegram_id, plan_name, expires_at FROM subscriptions WHERE payment_id=(SELECT id FROM payments WHERE provider_payment_id=?)")
      .bind(payment.id).first();
    if (record) {
      try {
        await sendMessage(env, record.telegram_id,
          "✅ Payment confirmed! Your " + record.plan_name + " subscription is active until " + record.expires_at + " UTC.");
      } catch (error) {
        console.error("Payment confirmation message failed:", error);
      }
    }
  }

  return Response.json({ ok: true, activated: activated > 0 });
}
