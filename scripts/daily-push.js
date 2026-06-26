require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { loadState, saveState } = require('../src/state');
const { fetchHealthNews, fetchArticleContent, fetchArticleWithMeta } = require('../src/scrapers');
const { generateDailyContent, generateDailyImage } = require('../src/openai-service');
const { uploadToSupabase } = require('../src/supabase');
const { push } = require('../src/line-client');

function todayStr() {
  // Always Taiwan time
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 10);
}

async function saveImage(buffer, remotePath) {
  // In GitHub Actions, always use Supabase Storage
  return uploadToSupabase(buffer, remotePath);
}

async function run() {
  const state = await loadState();
  const today = todayStr();
  const force = process.argv.includes('--force');

  console.log(`[daily-push] today=${today} lastPush=${state.lastDailyPushDate} force=${force}`);

  if (!force && state.lastDailyPushDate === today) {
    console.log('[daily-push] already sent today, exit');
    process.exit(0);
  }

  // weeklyPlan: check for scheduled article
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
    const imgUrl = await saveImage(buf, `line-health/daily-health-${today}.png`);
    await push(process.env.LINE_TARGET_CHAT_ID, {
      type: 'image',
      originalContentUrl: imgUrl,
      previewImageUrl: imgUrl
    });
    plan.done = true;
    state.lastDailyPushDate = today;
    state.recentNewsUrls = [plan.articleUrl, ...(state.recentNewsUrls || [])].slice(0, 30);
    state.lastDailyNewsTitle = article.title;
    state.lastDailyNewsUrl = plan.articleUrl;
    await saveState(state);
    console.log('[daily-push] done (scheduled):', article.title);
    return;
  }

  // Fallback: scrape fresh articles
  console.log('[daily-push] no weeklyPlan, fetching articles...');
  const articles = await fetchHealthNews();
  const recentUrls = state.recentNewsUrls || [];
  const fresh = articles.filter(a => !recentUrls.includes(a.url));

  if (fresh.length === 0) {
    console.error('[daily-push] no fresh articles found');
    process.exit(1);
  }

  const article = fresh[0];
  console.log(`[daily-push] selected: ${article.title}`);
  article.content = await fetchArticleContent(article.url);

  const content = await generateDailyContent(article);
  const buf = await generateDailyImage(content);
  const imgUrl = await saveImage(buf, `line-health/daily-health-${today}.png`);

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
}

run().catch(err => {
  console.error('[daily-push] fatal:', err.message);
  process.exit(1);
});
