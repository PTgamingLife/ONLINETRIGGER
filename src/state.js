const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'data', 'line-state.json');

const DEFAULTS = {
  lastDailyPushDate: null,
  recentNewsUrls: [],
  lastDailyNewsTitle: null,
  lastDailyNewsUrl: null,
  dailyAiCount: 0,
  dailyAiDate: null,
  blockedUsers: [],
  topicFilter: null,
  weeklyPlan: []
};

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function loadState() {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from('bot_state')
        .select('state')
        .eq('id', 1)
        .single();
      if (!error && data) return { ...DEFAULTS, ...data.state };
    } catch (e) {
      console.error('[state] Supabase load failed, using local fallback:', e.message);
    }
  }
  // Local file fallback
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function saveState(state) {
  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb
        .from('bot_state')
        .upsert({ id: 1, state, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      if (error) throw error;
      return;
    } catch (e) {
      console.error('[state] Supabase save failed, using local fallback:', e.message);
    }
  }
  // Local file fallback
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

module.exports = { loadState, saveState };
