// handlers/quiz.js  —  Sends questions, handles answers, timer, skip

const { Markup } = require('telegraf');
const engine = require('../utils/quizEngine');
const db = require('../db/supabase');

const TIMER_SEC = engine.getTimerSeconds();
const { POINTS_CORRECT, POINTS_WRONG } = engine.getScoringInfo();

// Helper: build the timer bar shown in each question
function timerBar(remaining) {
  const total = TIMER_SEC;
  const filled = Math.round((remaining / total) * 10);
  const bar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
  const emoji = remaining <= 5 ? '🔴' : remaining <= 10 ? '🟡' : '🟢';
  return `${emoji} ${bar} *${remaining}s*`;
}

// Helper: build the header line shown above every question
function buildHeader(progress, remaining) {
  const pts = progress.points >= 0
    ? `+${progress.points.toFixed(2)}`
    : `${progress.points.toFixed(2)}`;
  return (
    `📝 *${progress.current}/${progress.total}*  ` +
    `✅ ${progress.score}  ❌ ${progress.wrong}  ` +
    `⭐ Score: *${pts}*\n` +
    timerBar(remaining) + `\n\n`
  );
}

// ─────────────────────────────────────────────────────────────
//  Start a quiz session
// ─────────────────────────────────────────────────────────────
async function startQuiz(ctx, { zone, category, examName, count = 10, mode = 'auto' }) {
  const userId = ctx.from.id;

  // Clear any existing session
  engine.clearSession(userId);

  await ctx.reply(`⏳ Loading questions for *${examName}*...`, { parse_mode: 'Markdown' });

  let questions;
  try {
    questions = await db.getQuestions({ zone, category, count, mode });
  } catch (e) {
    questions = db.getFallbackQuestions(zone, category, count);
  }

  if (!questions || questions.length === 0) {
    return ctx.reply('❌ No questions available for this exam. Admin please add questions via /admin');
  }

  engine.createSession({ userId, questions, zone, category, examName });

  await ctx.reply(
    `🎯 *${examName}*\n\n` +
    `📝 Questions: *${questions.length}*\n` +
    `⏱ Timer: *${TIMER_SEC} seconds* per question\n` +
    `✅ Correct: *+1 point*\n` +
    `❌ Wrong: *−0.25 point* (negative marking)\n` +
    `⏭ Skip: *0 points* (no penalty)\n\n` +
    `_Starting in 3 seconds..._`,
    { parse_mode: 'Markdown' }
  );

  setTimeout(() => sendQuestion(ctx, userId), 3000);
}

// ─────────────────────────────────────────────────────────────
//  Send current question  (with live countdown ticker)
// ─────────────────────────────────────────────────────────────
async function sendQuestion(ctx, userId) {
  const session = engine.getSession(userId);
  if (!session) return;

  if (engine.isFinished(userId)) {
    return showResults(ctx, userId);
  }

  const q = session.questions[session.currentIndex];
  const progress = engine.getProgress(userId);
  const optionLabels = ['🅰️', '🅱️', '🅲️', '🅳️'];

  // Build inline keyboard: 4 options + skip
  const optionButtons = q.options.map((opt, i) =>
    [Markup.button.callback(`${optionLabels[i]} ${opt}`, `quiz_ans_${userId}_${i}`)]
  );
  optionButtons.push([Markup.button.callback('⏭ Skip  (0 pts, no penalty)', `quiz_skip_${userId}`)]);

  // Send initial message with full timer bar
  const initialText = buildHeader(progress, TIMER_SEC) + `*${q.question}*`;
  let sentMsg;
  try {
    sentMsg = await ctx.reply(initialText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(optionButtons),
    });
  } catch (e) {
    console.error('sendQuestion error:', e.message);
    return;
  }

  session.lastMessageId  = sentMsg.message_id;
  session.lastChatId     = sentMsg.chat.id;
  session.questionStartTime = Date.now();

  // ── Live countdown: edit message every 5 seconds ──────────
  // (Telegram rate-limits edits; every 5s is safe and visible)
  const tickIntervals = [25, 20, 15, 10, 5]; // seconds remaining when we update
  const tickTimers = [];

  tickIntervals.forEach((remaining) => {
    const delay = (TIMER_SEC - remaining) * 1000;
    const t = setTimeout(async () => {
      const s = engine.getSession(userId);
      // Only update if user hasn't answered yet
      if (!s || s.currentIndex !== session.currentIndex) return;
      const liveProgress = engine.getProgress(userId);
      const updatedText = buildHeader(liveProgress, remaining) + `*${q.question}*`;
      try {
        await ctx.telegram.editMessageText(
          session.lastChatId, session.lastMessageId, undefined,
          updatedText,
          { parse_mode: 'Markdown', ...Markup.inlineKeyboard(optionButtons) }
        );
      } catch (_) {} // ignore if already answered/deleted
    }, delay);
    tickTimers.push(t);
  });

  // Store tick timers so we can cancel them on answer/skip
  session.tickTimers = tickTimers;

  // ── Hard timeout at 30s ───────────────────────────────────
  engine.startTimer(userId, async (uid) => {
    const s = engine.getSession(uid);
    if (!s || s.currentIndex !== session.currentIndex) return;
    // Cancel remaining ticks
    (s.tickTimers || []).forEach(t => clearTimeout(t));
    engine.recordTimeout(uid);
    try {
      await ctx.telegram.editMessageText(
        session.lastChatId, session.lastMessageId, undefined,
        `⏰ *Time's up!*\n\n` +
        `*${q.question}*\n\n` +
        `✅ Correct: *${optionLabels[q.correct_index]} ${q.options[q.correct_index]}*\n\n` +
        `📖 _${q.explanation || ''}_`,
        { parse_mode: 'Markdown' }
      );
    } catch (_) {}
    setTimeout(() => sendQuestion(ctx, uid), 2000);
  });
}

// ─────────────────────────────────────────────────────────────
//  Handle answer click
// ─────────────────────────────────────────────────────────────
async function handleAnswer(ctx, userId, chosenIndex) {
  const session = engine.getSession(userId);
  if (!session) return ctx.answerCbQuery('No active quiz.');
  if (ctx.from.id !== userId) return ctx.answerCbQuery('This is not your quiz!');

  // Cancel countdown ticks + hard timer
  (session.tickTimers || []).forEach(t => clearTimeout(t));
  engine.clearTimer(userId);

  const result = engine.recordAnswer(userId, chosenIndex);
  if (!result) return ctx.answerCbQuery('No active quiz.');

  const q = session.questions[session.currentIndex - 1];
  const optionLabels = ['🅰️', '🅱️', '🅲️', '🅳️'];
  const isCorrect = result.isCorrect;

  const pointsLabel = isCorrect ? '+1 pt ⭐' : '−0.25 pt 📉';
  await ctx.answerCbQuery(isCorrect ? `✅ Correct!  ${pointsLabel}` : `❌ Wrong!  ${pointsLabel}`);

  // Get updated progress (after recording answer)
  const progress = engine.getProgress(userId);
  const pts = progress.points >= 0 ? `+${progress.points.toFixed(2)}` : `${progress.points.toFixed(2)}`;

  try {
    const resultText =
      `${isCorrect ? '✅' : '❌'} *${isCorrect ? 'Correct! +1 pt' : 'Wrong! −0.25 pt'}*\n` +
      `📝 *${progress.current - 1}/${progress.total}*  ` +
      `✅ ${progress.score}  ❌ ${progress.wrong}  ⭐ Score: *${pts}*\n\n` +
      `*${q.question}*\n\n` +
      `Your answer: *${optionLabels[chosenIndex]} ${q.options[chosenIndex]}*\n` +
      (isCorrect ? '' : `✅ Correct: *${optionLabels[result.correct]} ${q.options[result.correct]}*\n`) +
      `\n📖 _${result.explanation || ''}_`;

    await ctx.editMessageText(resultText, { parse_mode: 'Markdown' });
  } catch (_) {}

  setTimeout(() => sendQuestion(ctx, userId), 2000);
}

// ─────────────────────────────────────────────────────────────
//  Handle skip
// ─────────────────────────────────────────────────────────────
async function handleSkip(ctx, userId) {
  if (ctx.from.id !== userId) return ctx.answerCbQuery('This is not your quiz!');

  const session = engine.getSession(userId);
  if (!session) return ctx.answerCbQuery('No active quiz.');

  // Cancel countdown ticks + hard timer
  (session.tickTimers || []).forEach(t => clearTimeout(t));
  engine.clearTimer(userId);

  const q = session.questions[session.currentIndex];
  engine.recordSkip(userId);

  await ctx.answerCbQuery('⏭ Skipped — no penalty');

  const progress = engine.getProgress(userId);
  const pts = progress.points >= 0 ? `+${progress.points.toFixed(2)}` : `${progress.points.toFixed(2)}`;

  try {
    await ctx.editMessageText(
      `⏭ *Skipped* — 0 pts\n` +
      `📝 *${progress.current - 1}/${progress.total}*  ` +
      `✅ ${progress.score}  ❌ ${progress.wrong}  ⭐ Score: *${pts}*\n\n` +
      `*${q.question}*\n\n` +
      `✅ Correct answer: *${q.options[q.correct_index]}*\n\n` +
      `📖 _${q.explanation || ''}_`,
      { parse_mode: 'Markdown' }
    );
  } catch (_) {}

  setTimeout(() => sendQuestion(ctx, userId), 2000);
}

// ─────────────────────────────────────────────────────────────
//  Show final results
// ─────────────────────────────────────────────────────────────
async function showResults(ctx, userId) {
  const summary = engine.getSummary(userId);
  if (!summary) return;

  engine.clearSession(userId);

  // Save to DB
  try {
    await db.saveSession({
      telegram_id: userId,
      zone: summary.zone,
      category: summary.category,
      score: summary.score,
      total: summary.total,
      time_taken_sec: summary.totalTime,
      skipped: summary.skipped,
    });
    await db.updateUserStats(userId, {
      quizzes_delta: 1,
      wins_delta: summary.pct >= 60 ? 1 : 0,
      score_delta: Math.max(0, Math.round(summary.points * 100)), // store as integer (paise style)
    });
  } catch (e) {
    console.error('Save session error:', e.message);
  }

  const minutes = Math.floor(summary.totalTime / 60);
  const seconds = summary.totalTime % 60;
  const netPoints = summary.points >= 0
    ? `+${summary.points.toFixed(2)}`
    : `${summary.points.toFixed(2)}`;
  const maxPoints = summary.total.toFixed(2);

  const text =
    `🎉 *Quiz Complete!*\n\n` +
    `📝 *${summary.examName}*\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `✅ Correct:   *${summary.score}*  (+${summary.score} pts)\n` +
    `❌ Wrong:     *${summary.wrong}*  (−${(summary.wrong * 0.25).toFixed(2)} pts)\n` +
    `⏭ Skipped:   *${summary.skipped}*  (0 pts)\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⭐ Net Score:  *${netPoints} / ${maxPoints}*\n` +
    `📊 Accuracy:  *${summary.pct}%*\n` +
    `⏱ Time:       *${minutes}m ${seconds}s*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${summary.grade}`;

  return ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔁 Retry Same', `retry_${summary.zone}_${summary.category}`)],
      [Markup.button.callback('📚 Exam Zone', 'back_exams'), Markup.button.callback('👤 Profile', 'back_profile')],
      [Markup.button.callback('🏆 Leaderboard', 'show_leaderboard')],
    ]),
  });
}

// ─────────────────────────────────────────────────────────────
//  Register quiz answer/skip callbacks on bot
// ─────────────────────────────────────────────────────────────
function registerQuizHandlers(bot) {
  // Answer: quiz_ans_{userId}_{optionIndex}
  bot.action(/quiz_ans_(\d+)_(\d+)/, async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    const chosen = parseInt(ctx.match[2]);
    await handleAnswer(ctx, userId, chosen);
  });

  // Skip: quiz_skip_{userId}
  bot.action(/quiz_skip_(\d+)/, async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    await handleSkip(ctx, userId);
  });

  // Retry
  bot.action(/retry_(\w+)_(\w+)/, async (ctx) => {
    ctx.answerCbQuery();
    const zone = ctx.match[1];
    const category = ctx.match[2];
    const examNames = {
      ssc_cgl: 'SSC CGL Mock', railway_ntpc: 'Railway NTPC',
      bank_po: 'Bank PO Mock', upsc: 'UPSC Prelims', general: 'General GK'
    };
    await startQuiz(ctx, { zone, category, examName: examNames[category] || category, count: 10 });
  });

  // Leaderboard
  bot.action('show_leaderboard', async (ctx) => {
    ctx.answerCbQuery();
    try {
      const board = await db.getLeaderboard(10);
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
      let text = '🏅 *Top 10 Leaderboard*\n\n';
      board.forEach((u, i) => {
        text += `${medals[i]} *${u.name}* — ${u.total_score} pts (${u.wins} wins)\n`;
      });
      ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (e) {
      ctx.reply('🏅 Leaderboard loading...');
    }
  });
}

module.exports = { startQuiz, sendQuestion, registerQuizHandlers };
