// db/supabase.js  —  All database operations
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─────────────────────────────────────────────────────────────
//  QUESTIONS
// ─────────────────────────────────────────────────────────────

/**
 * Fetch N random questions for a given zone & category
 * zone: 'exam' | 'contest' | 'battle'
 * category: 'ssc_cgl' | 'railway_ntpc' | 'bank_po' | 'upsc' | 'general'
 * subject: 'maths' | 'reasoning' | 'english' | 'gk' | 'current_affairs' (optional, for subject sets)
 * mode: 'auto' (random) | 'manual' (ordered by sort_order)
 */
async function getQuestions({ zone, category = null, subject = null, count = 25, mode = 'auto' }) {
  let query = supabase
    .from('questions')
    .select('*')
    .eq('zone', zone)
    .eq('is_active', true);

  if (category) query = query.eq('category', category);
  if (subject)  query = query.eq('subject', subject);

  if (mode === 'auto') {
    query = query.limit(count * 3);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) return getFallbackQuestions(zone, category, count);
    const shuffled = data.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  } else {
    query = query.order('sort_order', { ascending: true }).limit(count);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) return getFallbackQuestions(zone, category, count);
    return data;
  }
}

/**
 * Fetch only the questions a user got wrong in a previous session (for retry)
 */
async function getQuestionsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .in('id', ids);
  if (error) throw error;
  return data || [];
}

async function getQuestionById(id) {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function addQuestion({ zone, category, subject = null, question, options, correct_index, explanation, sort_order = 0 }) {
  const { data, error } = await supabase
    .from('questions')
    .insert([{ zone, category, subject, question, options, correct_index, explanation, sort_order, is_active: true }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateQuestion(id, updates) {
  const { data, error } = await supabase
    .from('questions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteQuestion(id) {
  const { error } = await supabase.from('questions').delete().eq('id', id);
  if (error) throw error;
}

async function toggleQuestion(id, is_active) {
  return updateQuestion(id, { is_active });
}

async function listQuestions({ zone, category, page = 1, limit = 10 }) {
  const from = (page - 1) * limit;
  let query = supabase
    .from('questions')
    .select('id, zone, category, subject, question, is_active, sort_order', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (zone) query = query.eq('zone', zone);
  if (category) query = query.eq('category', category);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data, total: count, page, limit };
}

async function countQuestions({ zone, category, subject } = {}) {
  let query = supabase.from('questions').select('*', { count: 'exact', head: true }).eq('is_active', true);
  if (zone)     query = query.eq('zone', zone);
  if (category) query = query.eq('category', category);
  if (subject)  query = query.eq('subject', subject);
  const { count, error } = await query;
  if (error) throw error;
  return count;
}

// ─────────────────────────────────────────────────────────────
//  USERS
// ─────────────────────────────────────────────────────────────

async function upsertUser({ telegram_id, name, username }) {
  const { data, error } = await supabase
    .from('users')
    .upsert({ telegram_id, name, username, last_seen: new Date().toISOString() },
             { onConflict: 'telegram_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getUser(telegram_id) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegram_id)
    .single();
  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

async function updateUserStats(telegram_id, { quizzes_delta = 0, wins_delta = 0, score_delta = 0 }) {
  const { data, error } = await supabase.rpc('update_user_stats', {
    p_telegram_id: telegram_id,
    p_quizzes: quizzes_delta,
    p_wins: wins_delta,
    p_score: score_delta,
  });
  if (error) throw error;
  return data;
}

async function getLeaderboard(limit = 10) {
  const { data, error } = await supabase
    .from('users')
    .select('name, username, total_score, quizzes_played, wins')
    .order('total_score', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────────────────────────
//  SESSIONS (quiz history)
// ─────────────────────────────────────────────────────────────

async function saveSession({ telegram_id, zone, category, subject, exam_type, score, total, wrong, time_taken_sec, skipped, wrong_question_ids, accuracy_pct }) {
  const { data, error } = await supabase.from('quiz_sessions').insert([{
    telegram_id, zone, category,
    subject:           subject || null,
    exam_type:         exam_type || 'mock',   // 'mock' | 'subject'
    score, total, wrong, skipped,
    time_taken_sec,
    wrong_question_ids: wrong_question_ids || [],
    accuracy_pct:      accuracy_pct || 0,
    played_at:         new Date().toISOString(),
  }]).select().single();
  if (error) throw error;
  return data;
}

/**
 * Get recent sessions for a user to compute performance analysis
 * Returns last N sessions for a given category
 */
async function getRecentSessions(telegram_id, { category = null, limit = 5 } = {}) {
  let query = supabase
    .from('quiz_sessions')
    .select('*')
    .eq('telegram_id', telegram_id)
    .eq('zone', 'exam')
    .order('played_at', { ascending: false })
    .limit(limit);
  if (category) query = query.eq('category', category);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Get subject-level performance breakdown for a user
 */
async function getSubjectPerformance(telegram_id, category) {
  const { data, error } = await supabase
    .from('quiz_sessions')
    .select('subject, accuracy_pct, played_at')
    .eq('telegram_id', telegram_id)
    .eq('category', category)
    .eq('zone', 'exam')
    .not('subject', 'is', null)
    .order('played_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

/**
 * Check if user has premium access for a category
 * Looks for a row in user_purchases table
 */
async function hasPremiumAccess(telegram_id, category) {
  try {
    const { data, error } = await supabase
      .from('user_purchases')
      .select('id, expires_at')
      .eq('telegram_id', telegram_id)
      .or(`category.eq.${category},category.eq.all`)
      .single();
    if (error) return false;
    if (!data) return false;
    // Check subscription expiry if present
    if (data.expires_at && new Date(data.expires_at) < new Date()) return false;
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
//  FALLBACK (in-memory questions if DB is empty)
// ─────────────────────────────────────────────────────────────

const FALLBACK = {
  ssc_cgl: [
    { id:'f1', question:'Who is the current President of India?', options:['Ram Nath Kovind','Droupadi Murmu','Pranab Mukherjee','A P J Abdul Kalam'], correct_index:1, explanation:'Droupadi Murmu became the 15th President of India on 25 July 2022.', subject:'gk' },
    { id:'f2', question:'Which article abolishes untouchability?', options:['Article 14','Article 17','Article 21','Article 25'], correct_index:1, explanation:'Article 17 abolishes untouchability in any form.', subject:'gk' },
    { id:'f3', question:'What is the SI unit of electric current?', options:['Volt','Watt','Ohm','Ampere'], correct_index:3, explanation:'Ampere (A) is the SI base unit of electric current.', subject:'gk' },
    { id:'f4', question:'The Battle of Plassey was fought in?', options:['1756','1757','1761','1764'], correct_index:1, explanation:'The Battle of Plassey was fought on 23 June 1757.', subject:'gk' },
    { id:'f5', question:'Who wrote "Discovery of India"?', options:['Mahatma Gandhi','Bal Gangadhar Tilak','Jawaharlal Nehru','Subhas Chandra Bose'], correct_index:2, explanation:'Nehru wrote it while imprisoned at Ahmednagar Fort in 1944.', subject:'gk' },
    { id:'f6', question:'The largest planet in our Solar System?', options:['Saturn','Uranus','Neptune','Jupiter'], correct_index:3, explanation:'Jupiter is the largest planet in the Solar System.', subject:'gk' },
    { id:'f7', question:'Chemical formula of common salt?', options:['NaOH','Na₂CO₃','NaCl','NaHCO₃'], correct_index:2, explanation:'Common salt is Sodium Chloride (NaCl).', subject:'gk' },
    { id:'f8', question:'Father of the Indian Constitution?', options:['Mahatma Gandhi','Jawaharlal Nehru','Sardar Patel','B R Ambedkar'], correct_index:3, explanation:'Dr. B R Ambedkar chaired the Drafting Committee.', subject:'gk' },
    { id:'f9', question:'Speed of light is approximately?', options:['3×10⁶ m/s','3×10⁸ m/s','3×10¹⁰ m/s','3×10⁴ m/s'], correct_index:1, explanation:'Speed of light in vacuum ≈ 3 × 10⁸ m/s.', subject:'maths' },
    { id:'f10', question:'Photosynthesis takes place in?', options:['Root','Stem','Chloroplast','Mitochondria'], correct_index:2, explanation:'Photosynthesis occurs in chloroplasts.', subject:'gk' },
  ],
  railway_ntpc: [
    { id:'r1', question:'Indian Railways was nationalised in?', options:['1947','1950','1951','1952'], correct_index:2, explanation:'Indian Railways was nationalized in 1951.', subject:'gk' },
    { id:'r2', question:'First railway in India ran between?', options:['Delhi to Agra','Bombay to Thane','Calcutta to Delhi','Madras to Bangalore'], correct_index:1, explanation:'India\'s first railway ran Bombay–Thane on 16 April 1853.', subject:'gk' },
    { id:'r3', question:'IRCTC stands for?', options:['Indian Railway Catering and Tourism Corporation','Indian Rail Central Ticketing Commission','Indian Railway Commerce and Travel Corporation','Integrated Rail Catering and Travel Centre'], correct_index:0, explanation:'IRCTC = Indian Railway Catering and Tourism Corporation.', subject:'gk' },
    { id:'r4', question:'Longest railway platform in the world?', options:['Gorakhpur, India','Kollam, India','Shanghai, China','Tokyo, Japan'], correct_index:0, explanation:'Gorakhpur station holds the Guinness record at 1,366 metres.', subject:'gk' },
    { id:'r5', question:'Railway Budget merged with Union Budget in?', options:['2014','2016','2017','2019'], correct_index:2, explanation:'Merged in 2017, ending a 92-year-old tradition.', subject:'gk' },
  ],
  bank_po: [
    { id:'b1', question:'RBI was established in?', options:['1930','1935','1947','1949'], correct_index:1, explanation:'RBI was established on 1 April 1935.', subject:'gk' },
    { id:'b2', question:'NEFT stands for?', options:['National Electronic Funds Transfer','New Era Financial Transaction','National Express Fund Transfer','Net Electronic Financial Transfer'], correct_index:0, explanation:'NEFT = National Electronic Funds Transfer.', subject:'gk' },
    { id:'b3', question:'CRR stands for?', options:['Cash Reserve Ratio','Central Reserve Rate','Credit Reserve Ratio','Currency Reserve Rate'], correct_index:0, explanation:'CRR = Cash Reserve Ratio; banks keep this % with RBI.', subject:'gk' },
    { id:'b4', question:'Largest public sector bank in India?', options:['Punjab National Bank','Bank of Baroda','State Bank of India','Canara Bank'], correct_index:2, explanation:'SBI is the largest public sector bank in India.', subject:'gk' },
    { id:'b5', question:'UPI was launched by?', options:['RBI','SEBI','NPCI','IRDAI'], correct_index:2, explanation:'UPI launched by NPCI in 2016.', subject:'gk' },
  ],
  upsc: [
    { id:'u1', question:'42nd Amendment added which words to Preamble?', options:['Sovereign, Democratic','Socialist, Secular, Integrity','Justice, Liberty','Fraternity, Unity'], correct_index:1, explanation:'42nd Amendment (1976) added Socialist, Secular, and Integrity.', subject:'gk' },
    { id:'u2', question:'"Heart and Soul" of the Constitution?', options:['Right to Equality','Right to Freedom','Right to Constitutional Remedies','Right against Exploitation'], correct_index:2, explanation:'Ambedkar called Article 32 the Heart and Soul of the Constitution.', subject:'gk' },
    { id:'u3', question:'Judicial Review borrowed from?', options:['UK','USA','Canada','Australia'], correct_index:1, explanation:'Judicial Review was borrowed from the USA Constitution.', subject:'gk' },
    { id:'u4', question:'First National Park in India?', options:['Kaziranga','Corbett','Gir Forest','Bandipur'], correct_index:1, explanation:'Jim Corbett National Park (1936) was India\'s first national park.', subject:'gk' },
    { id:'u5', question:'Chipko Movement was related to?', options:['Water conservation','Forest conservation','Soil conservation','Wildlife protection'], correct_index:1, explanation:'Chipko Movement (1973) was a forest conservation movement.', subject:'gk' },
  ],
  general: [
    { id:'g1', question:'FIFA World Cup 2022 winner?', options:['France','Brazil','Argentina','Germany'], correct_index:2, explanation:'Argentina won FIFA World Cup 2022 in Qatar.', subject:'current_affairs' },
    { id:'g2', question:'2024 Olympics were held in?', options:['Tokyo','London','Paris','Los Angeles'], correct_index:2, explanation:'Paris hosted the 2024 Summer Olympics.', subject:'current_affairs' },
    { id:'g3', question:'Chandrayaan-3 landed on Moon in?', options:['June 2023','July 2023','August 2023','September 2023'], correct_index:2, explanation:'Chandrayaan-3 landed on 23 August 2023.', subject:'current_affairs' },
    { id:'g4', question:'G20 Summit 2023 was hosted by?', options:['China','USA','India','Brazil'], correct_index:2, explanation:'India hosted G20 Summit 2023 in New Delhi.', subject:'current_affairs' },
    { id:'g5', question:'India\'s first indigenous aircraft carrier?', options:['INS Vikrant','INS Viraat','INS Vikramaditya','INS Arihant'], correct_index:0, explanation:'INS Vikrant was commissioned on 2 September 2022.', subject:'gk' },
  ],
};

function getFallbackQuestions(zone, category, count) {
  const key = category || 'general';
  const pool = FALLBACK[key] || FALLBACK.general;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

module.exports = {
  supabase,
  getQuestions, getQuestionsByIds, getQuestionById,
  addQuestion, updateQuestion, deleteQuestion, toggleQuestion, listQuestions, countQuestions,
  upsertUser, getUser, updateUserStats, getLeaderboard,
  saveSession, getRecentSessions, getSubjectPerformance, hasPremiumAccess,
  getFallbackQuestions,
};
