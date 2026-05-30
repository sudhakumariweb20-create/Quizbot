// index.js  —  RankRiser247 Telegram Bot v2
require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const db = require('./db/supabase');
const { startQuiz, registerQuizHandlers } = require('./handlers/quiz');
const { registerAdminHandlers, isAdmin, getState, handleAdminText } = require('./handlers/admin');

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const QUESTIONS_PER_SESSION = parseInt(process.env.QUESTIONS_PER_SESSION || '10');

// ─────────────────────────────────────────────────────────────
//  EXAM CONFIG  (full mock — real exam pattern)
// ─────────────────────────────────────────────────────────────
const EXAMS = [
  {
    id: 1, name: 'SSC CGL Full Mock',
    zone: 'exam', category: 'ssc_cgl',
    duration: 120, questions: 100,
    price: 0, freeLimit: 3,
    description: '100Q · 120min · −0.25 marking',
  },
  {
    id: 2, name: 'Railway NTPC Full Mock',
    zone: 'exam', category: 'railway_ntpc',
    duration: 60, questions: 50,
    price: 0, freeLimit: 3,
    description: '50Q · 60min · −0.25 marking',
  },
  {
    id: 3, name: 'UPSC Prelims Full Mock',
    zone: 'exam', category: 'upsc',
    duration: 120, questions: 100,
    price: 49, freeLimit: 2,
    description: '100Q · 120min · −0.33 marking',
  },
  {
    id: 4, name: 'Bank PO Full Mock',
    zone: 'exam', category: 'bank_po',
    duration: 90, questions: QUESTIONS_PER_SESSION,
    price: 49, freeLimit: 2,
    description: `${QUESTIONS_PER_SESSION}Q · 90min · −0.25 marking`,
  },
];

// ─────────────────────────────────────────────────────────────
//  SUBJECT SETS CONFIG  (short, targeted, no timer)
// ─────────────────────────────────────────────────────────────
const SUBJECT_SETS = [
  { id: 'maths',         label: '🔢 Maths',         questions: 15 },
  { id: 'reasoning',     label: '🧠 Reasoning',     questions: 15 },
  { id: 'english',       label: '📖 English',       questions: 10 },
  { id: 'gk',            label: '🌍 GK',             questions: 15 },
  { id: 'current_affairs', label: '📰 Current Affairs', questions: 10 },
];

// ─────────────────────────────────────────────────────────────
//  CONTEST CONFIG
// ─────────────────────────────────────────────────────────────
const CONTESTS = [
  { id: 1, name: 'SSC Mega Contest #1', zone: 'contest', category: 'ssc_cgl',      prize: 1000, endsIn: '2h 15m', status: 'live',     entryFee: 0 },
  { id: 2, name: 'SSC Mega Contest #2', zone: 'contest', category: 'general',      prize: 2000, endsIn: '2h 15m', status: 'live',     entryFee: 0 },
  { id: 3, name: 'Railway GK Contest',  zone: 'contest', category: 'railway_ntpc', prize: 500,  endsIn: '5h',     status: 'upcoming', entryFee: 0 },
  { id: 4, name: 'UPSC Grand Contest',  zone: 'contest', category: 'upsc',         prize: 10000, endsIn: '1d',    status: 'upcoming', entryFee: 49 },
];

// ─────────────────────────────────────────────────────────────
//  USER HELPER
// ─────────────────────────────────────────────────────────────
async function ensureUser(ctx) {
  try {
    return await db.upsertUser({
      telegram_id: ctx.from.id,
      name: ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : ''),
      username: ctx.from.username || '',
    });
  } catch {
    if (!ctx.session.user) {
      ctx.session.user = {
        telegram_id: ctx.from.id,
        name: ctx.from.first_name,
        rank: 247, quizzes_played: 0, wins: 0, total_score: 0, wallet_balance: 0,
      };
    }
    return ctx.session.user;
  }
}

// ─────────────────────────────────────────────────────────────
//  /start
// ─────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  await ensureUser(ctx);
  const name = ctx.from.first_name;
  await ctx.reply(
    `👋 Welcome, *${name}*\\!\n\n🎯 *RankRiser247* — Compete, Learn & Win Real Prizes\\!\n\nChoose a section:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.keyboard([
        ['🏆 Contest Zone', '📚 Exam Zone'],
        ['⚔️ Battle Zone',  '👤 My Profile'],
        ['💰 My Wallet',    '🏅 Leaderboard'],
      ]).resize(),
    }
  );
});

// ─────────────────────────────────────────────────────────────
//  PROFILE
// ─────────────────────────────────────────────────────────────
bot.hears('👤 My Profile', (ctx) => showProfile(ctx));
bot.command('profile', (ctx) => showProfile(ctx));
bot.action('back_profile', (ctx) => { ctx.answerCbQuery(); showProfile(ctx); });

async function showProfile(ctx) {
  const u = await ensureUser(ctx);
  const text =
    `👤 *${u.name}*\n` +
    `🆔 ID: \`${u.telegram_id}\`\n\n` +
    `🏅 Rank: *#${u.rank || '—'}*\n` +
    `📝 Quizzes: *${u.quizzes_played || 0}*\n` +
    `🏆 Wins: *${u.wins || 0}*\n` +
    `⭐ Score: *${u.total_score || 0}*\n` +
    `💰 Wallet: *₹${u.wallet_balance || 0}*`;

  ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🏅 Achievements', 'achievements'), Markup.button.callback('💰 Wallet', 'wallet')],
      [Markup.button.callback('📊 My History', 'my_history')],
    ]),
  });
}

bot.action('achievements', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('🏅 *Your Achievements*\n\n• 🎯 First Quiz Completed\n• 📚 5 Exams Done\n• 🔥 3-Day Streak\n\n_More coming soon!_', { parse_mode: 'Markdown' });
});
bot.action('my_history', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('📊 _Your quiz history will appear here once you complete quizzes._', { parse_mode: 'Markdown' });
});

// ─────────────────────────────────────────────────────────────
//  WALLET
// ─────────────────────────────────────────────────────────────
bot.hears('💰 My Wallet', (ctx) => showWallet(ctx));
bot.action('wallet', (ctx) => { ctx.answerCbQuery(); showWallet(ctx); });

async function showWallet(ctx) {
  const u = await ensureUser(ctx);
  ctx.reply(
    `💰 *My Wallet*\n\nBalance: *₹${u.wallet_balance || 0}*\n\n_Winnings from contests are credited here._\n\n⚠️ Payment integration coming soon!`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add Money', 'add_money'), Markup.button.callback('➖ Withdraw', 'withdraw')],
      ]),
    }
  );
}
bot.action('add_money', (ctx) => { ctx.answerCbQuery(); ctx.reply('💳 Payment integration coming soon! (Razorpay/UPI)'); });
bot.action('withdraw',  (ctx) => { ctx.answerCbQuery(); ctx.reply('🏦 Withdrawal feature coming soon!'); });

// ─────────────────────────────────────────────────────────────
//  LEADERBOARD
// ─────────────────────────────────────────────────────────────
bot.hears('🏅 Leaderboard', async (ctx) => {
  try {
    const board = await db.getLeaderboard(10);
    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    let text = '🏅 *Top 10 Leaderboard*\n\n';
    if (!board.length) {
      text += '_No scores yet. Be the first to play!_';
    } else {
      board.forEach((u, i) => {
        text += `${medals[i]} *${u.name}* — ${u.total_score} pts (${u.wins} wins)\n`;
      });
    }
    ctx.reply(text, { parse_mode: 'Markdown' });
  } catch {
    ctx.reply('🏅 Leaderboard loading...');
  }
});

// ─────────────────────────────────────────────────────────────
//  EXAM ZONE  — Main entry
// ─────────────────────────────────────────────────────────────
bot.hears('📚 Exam Zone', (ctx) => showExamZoneHome(ctx));
bot.command('exams', (ctx) => showExamZoneHome(ctx));
bot.action('back_exams', (ctx) => { ctx.answerCbQuery(); showExamZoneHome(ctx); });

function showExamZoneHome(ctx) {
  const text =
    `📚 *Exam Zone*\n\n` +
    `Practice at your own pace — no pressure to join.\n` +
    `Focus on learning, improvement & real exam preparation.\n\n` +
    `Choose a mode:`;

  ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📋 Full Mock Tests', 'exam_mock_list')],
      [Markup.button.callback('📖 Subject-wise Practice', 'exam_subject_list')],
      [Markup.button.callback('📊 My Performance', 'exam_my_performance')],
    ]),
  });
}

// ─────────────────────────────────────────────────────────────
//  EXAM ZONE — Full Mock Test list
// ─────────────────────────────────────────────────────────────
bot.action('exam_mock_list', async (ctx) => {
  ctx.answerCbQuery();

  const freeExams = EXAMS.filter(e => e.price === 0);
  const paidExams = EXAMS.filter(e => e.price > 0);

  let text = `📋 *Full Mock Tests*\n_Same pattern as real exam · −0.25 negative marking_\n\n`;
  text += `🟢 *Free Mocks*\n`;
  freeExams.forEach(e => { text += `• ${e.name}\n  ${e.description} · ${e.freeLimit} free attempts\n`; });
  text += `\n🔒 *Premium Mocks*\n`;
  paidExams.forEach(e => { text += `• ${e.name}\n  ${e.description} · ₹${e.price} unlock\n`; });
  text += `\n_Tap an exam to start:_`;

  const buttons = EXAMS.map(e => {
    const isPaid = e.price > 0;
    const label = isPaid ? `🔒 ${e.name} (₹${e.price})` : `▶️ ${e.name}`;
    return [Markup.button.callback(label, `exam_start_${e.id}`)];
  });
  buttons.push([Markup.button.callback('🔙 Back', 'back_exams')]);

  ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// ─────────────────────────────────────────────────────────────
//  EXAM ZONE — Subject-wise practice (pick exam first)
// ─────────────────────────────────────────────────────────────
bot.action('exam_subject_list', (ctx) => {
  ctx.answerCbQuery();

  const text =
    `📖 *Subject-wise Practice*\n` +
    `_Short 10–15 question sets · No timer · Stress-free learning_\n\n` +
    `First, choose which exam you're preparing for:`;

  const buttons = EXAMS.map(e => [
    Markup.button.callback(e.name.replace(' Full Mock', ''), `exam_subj_pick_${e.id}`)
  ]);
  buttons.push([Markup.button.callback('🔙 Back', 'back_exams')]);

  ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// After choosing exam for subject practice, show subject list
bot.action(/exam_subj_pick_(\d+)/, (ctx) => {
  ctx.answerCbQuery();
  const examId = parseInt(ctx.match[1]);
  const exam = EXAMS.find(e => e.id === examId);
  if (!exam) return ctx.reply('Exam not found.');

  const text =
    `📖 *${exam.name.replace(' Full Mock', '')}* — Subject Practice\n\n` +
    `Choose a subject for your practice set:`;

  const buttons = SUBJECT_SETS.map(s => [
    Markup.button.callback(s.label, `exam_subj_start_${examId}_${s.id}`)
  ]);
  buttons.push([Markup.button.callback('🔙 Back', 'exam_subject_list')]);

  ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// Start a subject practice session
bot.action(/exam_subj_start_(\d+)_(\w+)/, async (ctx) => {
  ctx.answerCbQuery();
  const examId  = parseInt(ctx.match[1]);
  const subject = ctx.match[2];
  const exam    = EXAMS.find(e => e.id === examId);
  const subj    = SUBJECT_SETS.find(s => s.id === subject);
  if (!exam || !subj) return ctx.reply('Not found.');

  await startQuiz(ctx, {
    zone:     exam.zone,
    category: exam.category,
    subject:  subject,
    examName: `${exam.name.replace(' Full Mock', '')} — ${subj.label}`,
    count:    subj.questions,
    mode:     'auto',
    noTimer:  true,         // ← no time pressure for practice
    examType: 'subject',
  });
});

// ─────────────────────────────────────────────────────────────
//  EXAM ZONE — Start a full mock
// ─────────────────────────────────────────────────────────────
bot.action(/exam_start_(\d+)/, async (ctx) => {
  ctx.answerCbQuery();
  const id   = parseInt(ctx.match[1]);
  const exam = EXAMS.find(e => e.id === id);
  if (!exam) return ctx.reply('Exam not found.');

  // Premium check
  if (exam.price > 0) {
    const hasPremium = await db.hasPremiumAccess(ctx.from.id, exam.category).catch(() => false);
    if (!hasPremium) {
      // Check how many free attempts used
      const sessions = await db.getRecentSessions(ctx.from.id, { category: exam.category, limit: 20 }).catch(() => []);
      const mockSessions = sessions.filter(s => s.exam_type === 'mock');
      if (mockSessions.length >= exam.freeLimit) {
        return ctx.reply(
          `🔒 *${exam.name}*\n\n` +
          `You've used all *${exam.freeLimit} free attempts*.\n\n` +
          `Unlock unlimited attempts:\n` +
          `• ₹${exam.price} one-time unlock\n` +
          `• ₹99/month — all premium tests\n\n` +
          `_Payment integration coming soon!_`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('💳 Unlock for ₹' + exam.price, 'pay_exam_' + exam.id)],
              [Markup.button.callback('💎 ₹99/month All Access', 'pay_subscription')],
              [Markup.button.callback('🔙 Back', 'exam_mock_list')],
            ]),
          }
        );
      }
      // Still has free attempts
      const attemptsLeft = exam.freeLimit - mockSessions.length;
      await ctx.reply(
        `ℹ️ _Free attempt ${mockSessions.length + 1}/${exam.freeLimit}. ${attemptsLeft - 1} free attempt(s) remaining after this._`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  await startQuiz(ctx, {
    zone:     exam.zone,
    category: exam.category,
    examName: exam.name,
    count:    exam.questions,
    mode:     'auto',
    noTimer:  false,
    examType: 'mock',
  });
});

// Payment placeholders
bot.action(/pay_exam_(\d+)/, (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('💳 Payment integration coming soon! (Razorpay/UPI)');
});
bot.action('pay_subscription', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('💎 Subscription payment coming soon! (₹99/month — all premium tests)');
});

// ─────────────────────────────────────────────────────────────
//  EXAM ZONE — My Performance
// ─────────────────────────────────────────────────────────────
bot.action('exam_my_performance', async (ctx) => {
  ctx.answerCbQuery();

  const text =
    `📊 *My Performance*\n\n` +
    `Choose an exam to see your stats:`;

  const buttons = EXAMS.map(e => [
    Markup.button.callback(e.name.replace(' Full Mock', ''), `exam_perf_${e.category}`)
  ]);
  buttons.push([Markup.button.callback('🔙 Back', 'back_exams')]);

  ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/exam_perf_(\w+)/, async (ctx) => {
  ctx.answerCbQuery();
  const category = ctx.match[1];
  const exam = EXAMS.find(e => e.category === category);

  try {
    const sessions = await db.getRecentSessions(ctx.from.id, { category, limit: 10 });

    if (!sessions || sessions.length === 0) {
      return ctx.reply(
        `📊 *Performance: ${exam?.name || category}*\n\n_No attempts yet. Start a mock test to see your stats!_`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('▶️ Start Mock', `exam_start_${exam?.id || 1}`), Markup.button.callback('🔙 Back', 'exam_my_performance')]]),
        }
      );
    }

    const mockSessions    = sessions.filter(s => s.exam_type === 'mock' || !s.exam_type);
    const subjectSessions = sessions.filter(s => s.exam_type === 'subject');

    const avgAccuracy = mockSessions.length
      ? Math.round(mockSessions.reduce((sum, s) => sum + (s.accuracy_pct || 0), 0) / mockSessions.length)
      : 0;
    const bestAccuracy = mockSessions.length
      ? Math.max(...mockSessions.map(s => s.accuracy_pct || 0))
      : 0;

    // Improvement trend
    let trendLine = '';
    if (mockSessions.length >= 2) {
      const latest = mockSessions[0]?.accuracy_pct || 0;
      const prev   = mockSessions[1]?.accuracy_pct || 0;
      const diff   = latest - prev;
      trendLine = diff > 0
        ? `\n📈 *+${diff}%* improvement from last attempt!`
        : diff < 0
        ? `\n📉 *${diff}%* from last attempt — keep going!`
        : `\n➡️ Same as last attempt`;
    }

    // Subject breakdown
    const subjectPerf = await db.getSubjectPerformance(ctx.from.id, category).catch(() => []);
    const subjectMap = {};
    subjectPerf.forEach(s => {
      if (!s.subject) return;
      if (!subjectMap[s.subject]) subjectMap[s.subject] = [];
      subjectMap[s.subject].push(s.accuracy_pct || 0);
    });
    const subjectNames = { maths: 'Maths', reasoning: 'Reasoning', english: 'English', gk: 'GK', current_affairs: 'Current Affairs' };

    let subjectLine = '';
    Object.entries(subjectMap).forEach(([subj, accs]) => {
      const avg = Math.round(accs.reduce((a, b) => a + b, 0) / accs.length);
      const icon = avg >= 70 ? '💪' : avg >= 50 ? '🟡' : '⚠️';
      subjectLine += `${icon} ${subjectNames[subj] || subj}: *${avg}%*\n`;
    });

    let text =
      `📊 *Performance: ${exam?.name || category}*\n\n` +
      `📝 Total Attempts: *${mockSessions.length}*\n` +
      `📊 Avg Accuracy: *${avgAccuracy}%*\n` +
      `🏆 Best Score: *${bestAccuracy}%*\n` +
      trendLine + `\n\n`;

    if (subjectLine) {
      text += `*Subject-wise Avg:*\n${subjectLine}\n`;
    }

    text += `*Recent Attempts:*\n`;
    mockSessions.slice(0, 5).forEach((s, i) => {
      const date = new Date(s.played_at).toLocaleDateString('en-IN');
      text += `${i + 1}. ${s.accuracy_pct}% · ${s.score}/${s.total} · ${date}\n`;
    });

    ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('▶️ Start New Mock', `exam_start_${exam?.id || 1}`)],
        [Markup.button.callback('🔙 Back', 'exam_my_performance')],
      ]),
    });
  } catch (e) {
    console.error('Performance error:', e.message);
    ctx.reply('❌ Could not load performance data. Please try again.');
  }
});

// ─────────────────────────────────────────────────────────────
//  CONTEST ZONE
// ─────────────────────────────────────────────────────────────
bot.hears('🏆 Contest Zone', (ctx) => showContestMenu(ctx));
bot.command('contests', (ctx) => showContestMenu(ctx));

function showContestMenu(ctx) {
  ctx.reply('🏆 *Contest Zone*\n\nChoose a tab:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[
      Markup.button.callback('🔴 Live', 'contests_live'),
      Markup.button.callback('🗓 Upcoming', 'contests_upcoming'),
      Markup.button.callback('✅ Completed', 'contests_completed'),
    ]]),
  });
}

function showContestList(ctx, status) {
  const list = CONTESTS.filter(c => c.status === status);
  if (!list.length) return ctx.reply('No contests in this tab right now.');
  const buttons = list.map(c => [
    Markup.button.callback(`${c.name} — ₹${c.prize}`, `contest_detail_${c.id}`)
  ]);
  ctx.reply('Select a contest:', Markup.inlineKeyboard(buttons));
}

bot.action('contests_live',      (ctx) => { ctx.answerCbQuery(); showContestList(ctx, 'live'); });
bot.action('contests_upcoming',  (ctx) => { ctx.answerCbQuery(); showContestList(ctx, 'upcoming'); });
bot.action('contests_completed', (ctx) => { ctx.answerCbQuery(); ctx.reply('No completed contests yet.'); });

bot.action(/contest_detail_(\d+)/, (ctx) => {
  ctx.answerCbQuery();
  const c = CONTESTS.find(x => x.id === parseInt(ctx.match[1]));
  if (!c) return ctx.reply('Not found.');
  const text =
    `🏆 *${c.name}*\n\n💰 Prize Pool: *₹${c.prize}*\n⏰ Ends in: *${c.endsIn}*\n🎟 Entry: *${c.entryFee === 0 ? 'Free' : '₹' + c.entryFee}*`;
  const joinBtn = c.entryFee === 0
    ? Markup.button.callback('✅ Join & Start Quiz', `join_contest_${c.id}`)
    : Markup.button.callback(`💳 Pay ₹${c.entryFee} & Join`, `pay_contest_${c.id}`);
  ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[joinBtn], [Markup.button.callback('🔙 Back', 'contests_live')]]),
  });
});

bot.action(/join_contest_(\d+)/, async (ctx) => {
  ctx.answerCbQuery('Joining...');
  const c = CONTESTS.find(x => x.id === parseInt(ctx.match[1]));
  if (!c) return;
  await startQuiz(ctx, {
    zone: c.zone, category: c.category, examName: c.name, count: QUESTIONS_PER_SESSION, mode: 'auto',
  });
});

bot.action(/pay_contest_(\d+)/, (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('💳 Payment integration coming soon! (Razorpay/UPI)');
});

// ─────────────────────────────────────────────────────────────
//  BATTLE ZONE
// ─────────────────────────────────────────────────────────────
bot.hears('⚔️ Battle Zone', (ctx) => {
  ctx.reply('⚔️ *Battle Zone*\n\nChallenge a friend or get randomly matched!', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🎯 Quick Match', 'battle_random')],
      [Markup.button.callback('👥 Challenge Friend', 'battle_friend')],
      [Markup.button.callback('⚔️ Start Practice Battle', 'battle_practice')],
    ]),
  });
});

bot.action('battle_random', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('🔍 Finding opponent... (Matchmaking coming soon!)\n\nStarting Practice Battle instead:');
  setTimeout(() => startQuiz(ctx, { zone: 'battle', category: 'general', examName: 'Quick Battle', count: 5, mode: 'auto' }), 1000);
});

bot.action('battle_friend', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(`🔗 Share this link to challenge a friend:\n\n\`t.me/${ctx.botInfo?.username}?start=battle_${ctx.from.id}\``, { parse_mode: 'Markdown' });
});

bot.action('battle_practice', async (ctx) => {
  ctx.answerCbQuery();
  await startQuiz(ctx, { zone: 'battle', category: 'general', examName: 'Practice Battle', count: 5, mode: 'auto' });
});

// ─────────────────────────────────────────────────────────────
//  REGISTER HANDLERS
// ─────────────────────────────────────────────────────────────
registerQuizHandlers(bot);
registerAdminHandlers(bot);

// ─────────────────────────────────────────────────────────────
//  TEXT INPUT ROUTING
// ─────────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  if (isAdmin(ctx) && getState(ctx.from.id)) {
    return handleAdminText(ctx);
  }
});

// ─────────────────────────────────────────────────────────────
//  LAUNCH
// ─────────────────────────────────────────────────────────────
bot.launch();
console.log('✅ RankRiser247 Bot v2 started — Exam Zone v2 with mock tests, subject practice, performance analysis & retry');
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
