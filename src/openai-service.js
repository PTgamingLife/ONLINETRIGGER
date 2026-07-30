const OpenAI = require('openai');

// Minimal 1×1 transparent PNG for MOCK_MODE
const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

let _client = null;
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

const textModel  = () => process.env.OPENAI_TEXT_MODEL  || 'gpt-4o-mini';
const imageModel = () => process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const imageQuality = () => process.env.OPENAI_IMAGE_QUALITY || 'medium';

async function callTextJSON(prompt) {
  const res = await getClient().chat.completions.create({
    model: textModel(),
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' }
  });
  return JSON.parse(res.choices[0].message.content);
}

async function generateDailyContent(article) {
  if (process.env.MOCK_MODE === 'true') {
    return {
      hookTitle: '今晚早睡，明天更健康',
      risk: '長期睡眠不足影響免疫力及代謝機能，提高慢性病風險。',
      theory: '深度睡眠時身體修復細胞、整合記憶，是最佳自然療癒。',
      improve: '維持固定起床時間，睡前避免藍光，有助提升睡眠品質。',
      notice: '避免睡前攝取咖啡因，保持臥室涼爽黑暗，有助入睡。',
      cta: '健康從睡眠開始，每天充足休息是最好的投資。'
    };
  }

  const ctx = [`新聞標題：${article.title}`];
  if (article.content) ctx.push(`文章摘要：${article.content.slice(0, 300)}`);

  return callTextJSON(`你是台灣健康衛教專家，根據以下健康新聞整理出圖文資訊。

目標受眾：40-65歲父母、長輩、上班族（非孕婦）。
內容聚焦：慢性病預防、職場健康、家庭照護、中老年活力。
語氣：親切、實用、正向，避免醫療恐嚇。

${ctx.join('\n')}

請以 JSON 格式回覆（繁體中文，每欄位30字以內，不使用省略號）：
{
  "hookTitle": "吸睛標題（6-10個中文字，不直接複製新聞標題，貼近長輩或上班族生活）",
  "risk": "影響與風險（2-3句，提醒中老年人或久坐族常見問題）",
  "theory": "理論背景（2-3句，淺顯易懂；如果可以數據化證實，提出具體數據，例如：研究顯示 X% 的人...、每天增加 X 分鐘...）",
  "improve": "針對本文主題的解決方法（1-3點，若只有1-2個真正有效的方法，不要硬湊第三點；每點用「①②③」編號，每點必須直接回應本文主題、彼此不重複、包含具體數字或頻率；禁止出現「保持良好習慣」「均衡飲食」「規律運動」等無針對性的通用建議；格式：①...②...③...）",
  "notice": "如何注意（2-3句，適合長輩或上班族的生活提醒）",
  "cta": "為何持續關注健康（1-2句，強調家庭責任與自我照護）"
}`);
}

async function generateAIAnswer(question) {
  if (process.env.MOCK_MODE === 'true') {
    return {
      riskNotes: '有急性症狀請立即就醫，勿自行診斷。',
      improvements: '均衡飲食、適度運動、充足睡眠可有效改善。',
      nutrients: '維生素C、Omega-3、鎂、鋅',
      summary: '以上建議僅供參考，非醫療診斷，請諮詢專業醫師。'
    };
  }

  return callTextJSON(`你是結合傳統醫學與現代營養學的台灣健康顧問。
目標受眾：40-65歲父母、長輩、上班族（非孕婦）。
語氣：親切、簡單易懂、正向鼓勵，貼近家庭與職場日常。

用戶問題：${question}

請以 JSON 格式回覆（繁體中文，精簡）：
{
  "riskNotes": "須注意風險（保守表述，提醒就醫，2句，適合中老年或上班族）",
  "improvements": "改善可能（日常飲食與生活習慣，2句，具體可行）",
  "nutrients": "所需營養素（2-4種）",
  "summary": "免責聲明（1句，非醫療診斷）"
}

限制：不診斷、不開藥、不宣稱治癒。`);
}

async function generateDailyImage(content) {
  if (process.env.MOCK_MODE === 'true') return MOCK_PNG;

  const fullLayout = process.env.OPENAI_FULL_INFOGRAPHIC !== 'false';
  const prompt = fullLayout
    ? `繪製一張健康衛教圖文，繁體中文，專為 LINE 手機閱讀設計。受眾：40-65歲父母、長輩、上班族。

【上方主畫面】親切有活力的醫師或健康顧問形象（非孕婦相關），大標題：「${content.hookTitle}」，字體清晰不超出畫面，暖色調設計感。

【下方五格說明】
① 影響與風險：${content.risk}
② 理論背景：${content.theory}
③ 解決問題的三個方法：${content.improve}
④ 如何注意：${content.notice}
⑤ 持續關注：${content.cta}

設計規則：簡潔清晰、所有文字完整在畫面內、禁止使用「...」或「…」、適合手機閱讀、右下角小字標示「北醫健康管理師」。`
    : `健康衛教圖文，繁體中文，LINE手機版。受眾：父母長輩上班族。醫師教導形象，標題：${content.hookTitle}。含影響、改善、注意事項。文字不超出畫面。`;

  const res = await getClient().images.generate({
    model: imageModel(),
    prompt,
    size: '1024x1024',
    quality: imageQuality()
  });

  // gpt-image-2 returns b64_json by default; DALL-E may return URL
  if (res.data[0].b64_json) {
    return Buffer.from(res.data[0].b64_json, 'base64');
  }
  // fallback: download from URL
  const axios = require('axios');
  const imgRes = await axios.get(res.data[0].url, { responseType: 'arraybuffer' });
  return Buffer.from(imgRes.data);
}

async function generateAIImage(question, answer) {
  if (process.env.MOCK_MODE === 'true') return MOCK_PNG;

  const prompt = `繪製一張 Q 版大頭娃娃風格健康衛教圖，繁體中文，LINE手機閱讀。

【上方】可愛 Q 版醫師娃娃正在教導病人娃娃，友善活潑風格。

【下方三格】
① 須注意風險：${answer.riskNotes}
② 改善可能：${answer.improvements}
③ 所需營養素：${answer.nutrients}

底部小字：${answer.summary}

規則：所有文字完整在畫面內、不宣稱治療診斷、Q版大頭娃娃可愛風格。`;

  const res = await getClient().images.generate({
    model: imageModel(),
    prompt,
    size: '1024x1024',
    quality: imageQuality()
  });

  // gpt-image-2 returns b64_json by default; DALL-E may return URL
  if (res.data[0].b64_json) {
    return Buffer.from(res.data[0].b64_json, 'base64');
  }
  // fallback: download from URL
  const axios = require('axios');
  const imgRes = await axios.get(res.data[0].url, { responseType: 'arraybuffer' });
  return Buffer.from(imgRes.data);
}

module.exports = { generateDailyContent, generateAIAnswer, generateDailyImage, generateAIImage };
