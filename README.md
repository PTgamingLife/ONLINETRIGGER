# LINE 健康圖文 AI 系統

每日早上 8:00（台灣時間）自動發送健康資訊圖文到 LINE 群組，支援 AI 健康問答。

## 架構

```
Railway (Node.js) ←→ LINE Messaging API
       ↕
Supabase (狀態 + 圖片儲存)   OpenAI (gpt-4o-mini + gpt-image-2)
```

## Railway 部署步驟

1. Fork 或 push 本 repo 到你的 GitHub
2. 登入 [Railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. 選擇本 repo，Railway 會自動偵測 Node.js 並執行 `node server.js`
4. 在 Railway 的 **Variables** 頁面填入以下環境變數（不要寫進程式碼）：

```
PORT=3919
LINE_CHANNEL_SECRET=<your-secret>
LINE_CHANNEL_ACCESS_TOKEN=<your-token>
LINE_TARGET_CHAT_ID=<group-id>
ADMIN_WEBHOOK_SECRET=<自訂密碼>
OPENAI_API_KEY=<your-key>
OPENAI_TEXT_MODEL=gpt-4o-mini
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=medium
OPENAI_FULL_INFOGRAPHIC=true
REQUIRE_OPENAI_IMAGE=true
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
SUPABASE_STORAGE_BUCKET=line-images
DAILY_PUSH_TIME=08:00
DAILY_PUSH_CATCH_UP_MINUTES=180
DAILY_AI_QUOTA=3
NEWS_SOURCE=edh,healthnews,heho
MOCK_MODE=false
```

5. Railway 部署完成後，取得公開 URL（格式：`https://xxx.railway.app`）
6. 到 [LINE Developers Console](https://developers.line.biz) 將 Webhook URL 設為：
   `https://xxx.railway.app/line/webhook`

## Supabase 前置作業

在 Supabase 執行以下 SQL（已建立則略過）：

```sql
CREATE TABLE IF NOT EXISTS bot_state (
  id   INTEGER PRIMARY KEY DEFAULT 1,
  state JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO bot_state (id, state) VALUES (1, '{}') ON CONFLICT DO NOTHING;
```

Storage bucket `line-images` 設為 **Public**。

## 手動觸發推播

```bash
curl -X POST https://xxx.railway.app/admin/daily-push \
  -H "x-admin-secret: <ADMIN_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

## 健康檢查

```
GET https://xxx.railway.app/health
```

## 每週主題計畫

在 Supabase `bot_state` 表的 `state.weeklyPlan` 陣列中維護，格式：

```json
{
  "date": "2026-06-25",
  "theme": "夏季腸胃",
  "articleUrl": "https://heho.com.tw/archives/347358",
  "overrideTitle": "大吃大喝脹氣？3 招排氣減輕負擔",
  "done": false
}
```
