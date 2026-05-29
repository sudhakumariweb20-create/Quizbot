const { Telegraf, Markup, session } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// ─── Mock data (replace with DB queries) ────────────────────────────────────
const CONTESTS = [
  { id: 1, name: 'SSC Mega Contest #1', prize: 1000, endsIn: '2h 15m', status: 'live', entryFee: 0 },
  { id: 2, name: 'SSC Mega Contest #2', prize: 2000, endsIn: '2h 15m', status: 'live', entryFee: 0 },
  { id: 3, name: 'Railway GK Contest', prize: 500, endsIn: '5h 00m', status: 'upcoming', entryFee: 0 },
  { id: 4, name: 'UPSC Grand Contest', prize: 10000, endsIn: '1d 2h', status: 'upcoming', entryFee: 49 },
];

const EXAMS = [
  { id: 1, name: 'SSC CGL Mock 2026', duration: 120, questions: 100, price: 0 },
  { id: 2, name: 'Railway NTPC',       duration: 60,  questions: 50,  price: 0 },
  { id: 3, name: 'Bank PO Full Mock',  duration: 90,  questions: 80,  price: 49 },
  { id: 4, name: 'UPSC Prelims Test',  duration: 120, questions: 100, price: 99 },
];

const SAMPLE_QUESTIONS = [
  { question: 'Who is the President of India (2024)?', options: ['Ram Nath Kovind', 'Droupadi Murmu', 'Pranab Mukherjee', 'A P J Abdul Kalam'], correct: 1 },
  { question: 'Which state has the highest literacy rate?', options: ['Goa', 'Mizoram', 'Kerala', 'Delhi'], correct: 2 },
  { question: 'Full form of SSC?', options: ['Staff Selection Commission', 'State Selection Committee', 'Service Sector Corporation', 'None'], correct: 0 },
];

// ─── User state helper ───────────────────────────────────────────────────────
function getUser(ctx) {
  if (!ctx.session.user) {
    ctx.session.user = {
      id: ctx.from.id,
      name: ctx.from.first_name,
      rank: Math.floor(Math.random() * 500) + 1,
      quizzes: Math.floor(Math.random() * 150),
      wins: Math.floor(Math.random() * 80),
      walletBalance: 250,
      achievements: ['First Quiz 🏅', '10 Wins 🥈', 'Top 500 🏆'],
    };
  }
  return ctx.session.user;
}

// ─── /start ──────────────────────────────────────────────────────────────────
bot.start((ctx) => {
  const name = ctx.from.first_name;
  ctx.reply(
    `👋 Welcome, *${name}*\\!\n\nYou're on *RankRiser247* — compete, learn, and win real prizes\\.\n\nChoose a section below:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.keyboard([
        ['🏆 Contest Zone', '📚 Exam Zone'],
        ['⚔️ Battle Zone',  '👤 My Profile'],
        ['💰 My Wallet',    '🔔 Notifications'],
      ]).resize(),
    }
  );
});

// ─── PROFILE ─────────────────────────────────────────────────────────────────
bot.hears('👤 My Profile', (ctx) => showProfile(ctx));
bot.command('profile', (ctx) => showProfile(ctx));

function showProfile(ctx) {
  const u = getUser(ctx);
  const text =
    `👤 *${u.name}*\n` +
    `📧 ID: \`${u.id}\`\n\n` +
    `🏅 Rank: *#${u.rank}*\n` +
    `📝 Quizzes: *${u.quizzes}*\n` +
    `🏆 Wins: *${u.wins}*\n` +
    `💰 Wallet: *₹${u.walletBalance}*`;
  ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🏅 Achievements', 'achievements')],
      [Markup.button.callback('💰 My Wallet', 'wallet')],
      [Markup.button.callback('📊 My Stats', 'stats')],
    ]),
  });
}

bot.action('achievements', (ctx) => {
  const u = getUser(ctx);
  ctx.answerCbQuery();
  ctx.reply('🏅 *Your Achievements*\n\n' + u.achievements.map(a => `• ${a}`).join('\n'), { parse_mode: 'Markdown' });
});

bot.action('wallet', (ctx) => showWallet(ctx));
bot.hears('💰 My Wallet', (ctx) => showWallet(ctx));

function showWallet(ctx) {
  const u = getUser(ctx);
  ctx.answerCbQuery?.();
  ctx.reply(
    `💰 *My Wallet*\n\nBalance: *₹${u.walletBalance}*\n\nRecent transactions:\n• Won SSC Contest — +₹500\n• Exam purchase — -₹49\n• Withdrawal — -₹200`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add Money', 'add_money'), Markup.button.callback('➖ Withdraw', 'withdraw')],
      ]),
    }
  );
}

bot.action('add_money', (ctx) => { ctx.answerCbQuery(); ctx.reply('💳 Enter amount to add (e.g. 100):\nUPI • Cards • Net Banking supported'); });
bot.action('withdraw', (ctx) => { ctx.answerCbQuery(); ctx.reply('🏦 Enter amount to withdraw to your bank/UPI:'); });

// ─── CONTEST ZONE ─────────────────────────────────────────────────────────────
bot.hears('🏆 Contest Zone', (ctx) => showContestMenu(ctx));
bot.command('contests', (ctx) => showContestMenu(ctx));

function showContestMenu(ctx) {
  ctx.reply(
    '🏆 *Contest Zone*\n\nChoose a tab:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🔴 Live', 'contests_live'),
          Markup.button.callback('🗓 Upcoming', 'contests_upcoming'),
          Markup.button.callback('✅ Completed', 'contests_completed'),
        ],
      ]),
    }
  );
}

function formatContestList(contests, ctx) {
  if (!contests.length) return ctx.reply('No contests in this tab right now.');
  const buttons = contests.map(c => {
    const label = `${c.name} — ₹${c.prize} Prize`;
    return [Markup.button.callback(label, `contest_detail_${c.id}`)];
  });
  ctx.reply('Tap a contest to view details:', Markup.inlineKeyboard(buttons));
}

bot.action('contests_live', (ctx) => {
  ctx.answerCbQuery();
  formatContestList(CONTESTS.filter(c => c.status === 'live'), ctx);
});
bot.action('contests_upcoming', (ctx) => {
  ctx.answerCbQuery();
  formatContestList(CONTESTS.filter(c => c.status === 'upcoming'), ctx);
});
bot.action('contests_completed', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('No completed contests to show yet. Check back later!');
});

// Contest detail
bot.action(/contest_detail_(\d+)/, (ctx) => {
  ctx.answerCbQuery();
  const id = parseInt(ctx.match[1]);
  const c = CONTESTS.find(x => x.id === id);
  if (!c) return ctx.reply('Contest not found.');

  const text =
    `🏆 *${c.name}*\n\n` +
    `💰 Prize Pool: *₹${c.prize}*\n` +
    `⏰ Ends in: *${c.endsIn}*\n` +
    `🎟 Entry: *${c.entryFee === 0 ? 'Free' : '₹' + c.entryFee}*`;

  const joinBtn = c.entryFee === 0
    ? Markup.button.callback('✅ Join Now (Free)', `join_contest_${c.id}`)
    : Markup.button.callback(`💳 Pay ₹${c.entryFee} & Join`, `pay_contest_${c.id}`);

  ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[joinBtn], [Markup.button.callback('🔙 Back', 'contests_live')]]),
  });
});

bot.action(/join_contest_(\d+)/, (ctx) => {
  ctx.answerCbQuery('Joining contest...');
  const id = parseInt(ctx.match[1]);
  const c = CONTESTS.find(x => x.id === id);
  ctx.reply(`✅ You've joined *${c.name}*\\!\n\nThe quiz will start when the contest begins\\. You'll be notified\\.`, { parse_mode: 'MarkdownV2' });
  // In production: save to DB, check for contest start, send questions via sendPoll
});

bot.action(/pay_contest_(\d+)/, (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('💳 Payment integration required\\.\n\nUse Telegraf Payments API with your Razorpay/PayU provider key to charge the entry fee\\. See `telegraf\\.js` payments docs\\.', { parse_mode: 'MarkdownV2' });
  // In production: ctx.replyWithInvoice({ title, description, payload, provider_token, currency: 'INR', prices })
});

// ─── EXAM ZONE ───────────────────────────────────────────────────────────────
bot.hears('📚 Exam Zone', (ctx) => showExams(ctx));
bot.command('exams', (ctx) => showExams(ctx));

function showExams(ctx) {
  const free = EXAMS.filter(e => e.price === 0);
  const paid = EXAMS.filter(e => e.price > 0);

  let text = '📚 *Exam Zone*\n\n';
  text += '🟢 *Free Exams*\n';
  free.forEach(e => { text += `• ${e.name} — ${e.duration}min, ${e.questions}Q\n`; });
  text += '\n🔒 *Paid Exams*\n';
  paid.forEach(e => { text += `• ${e.name} — ${e.duration}min, ${e.questions}Q — ₹${e.price}\n`; });

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
      `🔒 *${exam.name}* requires payment of ₹${exam.price}\\.`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([[Markup.button.callback(`💳 Pay ₹${exam.price}`, `pay_exam_${exam.id}`)]]),
      }
    );
  }

  // Start free exam
  ctx.session.exam = { examId: id, questionIndex: 0, score: 0, total: SAMPLE_QUESTIONS.length };
  await ctx.reply(`📝 Starting *${exam.name}*\n\n${exam.questions} questions • ${exam.duration} minutes\n\nGood luck! 🍀`, { parse_mode: 'Markdown' });
  sendQuestion(ctx);
});

async function sendQuestion(ctx) {
  const { questionIndex } = ctx.session.exam;
  if (questionIndex >= SAMPLE_QUESTIONS.length) return endExam(ctx);

  const q = SAMPLE_QUESTIONS[questionIndex];
  await ctx.replyWithPoll(
    `Q${questionIndex + 1}: ${q.question}`,
    q.options,
    {
      type: 'quiz',
      correct_option_id: q.correct,
      is_anonymous: false,
      explanation: `✅ Correct answer: ${q.options[q.correct]}`,
    }
  );
}

// Poll answer handler
bot.on('poll_answer', (ctx) => {
  if (!ctx.session?.exam) return;
  const { correct } = SAMPLE_QUESTIONS[ctx.session.exam.questionIndex];
  if (ctx.pollAnswer.option_ids[0] === correct) {
    ctx.session.exam.score++;
  }
  ctx.session.exam.questionIndex++;

  setTimeout(() => {
    if (ctx.session?.exam) sendQuestion(ctx);
  }, 1500);
});

function endExam(ctx) {
  const { score, total } = ctx.session.exam;
  const pct = Math.round((score / total) * 100);
  const grade = pct >= 80 ? '🏆 Excellent' : pct >= 60 ? '👍 Good' : pct >= 40 ? '📘 Average' : '📉 Needs work';
  ctx.reply(
    `🎉 *Exam Complete!*\n\n✅ Score: *${score}/${total}* (${pct}%)\n${grade}\n\nKeep practicing to improve your rank!`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('📚 More Exams', 'back_exams'), Markup.button.callback('👤 My Profile', 'back_profile')]]) }
  );
  delete ctx.session.exam;
}

bot.action('back_exams', (ctx) => { ctx.answerCbQuery(); showExams(ctx); });
bot.action('back_profile', (ctx) => { ctx.answerCbQuery(); showProfile(ctx); });
bot.action('stats', (ctx) => {
  ctx.answerCbQuery();
  const u = getUser(ctx);
  ctx.reply(`📊 *Your Stats*\n\nWin rate: ${Math.round((u.wins / u.quizzes) * 100)}%\nTotal quizzes: ${u.quizzes}\nContests won: ${u.wins}\nCurrent rank: #${u.rank}`, { parse_mode: 'Markdown' });
});

// ─── BATTLE ZONE ─────────────────────────────────────────────────────────────
bot.hears('⚔️ Battle Zone', (ctx) => {
  ctx.reply(
    '⚔️ *Battle Zone*\n\nChallenge a friend or get matched with a random opponent!',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🎯 Random Match', 'battle_random')],
        [Markup.button.callback('👥 Challenge Friend', 'battle_friend')],
      ]),
    }
  );
});

bot.action('battle_random', (ctx) => {
  ctx.answerCbQuery('Finding opponent...');
  ctx.reply('🔍 Searching for an opponent... Please wait!\n\n_(This will trigger a real matchmaking queue in production)_', { parse_mode: 'Markdown' });
});
bot.action('battle_friend', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('Share your battle link with a friend:\n\n`https://t.me/YourBotUsername?start=battle_' + ctx.from.id + '`', { parse_mode: 'Markdown' });
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
bot.hears('🔔 Notifications', (ctx) => {
  ctx.reply(
    '🔔 *Notifications*\n\n• SSC Mega Contest #1 starts in 30 min\n• Your rank improved to #247 🎉\n• New exam added: UPSC Prelims Test',
    { parse_mode: 'Markdown' }
  );
});

// ─── Leaderboard ─────────────────────────────────────────────────────────────
bot.command('leaderboard', (ctx) => {
  ctx.reply(
    '🏅 *Top 5 Leaderboard*\n\n' +
    '1. 🥇 Rahul S — 980 pts\n' +
    '2. 🥈 Priya M — 945 pts\n' +
    '3. 🥉 Amit K — 912 pts\n' +
    '4.    Sneha R — 890 pts\n' +
    '5.    Vijay T — 875 pts\n\n' +
    '👤 You are at #247',
    { parse_mode: 'Markdown' }
  );
});

// ─── Launch ───────────────────────────────────────────────────────────────────
bot.launch();
console.log('✅ RankRiser247 bot started');
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
