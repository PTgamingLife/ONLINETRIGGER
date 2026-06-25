require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const { loadState, saveState } = require('./src/state');
const { fetchHealthNews, fetchArticleContent, fetchArticleWithMeta } = require('./src/scrapers');
const { generateDailyContent, generateAIAnswer, generateDailyImage, generateAIImage } = require('./src/openai-service');
const { uploadToSupabase } = require('./src/supabase');
const { push, reply, lineMiddleware } = require('./src/line-client');

// --- Init directories ---
const GENERATED_DIR = path.join(__dirname, 'public', 'generated');
try { fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true }); } catch {}
try { fs.mkdirSync(GENERATED_DIR, { recursive: true }); } catch {}

const app = express();
app.use('/generated', express.static(GENERATED_DIR));

// --- Routes ---

app.get('/health', async (req, res) => {
  const state = await loadState();
  res.json({ ok: true, lastPush: state.lastDailyPushDate, ts: new Date().toISOString() });
});

app.post('/admin/daily-push', express.json(), async (req, res) => {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const force = req.body?.force === true;
  try {
    await runDailyPush(force);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/daily-push]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/line/webhook', lineMiddleware, (req, res) => {
  const events = req.body.events || [];
  Promise.all(events.map(handleEvent))
    .then(() => res.json({ ok: true }))
    .catch(err => { console.error('[webhook]', err.message); res.status(500).end(); });
});

// --- LINE event handler ---

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const src = event.source;
  const idLine = `[ID] userId=${src.userId} | groupId=${src.groupId || '-'} | roomId=${src.roomId || '-'}`;
  console.log(idLine);
  try { fs.appendFileSync(path.join(__dirname, 'data', 'ids.log'), idLine + '\n'); } catch {}

  const text = event.message.text.trim();
  if (!/^(請問ai:|問ai:|ai:)/i.test(text)) return;
  const question = text.replace(/^(請問ai:|問ai:|ai:)\s*/i, '').trim();
  if (!question) return;
  await handleAIRequest(event.source.userId, question, event.replyToken);
}

// --- AI response flow ---

async function handleAIRequest(userId, question, replyToken) {
  const state = await loadState();

  if (state.blockedUsers?.includes(userId)) {
    return reply(replyToken, { type: 'text', text: '您目前無法使用 AI 功能。' });
  }

  const today = todayStr();
  if (state.dailyAiDate !== today) {
    state.dailyAiCount = 0;
    state.dailyAiDate = today;
  }
  const quota = parseInt(process.env.DAILY_AI_QUOTA) || 3;

  if (state.dailyAiCount >= quota) {
    return reply(replyToken, {
      type: 'text',
      text: `今日 AI 圖文名額已用完（${quota} 次），明天再來！`
    });
  }

  try {
    const answer = await generateAIAnswer(question);
    const buf = await generateAIImage(question, answer);
    const imgUrl = await saveImage(buf, `ai-health-${Date.now()}.png`, `line-health/ai-health-${Date.now()}.png`);

    state.dailyAiCount += 1;
    await saveState(state);

    const remaining = quota - state.dailyAiCount;
    await reply(replyToken, [
      { type: 'image', originalContentUrl: imgUrl, previewImageUrl: imgUrl },
      { type: 'text', text: `今日 AI 圖文剩餘 ${remaining} 次` }
    ]);
  } catch (err) {
    console.error('[handleAIRequest]', err.message);
    await reply(replyToken, { type: 'text', text: '抱歉，AI 暫時無法使用，請稍後再試。' });
  }
}

// --- Daily push flow ---

let pushInProgress = false;

async function runDailyPush(force = false) {
  if (pushInProgress) { console.log('[daily-push] already running, skip'); return; }
  pushInProgress = true;

  try {
    const state = await loadState();
    const today = todayStr();

    if (!force && state.lastDailyPushDate === today) {
      console.log('[daily-push] already sent today');
      return;
    }

    // --- weeklyPlan: check if today has a scheduled article ---
    const plan = (state.weeklyPlan || []).find(p => p.date === today && !p.done);
    if (plan) {
      console.log(`[daily-push] weeklyPlan: ${plan.theme} -> ${plan.articleUrl}`);
      const meta = await fetchArticleWithMeta(plan.articleUrl);
      const article = {
        url: plan.articleUrl,
        title: meta.title || plan.theme,
        content: meta.content,
        source: 'scheduled'
      };
      const content = await generateDailyContent(article);
      if (plan.overrideTitle) content.hookTitle = plan.overrideTitle;
      const buf = await generateDailyImage(content);
      const imgUrl = await saveImage(buf, 'daily-latest.png', 'line-health/daily-health.png');
      await push(process.env.LINE_TARGET_CHAT_ID, { type: 'image', originalContentUrl: imgUrl, previewImageUrl: imgUrl });
      plan.done = true;
      state.lastDailyPushDate = today;
      state.recentNewsUrls = [plan.articleUrl, ...(state.recentNewsUrls || [])].slice(0, 30);
      state.lastDailyNewsTitle = article.title;
      state.lastDailyNewsUrl = plan.articleUrl;
      await saveState(state);
      console.log('[daily-push] done (scheduled):', article.title);
      return;
    }

    console.log('[daily-push] fetching articles...');
    const articles = await fetchHealthNews();
    const recentUrls = state.recentNewsUrls || [];
    const fresh = articles.filter(a => !recentUrls.includes(a.url));

    if (fresh.length === 0) {
      console.warn('[daily-push] no fresh articles found across all sources');
      return;
    }

    let candidate = fresh[0];
    const tf = state.topicFilter;
    if (tf && tf.until && tf.keywords && tf.until >= today) {
      const matched = fresh.find(a => tf.keywords.some(kw => a.title.includes(kw)));
      if (matched) {
        candidate = matched;
        console.log(`[daily-push] topic-filter matched: ${matched.title}`);
      } else {
        console.log(`[daily-push] topic-filter active (${tf.keywords.join(',')}) but no match, using first fresh`);
      }
    } else if (tf && tf.until && tf.until < today) {
      state.topicFilter = null;
      console.log('[daily-push] topic-filter expired, cleared');
    }

    const article = candidate;
    console.log(`[daily-push] selected: ${article.title} [${article.source}]`);
    article.content = await fetchArticleContent(article.url);

    const content = await generateDailyContent(article);
    const buf = await generateDailyImage(content);
    const imgUrl = await saveImage(buf, 'daily-latest.png', 'line-health/daily-health.png');

    await push(process.env.LINE_TARGET_CHAT_ID, {
      type: 'image',
      originalContentUrl: imgUrl,
      previewImageUrl: imgUrl
    });

    state.lastDailyPushDate = today;
    state.recentNewsUrls = [article.url, ...recentUrls].slice(0, 30);
    state.lastDailyNewsTitle = article.title;
    state.lastDailyNewsUrl = article.url;
    await saveState(state);

    console.log('[daily-push] done:', article.title);
  } finally {
    pushInProgress = false;
  }
}

// --- Helpers ---

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

async function saveImage(buffer, localName, remotePath) {
  try { fs.writeFileSync(path.join(GENERATED_DIR, localName), buffer); } catch {}
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return uploadToSupabase(buffer, remotePath);
  }
  return `${process.env.PUBLIC_BASE_URL}/generated/${localName}`;
}

// --- Scheduler ---

const [pushHour, pushMin] = (process.env.DAILY_PUSH_TIME || '08:00').split(':').map(Number);

cron.schedule(`${pushMin} ${pushHour} * * *`, () => {
  console.log('[cron] daily push triggered');
  runDailyPush().catch(err => console.error('[cron]', err.message));
}, { timezone: 'Asia/Taipei' });

// Startup catch-up: run push if service started after push time but within catch-up window
(async function catchUp() {
  const now = new Date();
  const pushTime = new Date();
  pushTime.setHours(pushHour, pushMin, 0, 0);
  const elapsedMin = (now - pushTime) / 60000;
  const windowMin = parseInt(process.env.DAILY_PUSH_CATCH_UP_MINUTES) || 180;

  if (elapsedMin >= 0 && elapsedMin <= windowMin) {
    const state = await loadState();
    if (state.lastDailyPushDate !== todayStr()) {
      console.log('[startup] catch-up push triggered');
      runDailyPush().catch(err => console.error('[startup]', err.message));
    }
  }
})();

// --- Start server ---

const PORT = parseInt(process.env.PORT) || 3919;
app.listen(PORT, () => {
  const mode = process.env.MOCK_MODE === 'true' ? ' [MOCK MODE]' : '';
  console.log(`[server] port ${PORT}${mode}`);
  console.log(`[server] daily push at ${process.env.DAILY_PUSH_TIME || '08:00'} Asia/Taipei`);
  console.log(`[server] webhook: POST /line/webhook`);
  console.log(`[server] admin:   POST /admin/daily-push  (x-admin-secret header)`);
  console.log(`[server] health:  GET  /health`);
});
