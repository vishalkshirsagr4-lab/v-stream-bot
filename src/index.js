import { handleMessage, handleCallback, handleChannelPost } from "./telegram.js";
import { handleRazorpayWebhook } from "./payments.js";
import { processBroadcasts } from "./broadcast.js";

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function dispatchUpdate(update, env) {
  try {
    if (update.channel_post) {
      await handleChannelPost(update.channel_post, env);
    } else if (update.message) {
      await handleMessage(update.message, env);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query, env);
    }
  } catch (error) {
    console.error("Telegram update processing failed:", error && error.stack ? error.stack : error);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "v-stream-bot", database: Boolean(env.DB) });
    }

    if (request.method === "POST" && url.pathname === "/webhook/telegram") {
      const supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
      if (!env.BOT_WEBHOOK_SECRET || !constantTimeEqual(supplied, env.BOT_WEBHOOK_SECRET)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const update = await request.json();
      ctx.waitUntil(dispatchUpdate(update, env));
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/webhook/razorpay") {
      return handleRazorpayWebhook(request, env);
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(processBroadcasts(env));
  }
};
