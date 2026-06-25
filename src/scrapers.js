const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (compatible; HealthBot/1.0)';
const TIMEOUT = 12000;

const SOURCES = [
  {
    name: 'edh',
    listUrl: 'https://edh.tw/',
    baseUrl: 'https://edh.tw',
    selectors: ['a[href*="/page/"]', '.article-title a', 'h2 a', 'h3 a', 'article a']
  },
  {
    name: 'healthnews',
    listUrl: 'https://www.healthnews.com.tw/category/healthyliving/',
    baseUrl: 'https://www.healthnews.com.tw',
    selectors: ['.article-title a', '.news-title a', 'h3 a', 'h2 a', '.entry-title a']
  },
  {
    name: 'heho',
    listUrl: 'https://heho.com.tw/archives/category/health',
    baseUrl: 'https://heho.com.tw',
    selectors: ['.entry-title a', 'h2.post-title a', 'article h2 a', 'h3 a', '.post-title a']
  }
];

// Reject pure-navigation link titles
const NAV_RE = /^(健康|最新|更多|關於|首頁|分類|標籤|close|menu|search|\s*)$/i;

async function fetchFromSource(src) {
  if (process.env.MOCK_MODE === 'true') {
    return [
      { title: `【模擬】改善睡眠品質的 5 個方法`, url: `https://example.com/${src.name}/1`, source: src.name },
      { title: `【模擬】每天走路 30 分鐘的好處`, url: `https://example.com/${src.name}/2`, source: src.name }
    ];
  }

  try {
    const { data } = await axios.get(src.listUrl, {
      timeout: TIMEOUT,
      headers: { 'User-Agent': UA }
    });
    const $ = cheerio.load(data);
    const articles = [];
    const seen = new Set();

    for (const sel of src.selectors) {
      $(sel).each((_, el) => {
        if (articles.length >= 8) return false;
        const $el = $(el);
        const isAnchor = $el.is('a');
        const href = isAnchor ? $el.attr('href') : $el.find('a').first().attr('href');
        const title = (isAnchor ? $el : $el.find('a').first()).text().trim();

        if (!href || !title || title.length < 6 || title.length > 90) return;
        if (NAV_RE.test(title)) return;

        const url = href.startsWith('http') ? href : `${src.baseUrl}${href}`;
        if (seen.has(url) || !url.startsWith('http')) return;
        seen.add(url);
        articles.push({ title, url, source: src.name });
      });
      if (articles.length >= 3) break;
    }

    console.log(`[scraper:${src.name}] ${articles.length} articles`);
    return articles;
  } catch (err) {
    console.error(`[scraper:${src.name}] error: ${err.message}`);
    return [];
  }
}

async function fetchHealthNews() {
  const results = await Promise.allSettled(SOURCES.map(fetchFromSource));
  const bySource = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  // Interleave sources so variety rotates between EDH / healthnews / heho
  const result = [];
  const maxLen = Math.max(...bySource.map(a => a.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const src of bySource) {
      if (src[i]) result.push(src[i]);
    }
  }
  return result;
}

async function fetchArticleContent(url) {
  if (process.env.MOCK_MODE === 'true') return '';

  try {
    const { data } = await axios.get(url, {
      timeout: TIMEOUT,
      headers: { 'User-Agent': UA }
    });
    const $ = cheerio.load(data);
    $('script, style, nav, header, footer, aside, .ad, .advertisement').remove();

    const selectors = [
      '.article-content', '.entry-content', '.post-content',
      '.content-body', 'article .body', 'article'
    ];
    for (const sel of selectors) {
      const text = $(sel).text().replace(/\s+/g, ' ').trim();
      if (text.length > 200) return text.slice(0, 800);
    }
    return '';
  } catch (err) {
    console.error('[fetchArticleContent]', err.message);
    return '';
  }
}

// Fetch MSN article via content API (MSN is JS-rendered; static HTML has no content)
async function fetchMsnArticle(url) {
  // Extract article ID from URL: ar-AA25hiJ8 -> AA25hiJ8
  const match = url.match(/ar-([A-Za-z0-9]+)(?:[?#]|$)/);
  if (!match) throw new Error('Cannot extract MSN article ID from URL: ' + url);
  const articleId = match[1];
  const apiUrl = `https://assets.msn.com/content/view/v2/Detail/zh-tw/${articleId}`;
  const { data } = await axios.get(apiUrl, {
    timeout: TIMEOUT,
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  });
  const title = data.title || '';
  // Strip HTML tags from body to get plain text
  const bodyHtml = data.body || data.abstract || '';
  const content = bodyHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
  return { title, content };
}

// Fetch title + content from a specific article URL (for weeklyPlan scheduled articles)
async function fetchArticleWithMeta(url) {
  if (process.env.MOCK_MODE === 'true') return { title: '【模擬文章】', content: '' };
  try {
    // MSN articles require API access (JS-rendered, not scrapeable via HTML)
    if (url.includes('msn.com')) {
      return await fetchMsnArticle(url);
    }

    const { data } = await axios.get(url, { timeout: TIMEOUT, headers: { 'User-Agent': UA } });
    const $ = cheerio.load(data);
    $('script, style, nav, header, footer, aside, .ad, .advertisement').remove();

    // Extract title
    const title =
      $('h1.entry-title').text().trim() ||
      $('h1.post-title').text().trim() ||
      $('h1').first().text().trim() ||
      $('title').text().replace(/[-|].*$/, '').trim() ||
      '';

    // Extract body
    let content = '';
    for (const sel of ['.article-content', '.entry-content', '.post-content', '.content-body', 'article']) {
      const text = $(sel).text().replace(/\s+/g, ' ').trim();
      if (text.length > 200) { content = text.slice(0, 800); break; }
    }
    return { title, content };
  } catch (err) {
    console.error('[fetchArticleWithMeta]', err.message);
    return { title: '', content: '' };
  }
}

module.exports = { fetchHealthNews, fetchArticleContent, fetchArticleWithMeta };
