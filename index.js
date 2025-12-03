import express from "express";
import { Client } from "@line/bot-sdk";
import dotenv from "dotenv";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import cron from "node-cron";
import { google } from "googleapis";

dotenv.config();
dayjs.extend(utc);
dayjs.extend(timezone);

const TW_ZONE = process.env.TIMEZONE || "Asia/Taipei";

// ===== LINE 設定 ===== 
const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

// ===== Google Sheets 設定 =====
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!SHEET_ID || !GOOGLE_EMAIL || !GOOGLE_PRIVATE_KEY) {
  console.error("❌ GOOGLE Sheets 設定缺失");
  process.exit(1);
}

const auth = new google.auth.JWT(
  GOOGLE_EMAIL,
  null,
  GOOGLE_PRIVATE_KEY,
  ["https://www.googleapis.com/auth/spreadsheets.readonly"]
);
const sheets = google.sheets({ version: "v4", auth });

const SHEET_NAME = "Boss";

// ===== Boss 狀態 =====
let bossData = {};

// ===== 載入 Boss 資料 =====
async function loadBossData() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A2:G`,
    });

    const rows = res.data.values || [];
    bossData = {};

    rows.forEach((r) => {
      const [name, interval, nextRespawn, notified, notifyDate, missedCount, category] = r;
      bossData[name] = {
        interval: parseFloat(interval) || 0,
        nextRespawn: nextRespawn || null,
        notified: notified === "TRUE",
        notifyDate: notifyDate || "ALL",
        missedCount: parseInt(missedCount) || 0,
        category: category || "",
      };
    });

    console.log(`✅ 已從 Google Sheets 載入 ${rows.length} 筆資料`);
  } catch (err) {
    console.error("❌ 無法讀取 Google Sheets", err);
  }
}

// ===== 發送通知（加完整 debug log） =====
async function sendNotifications() {
  const now = dayjs().tz(TW_ZONE);

  for (const [name, b] of Object.entries(bossData)) {
    if (!b.nextRespawn || !b.interval) continue;

    const resp = dayjs(b.nextRespawn).tz(TW_ZONE);
    const diffMin = resp.diff(now, "minute");

    // 顯示每筆 Boss 狀態，方便 debug
    console.log(`📌 現在時間: ${now.format()} | Boss: ${name} | nextRespawn: ${b.nextRespawn} | diffMin: ${diffMin} | notified: ${b.notified}`);

    // 前 10 分鐘通知
    if (diffMin > 0 && diffMin <= 10 && !b.notified) {
      const notifyText = `⏰ 預告：${name} 將於 ${resp.format("HH:mm")} 重生（剩餘 ${diffMin} 分鐘）`;
      const targetId = process.env.LINE_NOTIFY_ID; // 個人或群組 ID

      if (!targetId) {
        console.warn("⚠️ LINE_NOTIFY_ID 未設定");
        continue;
      }

      try {
        await client.pushMessage(targetId, { type: "text", text: notifyText });
        b.notified = true;
        console.log(`✅ 已通知 ${name}: ${notifyText}`);
      } catch (err) {
        // 印出完整 LINE API 回傳的錯誤，方便排查
        console.error(`❌ 發送通知失敗（${name}）`, err.response?.data || err);
      }
    } else if (diffMin <= 0) {
      b.notified = false; // 清除通知狀態，下一輪可以重新通知
    }
  }
}

// ===== 測試 BOT B 自己的 ID =====
async function logMyId() {
  try {
    const profile = await client.getProfile(process.env.LINE_NOTIFY_ID);
    console.log(`📌 BOT B 的 LINE ID: ${profile.userId}`);
    console.log(`📌 BOT B 名稱: ${profile.displayName}`);
  } catch (err) {
    console.error("❌ 無法取得 BOT B 的 LINE ID", err.response?.data || err);
  }
}


// ===== 每分鐘自動執行 =====
cron.schedule("* * * * *", async () => {
  await logMyId();       // <- 先印出 BOT B 的 ID
  await loadBossData();
  await sendNotifications();
});

// ===== Express Server =====
const app = express();
app.get("/", (req, res) => res.send("B Bot is running (Notify only)."));

const PORT = process.env.PORT || 10001;
app.listen(PORT, () => {
  console.log(`🚀 LINE Boss 機器人已啟動 Port: ${PORT}`);
});
