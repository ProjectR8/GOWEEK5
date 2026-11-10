const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const botToken = defineSecret("TELEGRAM_BOT_TOKEN");
const allowedOrigin = "https://projectr8.github.io";

exports.telegramAuth = onRequest(
  {
    region: "europe-west1",
    secrets: [botToken],
    cors: [allowedOrigin],
    maxInstances: 10
  },
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const initData = req.body?.initData;
      if (typeof initData !== "string" || initData.length > 10000) {
        return res.status(400).json({ error: "Invalid initData" });
      }

      const params = new URLSearchParams(initData);
      const hash = params.get("hash");
      const authDate = Number(params.get("auth_date"));
      const userRaw = params.get("user");

      if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !userRaw) {
        return res.status(401).json({ error: "Invalid Telegram data" });
      }

      const now = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > 86400) {
        return res.status(401).json({ error: "Expired Telegram data" });
      }

      params.delete("hash");

      const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");

      const secretKey = crypto
        .createHmac("sha256", "WebAppData")
        .update(botToken.value())
        .digest();

      const calculatedHash = crypto
        .createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest();

      const receivedHash = Buffer.from(hash, "hex");

      if (
        calculatedHash.length !== receivedHash.length ||
        !crypto.timingSafeEqual(calculatedHash, receivedHash)
      ) {
        return res.status(401).json({ error: "Telegram verification failed" });
      }

      const telegramUser = JSON.parse(userRaw);
      if (!Number.isSafeInteger(telegramUser.id) || telegramUser.id <= 0) {
        return res.status(401).json({ error: "Invalid user" });
      }

      const uid = `tg_${telegramUser.id}`;
      let user;

      try {
        user = await admin.auth().getUser(uid);
      } catch (error) {
        if (error.code !== "auth/user-not-found") throw error;
        user = await admin.auth().createUser({
          uid,
          displayName: String(telegramUser.first_name || "GO user").slice(0, 80)
        });
      }

      const token = await admin.auth().createCustomToken(user.uid);
      return res.status(200).json({ token });
    } catch (error) {
      console.error("Telegram auth error:", error);
      return res.status(500).json({ error: "Authentication failed" });
    }
  }
);
