// handlers/quiz.js  —  Sends questions, handles answers, timer, skip, retry

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
function buildHeader(progress, remaining, noTimer = false) {
  const pts = progress.points >= 0
    ? `+${progress.points.toFixed(2)}`
    : `${progress.points.toFixed(2)}`;
  const header =
    `📝 *${progress.current}/${progress.total}*  ` +
    `✅ ${progress.score}  ❌ ${progress.wrong}  ` +
    `⭐ Score: *${pts}*\n`;
  if (noTimer) return header + '\n';
  return header + timerBar(remaining) + `\n\n`;
}

// ─────────────────────────────────────────────────────────────
//  Start a quiz session
// ─────────────────────────────────────────────────────────────
async function startQuiz(ctx, { zone, category, subject, examName, count = 10, mode = 'auto', noTimer = false, retryIds = null, examType = 'mock' }) {
  const userId = ctx.from.id;

  // Clear any existing session
  engine.clearSession(userId);

  await ctx.reply(`⏳ Loading questions for *${examName}*...`, { parse_mode: 'Markdown' });

  let questions;
  try {
    if (retryIds && retryIds.length > 0) {
      // Retry mode — load specific wrong questions from DB
      questions = await db.getQuestionsByIds(retryIds);
      if (!questions || questions.length === 0) throw new Error('none');
    } else {
      questions = await db.getQuestions({ zone, category, subject, count, mode });
    }
  } catch (e) {
    questions = db.getFallbackQuestions(zone, category, count);
  }

  if (!questions || questions.length === 0) {
    return ctx.reply('❌ No questions available. Admin please add questions via /admin');
  }

  engine.createSession({ userId, questions, zone, category, subject, examName, examType, noTimer });

  const timerLine = noTimer
    ? `⏱ Mode: *Practice (no timer)*\n`
    : `⏱ Timer: *${TIMER_SEC} seconds* per question\n`;

  await ctx.reply(
    `🎯 *${examName}*\n\n` +
    `📝 Questions: *${questions.length}*\n` +
    timerLine +
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
  const noTimer = session.noTimer || false;

  const optionButtons = q.options.map((opt, i) =>
    [Markup.button.callback(`${optionLabels[i]} ${opt}`, `quiz_ans_${userId}_${i}`)]
  );
  optionButtons.push([Markup.button.callback('⏭ Skip  (0 pts, no penalty)', `quiz_skip_${userId}`)]);

  const initialText = buildHeader(progress, TIMER_SEC, noTimer) + `*${q.question}*`;
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

  session.lastMessageId    = sentMsg.message_id;
  session.lastChatId       = sentMsg.chat.id;
  session.questionStartTime = Date.now();

  if (!noTimer) {
    // ── Live countdown: edit message every 5 seconds ──────────
    const tickIntervals = [25, 20, 15, 10, 5];
    const tickTimers = [];

    tickIntervals.forEach((remaining) => {
      const delay = (TIMER_SEC - remaining) * 1000;
      const t = setTimeout(async () => {
        const s = engine.getSession(userId);
        if (!s || s.currentIndex !== session.currentIndex) return;
        const liveProgress = engine.getProgress(userId);
        const updatedText = buildHeader(liveProgress, remaining, false) + `*${q.question}*`;
        try {
          await ctx.telegram.editMessageText(
            session.lastChatId, session.lastMessageId, undefined,
            updatedText,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(optionButtons) }
          );
        } catch (_) {}
      }, delay);
      tickTimers.push(t);
    });

    session.tickTimers = tickTimers;

    // ── Hard timeout at TIMER_SEC ─────────────────────────────
    engine.startTimer(userId, async (uid) => {
      const s = engine.getSession(uid);
      if (!s || s.currentIndex !== session.currentIndex) return;
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
}

// ─────────────────────────────────────────────────────────────
//  Handle answer click
// ─────────────────────────────────────────────────────────────
async function handleAnswer(ctx, userId, chosenIndex) {
  const session = engine.getSession(userId);
  if (!session) return ctx.answerCbQuery('No active quiz.');
  if (ctx.from.id !== userId) return ctx.answerCbQuery('This is not your quiz!');

  (session.tickTimers || []).forEach(t => clearTimeout(t));
  engine.clearTimer(userId);

  const result = engine.recordAnswer(userId, chosenIndex);
  if (!result) return ctx.answerCbQuery('No active quiz.');

  const q = session.questions[session.currentIndex - 1];
  const optionLabels = ['🅰️', '🅱️', '🅲️', '🅳️'];
  const isCorrect = result.isCorrect;

  const pointsLabel = isCorrect ? '+1 pt ⭐' : '−0.25 pt 📉';
  await ctx.answerCbQuery(isCorrect ? `✅ Correct!  ${pointsLabel}` : `❌ Wrong!  ${pointsLabel}`);

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
//  Show final results  (with performance analysis)
// ─────────────────────────────────────────────────────────────
async function showResults(ctx, userId) {
  const summary = engine.getSummary(userId);
  if (!summary) return;

  engine.clearSession(userId);

  const accuracyPct = Math.round((summary.score / summary.total) * 100);

  // Save to DB and get session ID for retry
  let savedSessionId = null;
  let prevSessions = [];
  const wrongQuestionIds = summary.answers
    .filter(a => !a.isCorrect && !a.skipped && !a.timeout && a.questionId && !String(a.questionId).startsWith('f') && !String(a.questionId).startsWith('r') && !String(a.questionId).startsWith('b') && !String(a.questionId).startsWith('u') && !String(a.questionId).startsWith('g'))
    .map(a => a.questionId);

  try {
    const saved = await db.saveSession({
      telegram_id: userId,
      zone: summary.zone,
      category: summary.category,
      subject: summary.subject || null,
      exam_type: summary.examType || 'mock',
      score: summary.score,
      total: summary.total,
      wrong: summary.wrong,
      time_taken_sec: summary.totalTime,
      skipped: summary.skipped,
      wrong_question_ids: wrongQuestionIds,
      accuracy_pct: accuracyPct,
    });
    savedSessionId = saved?.id || null;

    await db.updateUserStats(userId, {
      quizzes_delta: 1,
      wins_delta: accuracyPct >= 60 ? 1 : 0,
      score_delta: Math.max(0, Math.round(summary.points * 100)),
    });

    // Fetch previous sessions for comparison
    prevSessions = await db.getRecentSessions(userId, { category: summary.category, limit: 5 });
  } catch (e) {
    console.error('Save session error:', e.message);
  }

  // ── Performance analysis ──────────────────────────────────
  const minutes = Math.floor(summary.totalTime / 60);
  const seconds = summary.totalTime % 60;
  const avgTimeSec = summary.total > 0 ? Math.round(summary.totalTime / summary.total) : 0;
  const netPoints = summary.points >= 0
    ? `+${summary.points.toFixed(2)}`
    : `${summary.points.toFixed(2)}`;
  const maxPoints = summary.total.toFixed(2);

  // Compare to previous attempt
  let improvementLine = '';
  if (prevSessions.length >= 2) {
    const lastAcc = prevSessions[1]?.accuracy_pct || 0;
    const diff = accuracyPct - lastAcc;
    if (diff > 0)      improvementLine = `\n📈 _You improved *${diff}%* since your last attempt!_`;
    else if (diff < 0) improvementLine = `\n📉 _Down ${Math.abs(diff)}% from last attempt — keep practicing!_`;
    else               improvementLine = `\n➡️ _Same accuracy as last attempt._`;
  }

  // Strong vs weak analysis (based on current session subjects, if tagged)
  const subjectMap = {};
  summary.answers.forEach(a => {
    const subj = summary.questions ? summary.questions[summary.answers.indexOf(a)]?.subject : null;
    if (!subj) return;
    if (!subjectMap[subj]) subjectMap[subj] = { correct: 0, total: 0 };
    subjectMap[subj].total++;
    if (a.isCorrect) subjectMap[subj].correct++;
  });
  let analysisLine = '';
  const subjEntries = Object.entries(subjectMap);
  if (subjEntries.length > 0) {
    const strong = subjEntries.filter(([,v]) => v.total > 0 && (v.correct/v.total) >= 0.7).map(([k]) => k);
    const weak   = subjEntries.filter(([,v]) => v.total > 0 && (v.correct/v.total) < 0.5).map(([k]) => k);
    const subjectNames = { maths: 'Maths', reasoning: 'Reasoning', english: 'English', gk: 'GK', current_affairs: 'Current Affairs' };
    if (strong.length) analysisLine += `\n💪 Strong: ${strong.map(s => subjectNames[s] || s).join(', ')}`;
    if (weak.length)   analysisLine += `\n⚠️ Weak: ${weak.map(s => subjectNames[s] || s).join(', ')} — practice more!`;
  }

  const text =
    `🎉 *Quiz Complete!*\n\n` +
    `📝 *${summary.examName}*\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `✅ Correct:   *${summary.score}*  (+${summary.score} pts)\n` +
    `❌ Wrong:     *${summary.wrong}*  (−${(summary.wrong * 0.25).toFixed(2)} pts)\n` +
    `⏭ Skipped:   *${summary.skipped}*  (0 pts)\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⭐ Net Score:  *${netPoints} / ${maxPoints}*\n` +
    `📊 Accuracy:  *${accuracyPct}%*\n` +
    `⏱ Time:       *${minutes}m ${seconds}s*\n` +
    `⚡ Avg/Q:     *${avgTimeSec}s*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${summary.grade}` +
    improvementLine +
    analysisLine;

  // Build action buttons
  const actionRows = [];

  // Retry wrong answers button (only if there are wrong real-DB questions)
  if (wrongQuestionIds.length > 0) {
    actionRows.push([
      Markup.button.callback(
        `🔁 Retry Wrong Answers (${wrongQuestionIds.length}Q)`,
        `retry_wrong_${userId}_${wrongQuestionIds.join(',')}`
      )
    ]);
  }

  actionRows.push([Markup.button.callback('🔁 Retry Same Exam', `retry_${summary.zone}_${summary.category}`)]);
  actionRows.push([
    Markup.button.callback('📚 Exam Zone', 'back_exams'),
    Markup.button.callback('👤 Profile', 'back_profile'),
  ]);
  actionRows.push([Markup.button.callback('🏆 Leaderboard', 'show_leaderboard')]);

  return ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(actionRows),
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

  // Retry same exam
  bot.action(/retry_(\w+)_(\w+)/, async (ctx) => {
    // Skip if this matches retry_wrong pattern (handled below)
    if (ctx.match[0].startsWith('retry_wrong_')) return;
    ctx.answerCbQuery();
    const zone = ctx.match[1];
    const category = ctx.match[2];
    const examNames = {
      ssc_cgl: 'SSC CGL Mock', railway_ntpc: 'Railway NTPC',
      bank_po: 'Bank PO Mock', upsc: 'UPSC Prelims', general: 'General GK'
    };
    await startQuiz(ctx, { zone, category, examName: examNames[category] || category, count: 10 });
  });

  // Retry wrong answers: retry_wrong_{userId}_{id1,id2,...}
  bot.action(/retry_wrong_(\d+)_(.+)/, async (ctx) => {
    ctx.answerCbQuery();
    const ids = ctx.match[2].split(',').map(id => {
      const n = parseInt(id);
      return isNaN(n) ? id : n; // support both int and string IDs
    });
    await startQuiz(ctx, {
      zone: 'exam',
      category: null,
      examName: '🔁 Wrong Answers Retry',
      count: ids.length,
      retryIds: ids,
      examType: 'retry',
      noTimer: false,
    });
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
