// handlers/quiz.js  —  Sends questions, handles answers, timer, skip

const { Markup } = require('telegraf');
const engine = require('../utils/quizEngine');
const db = require('../db/supabase');

const TIMER_SEC = engine.getTimerSeconds();

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
    `⏭ You can skip any question\n\n` +
    `_Starting in 3 seconds..._`,
    { parse_mode: 'Markdown' }
  );

  setTimeout(() => sendQuestion(ctx, userId), 3000);
}

// ─────────────────────────────────────────────────────────────
//  Send current question
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

  // Build inline keyboard with options + skip
  const optionButtons = q.options.map((opt, i) =>
    [Markup.button.callback(`${optionLabels[i]} ${opt}`, `quiz_ans_${userId}_${i}`)]
  );
  optionButtons.push([Markup.button.callback('⏭ Skip this question', `quiz_skip_${userId}`)]);

  const headerText =
    `📝 *Question ${progress.current}/${progress.total}*  |  ✅ ${progress.score}  |  ⏭ ${progress.skipped}\n` +
    `⏱ _You have ${TIMER_SEC} seconds_\n\n` +
    `*${q.question}*`;

  try {
    const sentMsg = await ctx.reply(headerText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(optionButtons),
    });

    // Store message ID so we can edit it after answer
    session.lastMessageId = sentMsg.message_id;
    session.lastChatId = sentMsg.chat.id;
    session.questionStartTime = Date.now();

    // Start timer — auto move to next on timeout
    engine.startTimer(userId, async (uid) => {
      const s = engine.getSession(uid);
      if (!s || s.currentIndex !== session.currentIndex) return; // already answered
      engine.recordTimeout(uid);
      try {
        await ctx.telegram.editMessageText(
          session.lastChatId,
          session.lastMessageId,
          undefined,
          `⏰ *Time's up!*\n\n*${q.question}*\n\n✅ Correct: *${q.options[q.correct_index]}*\n\n📖 _${q.explanation || ''}_`,
          { parse_mode: 'Markdown' }
        );
      } catch (_) {}
      setTimeout(() => sendQuestion(ctx, uid), 2000);
    });
  } catch (e) {
    console.error('sendQuestion error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  Handle answer click
// ─────────────────────────────────────────────────────────────
async function handleAnswer(ctx, userId, chosenIndex) {
  const session = engine.getSession(userId);
  if (!session) return ctx.answerCbQuery('No active quiz.');

  // Prevent answering a different user's quiz
  if (ctx.from.id !== userId) return ctx.answerCbQuery('This is not your quiz!');

  engine.clearTimer(userId);
  const result = engine.recordAnswer(userId, chosenIndex);
  if (!result) return ctx.answerCbQuery('No active quiz.');

  const q = session.questions[session.currentIndex - 1];
  const optionLabels = ['🅰️', '🅱️', '🅲️', '🅳️'];
  const isCorrect = result.isCorrect;

  await ctx.answerCbQuery(isCorrect ? '✅ Correct!' : '❌ Wrong!');

  // Edit message to show answer result
  try {
    const resultText =
      `${isCorrect ? '✅' : '❌'} *${isCorrect ? 'Correct!' : 'Wrong!'}*\n\n` +
      `*${q.question}*\n\n` +
      `Your answer: *${optionLabels[chosenIndex]} ${q.options[chosenIndex]}*\n` +
      (isCorrect ? '' : `✅ Correct: *${optionLabels[result.correct]} ${q.options[result.correct]}*\n`) +
      `\n📖 _${result.explanation || ''}_`;

    await ctx.editMessageText(resultText, { parse_mode: 'Markdown' });
  } catch (_) {}

  // Next question after 2 seconds
  setTimeout(() => sendQuestion(ctx, userId), 2000);
}

// ─────────────────────────────────────────────────────────────
//  Handle skip
// ─────────────────────────────────────────────────────────────
async function handleSkip(ctx, userId) {
  if (ctx.from.id !== userId) return ctx.answerCbQuery('This is not your quiz!');

  const session = engine.getSession(userId);
  if (!session) return ctx.answerCbQuery('No active quiz.');

  engine.clearTimer(userId);
  const q = session.questions[session.currentIndex];
  engine.recordSkip(userId);

  await ctx.answerCbQuery('⏭ Skipped');

  try {
    await ctx.editMessageText(
      `⏭ *Skipped*\n\n*${q.question}*\n\n✅ Correct answer: *${q.options[q.correct_index]}*\n\n📖 _${q.explanation || ''}_`,
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
      score_delta: summary.score,
    });
  } catch (e) {
    console.error('Save session error:', e.message);
  }

  const minutes = Math.floor(summary.totalTime / 60);
  const seconds = summary.totalTime % 60;

  const text =
    `🎉 *Quiz Complete!*\n\n` +
    `📝 *${summary.examName}*\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `✅ Correct:  *${summary.score}/${summary.total}*\n` +
    `❌ Wrong:    *${summary.total - summary.score - summary.skipped}*\n` +
    `⏭ Skipped:  *${summary.skipped}*\n` +
    `📊 Score:    *${summary.pct}%*\n` +
    `⏱ Time:     *${minutes}m ${seconds}s*\n` +
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
