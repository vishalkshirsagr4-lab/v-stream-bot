import { sendMessage } from "./telegram-api.js";
import { approveManualPayment, rejectManualPayment } from "./payments.js";

function isOwner(userId, env) {
  return (env.ADMIN_IDS || "").split(",").map(x => x.trim()).filter(Boolean).includes(String(userId));
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
      "SELECT id, telegram_id, plan_name, amount_paise, utr, created_at " +
      "FROM payments WHERE status='pending_review' ORDER BY id LIMIT 30"
    ).all();
    const rows = result.results || [];
    const lines = rows.map(p =>
      "#" + p.id + " | " + p.plan_name + " | ₹" + (p.amount_paise / 100).toFixed(2) +
      " | User " + p.telegram_id + " | UTR " + p.utr
    );
    await sendMessage(env, chatId, lines.length
      ? "🧾 Pending UPI payments (max 30):\n" + lines.join("\n") +
        "\n\nApprove only after verifying the matching bank credit:\n/approvepayment REQUEST_ID\n/rejectpayment REQUEST_ID [reason]"
      : "No UPI payments are waiting for review.");
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
