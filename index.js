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
//  EXAM CONFIG
// ─────────────────────────────────────────────────────────────
const EXAMS = [
  { id: 1, name: 'SSC CGL Mock 2026', zone: 'exam', category: 'ssc_cgl',      duration: 120, questions: QUESTIONS_PER_SESSION, price: 0 },
  { id: 2, name: 'Railway NTPC',       zone: 'exam', category: 'railway_ntpc', duration: 60,  questions: QUESTIONS_PER_SESSION, price: 0 },
  { id: 3, name: 'Bank PO Full Mock',  zone: 'exam', category: 'bank_po',      duration: 90,  questions: QUESTIONS_PER_SESSION, price: 49 },
  { id: 4, name: 'UPSC Prelims Test',  zone: 'exam', category: 'upsc',         duration: 120, questions: QUESTIONS_PER_SESSION, price: 99 },
];

const CONTESTS = [
  { id: 1, name: 'SSC Mega Contest #1', zone: 'contest', category: 'ssc_cgl', prize: 1000, endsIn: '2h 15m', status: 'live', entryFee: 0 },
  { id: 2, name: 'SSC Mega Contest #2', zone: 'contest', category: 'general', prize: 2000, endsIn: '2h 15m', status: 'live', entryFee: 0 },
  { id: 3, name: 'Railway GK Contest',  zone: 'contest', category: 'railway_ntpc', prize: 500, endsIn: '5h', status: 'upcoming', entryFee: 0 },
  { id: 4, name: 'UPSC Grand Contest',  zone: 'contest', category: 'upsc',    prize: 10000, endsIn: '1d', status: 'upcoming', entryFee: 49 },
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
    // Fallback in-memory user
    if (!ctx.session.user) {
      ctx.session.user = {
        telegram_id: ctx.from.id,
        name: ctx.from.first_name,
        rank: 247,
        quizzes_played: 0,
        wins: 0,
        total_score: 0,
        wallet_balance: 0,
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
//  EXAM ZONE
// ─────────────────────────────────────────────────────────────
bot.hears('📚 Exam Zone', (ctx) => showExams(ctx));
bot.command('exams', (ctx) => showExams(ctx));
bot.action('back_exams', (ctx) => { ctx.answerCbQuery(); showExams(ctx); });

function showExams(ctx) {
  const free = EXAMS.filter(e => e.price === 0);
  const paid = EXAMS.filter(e => e.price > 0);

  let text = '📚 *Exam Zone*\n\n🟢 *Free Exams*\n';
  free.forEach(e => { text += `• ${e.name} — ${e.duration}min, ${e.questions}Q\n`; });
  text += '\n🔒 *Paid Exams*\n';
  paid.forEach(e => { text += `• ${e.name} — ${e.duration}min, ${e.questions}Q — ₹${e.price}\n`; });
  text += '\n_Tap an exam to start:_';

  const buttons = EXAMS.map(e => {
    const label = e.price === 0 ? `▶️ ${e.name}` : `🔒 ${e.name} (₹${e.price})`;
    return [Markup.button.callback(label, `exam_start_${e.id}`)];
  });

  ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

bot.action(/exam_start_(\d+)/, async (ctx) => {
  ctx.answerCbQuery();
  const id = parseInt(ctx.match[1]);
  const exam = EXAMS.find(e => e.id === id);
  if (!exam) return ctx.reply('Exam not found.');

  if (exam.price > 0) {
    return ctx.reply(
      `🔒 *${exam.name}* requires *₹${exam.price}*\n\n_Payment integration coming soon!_`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back_exams')]]) }
    );
  }

  await startQuiz(ctx, {
    zone: exam.zone,
    category: exam.category,
    examName: exam.name,
    count: exam.questions,
    mode: 'auto',
  });
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
    zone: c.zone,
    category: c.category,
    examName: c.name,
    count: QUESTIONS_PER_SESSION,
    mode: 'auto',
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
//  Routes text to admin handler if admin is in a flow,
//  otherwise ignores (main menu uses keyboard buttons)
// ─────────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  // If admin is in a flow, route to admin handler
  if (isAdmin(ctx) && getState(ctx.from.id)) {
    return handleAdminText(ctx);
  }
  // Otherwise ignore (all main actions use keyboard/inline buttons)
});

// ─────────────────────────────────────────────────────────────
//  LAUNCH
// ─────────────────────────────────────────────────────────────
bot.launch();
console.log('✅ RankRiser247 Bot v2 started with timer, skip, admin panel & Supabase');
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
