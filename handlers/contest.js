// handlers/contest.js  —  Contest Zone: register, attempt, results, leaderboard
// ─────────────────────────────────────────────────────────────────────────────
// KEY RULES implemented here:
//  1. Do NOT reveal correct/wrong after each answer during contest
//  2. No hint/explanation shown during contest
//  3. Next question after 30s timer — NOT after student answers
//     (student answer is recorded with timestamp, but screen waits for timer)
//  4. Full result review only AFTER contest ends
//  5. Leaderboard updated after contest finishes

const { Markup } = require('telegraf');
const db = require('../db/supabase');

const CONTEST_Q_TIMER = 30; // seconds per question during contest

// ─── In-memory contest sessions ───────────────────────────────────────────────
// Map<userId, { contestId, questions, currentIndex, answers, startTime, qStartTime, qTimer, chatId }>
const contestSessions = new Map();

// ─── Helper: format seconds as Xm Ys ─────────────────────────────────────────
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── Helper: timer bar ────────────────────────────────────────────────────────
function timerBar(remaining) {
  const filled = Math.round((remaining / CONTEST_Q_TIMER) * 10);
  const bar = '🟥'.repeat(filled) + '⬜'.repeat(10 - filled);
  const emoji = remaining <= 5 ? '🔴' : remaining <= 10 ? '🟡' : '🟢';
  return `${emoji} ${bar} *${remaining}s*`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DB helpers (wrappers around supabase client directly)
// ─────────────────────────────────────────────────────────────────────────────

async function getContests(status) {
  const { data, error } = await db.supabase
    .from('contests')
    .select('*')
    .eq('status', status)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getContest(id) {
  const { data, error } = await db.supabase
    .from('contests')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function getContestQuestions(contestId) {
  const { data, error } = await db.supabase
    .from('contest_questions')
    .select('question_id, sort_order, questions(*)')
    .eq('contest_id', contestId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data || []).map(row => row.questions);
}

async function isRegistered(contestId, telegramId) {
  const { data } = await db.supabase
    .from('contest_registrations')
    .select('id')
    .eq('contest_id', contestId)
    .eq('telegram_id', telegramId)
    .single();
  return !!data;
}

async function registerUser(contestId, telegramId, paid = false) {
  const { error } = await db.supabase
    .from('contest_registrations')
    .upsert({ contest_id: contestId, telegram_id: telegramId, paid },
             { onConflict: 'contest_id,telegram_id' });
  if (error) throw error;
}

async function upsertSubmission(contestId, telegramId, fields) {
  const { error } = await db.supabase
    .from('contest_submissions')
    .upsert({ contest_id: contestId, telegram_id: telegramId, ...fields },
             { onConflict: 'contest_id,telegram_id' });
  if (error) throw error;
}

async function getSubmission(contestId, telegramId) {
  const { data } = await db.supabase
    .from('contest_submissions')
    .select('*')
    .eq('contest_id', contestId)
    .eq('telegram_id', telegramId)
    .single();
  return data || null;
}

async function getParticipantCount(contestId) {
  const { count } = await db.supabase
    .from('contest_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('contest_id', contestId);
  return count || 0;
}

async function getContestLeaderboard(contestId, limit = 10) {
  const { data, error } = await db.supabase
    .rpc('get_contest_leaderboard', { p_contest_id: contestId, p_limit: limit });
  if (error) throw error;
  return data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Show contest menu
// ─────────────────────────────────────────────────────────────────────────────
async function showContestMenu(ctx) {
  await ctx.reply('🏆 *Contest Zone*\n\nChoose a tab:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[
      Markup.button.callback('🔴 Live', 'ct_live'),
      Markup.button.callback('🗓 Upcoming', 'ct_upcoming'),
      Markup.button.callback('✅ Completed', 'ct_completed'),
    ]]),
  });
}

async function showContestList(ctx, status) {
  await ctx.answerCbQuery();
  let list;
  try { list = await getContests(status); } catch { list = []; }

  if (!list.length) {
    return ctx.reply(
      status === 'live'      ? '🔴 No live contests right now. Check back soon!' :
      status === 'upcoming'  ? '🗓 No upcoming contests scheduled yet.' :
                               '✅ No completed contests yet.',
      Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'ct_menu')]])
    );
  }

  const statusEmoji = { live: '🔴', upcoming: '🗓', completed: '✅' };
  const buttons = list.map(c => [
    Markup.button.callback(
      `${statusEmoji[c.status] || ''} ${c.name} — ₹${c.prize_pool}`,
      `ct_detail_${c.id}`
    )
  ]);
  buttons.push([Markup.button.callback('🔙 Back', 'ct_menu')]);
  await ctx.reply(`${statusEmoji[status]} *${status.charAt(0).toUpperCase() + status.slice(1)} Contests*\n\nTap a contest for details:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Contest detail page
// ─────────────────────────────────────────────────────────────────────────────
async function showContestDetail(ctx, contestId) {
  await ctx.answerCbQuery();
  let c;
  try { c = await getContest(contestId); } catch { return ctx.reply('Contest not found.'); }

  const now = Date.now();
  const start = new Date(c.start_time).getTime();
  const end   = new Date(c.end_time).getTime();
  const participants = await getParticipantCount(contestId).catch(() => 0);

  let statusLine = '';
  if (c.status === 'live') {
    const remainMin = Math.max(0, Math.round((end - now) / 60000));
    const remainSec = Math.max(0, Math.round((end - now) / 1000));
    const liveDisplay = remainMin < 1
      ? `${remainSec}s`
      : remainMin > 60
        ? `${Math.round(remainMin / 60)}h ${remainMin % 60}m`
        : `${remainMin} min`;
    statusLine = `⏳ Ends in: *${liveDisplay}*\n👥 Competing: *${participants} students*\n`;
  } else if (c.status === 'upcoming') {
    const startsMin = Math.max(0, Math.round((start - now) / 60000));
    const startDisplay = startsMin > 60
      ? `${Math.round(startsMin / 60)}h ${startsMin % 60}m`
      : `${startsMin} min`;
    statusLine = `⏰ Starts in: *${startDisplay}*\n`;
  } else {
    // Completed — show when it ended, never negative
    const endedMinsAgo = Math.round((now - end) / 60000);
    const endedDisplay = endedMinsAgo < 60
      ? `${endedMinsAgo} min ago`
      : endedMinsAgo < 1440
        ? `${Math.round(endedMinsAgo / 60)}h ago`
        : new Date(c.end_time).toLocaleDateString('en-IN');
    statusLine = `🏁 Contest ended: *${endedDisplay}*\n👥 Participants: *${participants}*\n`;
  }

  const text =
    `🏆 *${c.name}*\n\n` +
    `📂 Category: *${c.category.toUpperCase()}*\n` +
    `📝 Questions: *${c.question_count}* (30s each)\n` +
    `⏱ Duration: *${c.duration_min} min total*\n` +
    `💰 Prize Pool: *₹${c.prize_pool}*\n` +
    `🎟 Entry: *${c.entry_fee === 0 ? 'Free' : '₹' + c.entry_fee}*\n` +
    statusLine;

  const buttons = [];

  if (c.status === 'live') {
    const reg = await isRegistered(contestId, ctx.from.id).catch(() => false);
    if (reg) {
      const sub = await getSubmission(contestId, ctx.from.id).catch(() => null);
      if (sub && sub.finished) {
        buttons.push([Markup.button.callback('📊 My Result', `ct_myresult_${contestId}`)]);
        buttons.push([Markup.button.callback('🏅 Leaderboard', `ct_leaderboard_${contestId}`)]);
      } else {
        buttons.push([Markup.button.callback('▶️ Continue Contest', `ct_start_${contestId}`)]);
      }
    } else if (c.entry_fee === 0) {
      buttons.push([Markup.button.callback('✅ Join & Start Contest', `ct_join_${contestId}`)]);
    } else {
      buttons.push([Markup.button.callback(`💳 Pay ₹${c.entry_fee} & Join`, `ct_pay_${contestId}`)]);
    }
  } else if (c.status === 'upcoming') {
    const reg = await isRegistered(contestId, ctx.from.id).catch(() => false);
    if (reg) {
      buttons.push([Markup.button.callback('✅ Registered — You\'ll get a reminder', 'ct_registered_info')]);
    } else if (c.entry_fee === 0) {
      buttons.push([Markup.button.callback('🔔 Register (Free)', `ct_register_${contestId}`)]);
    } else {
      buttons.push([Markup.button.callback(`💳 Pay ₹${c.entry_fee} & Register`, `ct_pay_${contestId}`)]);
    }
  } else {
    // Completed — show results only, no register/join button
    const sub = await getSubmission(contestId, ctx.from.id).catch(() => null);
    if (sub && sub.finished) {
      buttons.push([Markup.button.callback('📊 My Result', `ct_myresult_${contestId}`)]);
      buttons.push([Markup.button.callback('🏅 Final Leaderboard', `ct_leaderboard_${contestId}`)]);
    } else {
      buttons.push([Markup.button.callback('🏅 Final Leaderboard', `ct_leaderboard_${contestId}`)]);
    }
  }

  buttons.push([Markup.button.callback('🔙 Back', 'ct_menu')]);

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Register (upcoming/free)
// ─────────────────────────────────────────────────────────────────────────────
async function handleRegister(ctx, contestId) {
  await ctx.answerCbQuery('Registering...');
  try {
    await registerUser(contestId, ctx.from.id, false);
    const c = await getContest(contestId);
    await ctx.reply(
      `✅ *Registered for "${c.name}"!*\n\n` +
      `You'll receive a notification when the contest goes live.\n\n` +
      `📅 Start time: ${new Date(c.start_time).toLocaleString('en-IN')}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    await ctx.reply('❌ Registration failed. Please try again.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Join & Start (live, free)
// ─────────────────────────────────────────────────────────────────────────────
async function handleJoinAndStart(ctx, contestId) {
  await ctx.answerCbQuery('Joining...');
  try {
    await registerUser(contestId, ctx.from.id, false);
  } catch (e) {
    if (!e.message?.includes('unique')) {
      return ctx.reply('❌ Could not join contest. Try again.');
    }
  }
  await startContestAttempt(ctx, contestId);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Start / Resume contest attempt
// ─────────────────────────────────────────────────────────────────────────────
async function startContestAttempt(ctx, contestId) {
  const userId = ctx.from.id;

  clearContestSession(userId);

  let c, questions;
  try {
    c = await getContest(contestId);
    questions = await getContestQuestions(contestId);
  } catch (e) {
    return ctx.reply('❌ Could not load contest. Please try again.');
  }

  if (!questions || questions.length === 0) {
    return ctx.reply('❌ This contest has no questions assigned yet. Please contact admin.');
  }

  const now = Date.now();
  const end  = new Date(c.end_time).getTime();
  if (now >= end) {
    return ctx.reply('⏰ This contest has already ended. Check the results!');
  }

  const existing = await getSubmission(contestId, userId).catch(() => null);
  if (existing && existing.finished) {
    return ctx.reply(
      '✅ You have already submitted this contest.\nWait for results after it ends.',
      Markup.inlineKeyboard([[Markup.button.callback('📊 My Result', `ct_myresult_${contestId}`)]])
    );
  }

  const doneCount = existing ? (existing.answers || []).length : 0;

  const session = {
    contestId,
    contestName: c.name,
    questions,
    currentIndex: doneCount,
    answers: existing ? (existing.answers || []) : [],
    contestEndTime: end,
    startTime: Date.now(),
    qStartTime: null,
    qTimer: null,
    tickTimers: [],
    lastMsgId: null,
    chatId: null,
  };
  contestSessions.set(userId, session);

  const remainQs = questions.length - doneCount;
  const timeLeftSec = Math.round((end - now) / 1000);

  await ctx.reply(
    `🏆 *${c.name}*\n\n` +
    `📝 Questions: *${questions.length}* total\n` +
    `⏱ *30 seconds* per question\n` +
    `⌛ Contest time left: *${fmtTime(timeLeftSec)}*\n\n` +
    (doneCount > 0
      ? `↩️ Resuming from Q${doneCount + 1} (${remainQs} remaining)\n\n`
      : '') +
    `⚠️ *Important Rules:*\n` +
    `• Answers are NOT revealed during contest\n` +
    `• Next question auto-advances after 30s\n` +
    `• Results shown after contest ends\n\n` +
    `_Starting in 3 seconds..._`,
    { parse_mode: 'Markdown' }
  );

  setTimeout(() => sendContestQuestion(ctx, userId), 3000);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Send a contest question
// ─────────────────────────────────────────────────────────────────────────────
async function sendContestQuestion(ctx, userId) {
  const session = contestSessions.get(userId);
  if (!session) return;

  if (session.currentIndex >= session.questions.length) {
    return finishContestAttempt(ctx, userId);
  }

  if (Date.now() >= session.contestEndTime) {
    return finishContestAttempt(ctx, userId);
  }

  const q = session.questions[session.currentIndex];
  const optionLabels = ['🅰️', '🅱️', '🅲️', '🅳️'];
  const qNum = session.currentIndex + 1;
  const total = session.questions.length;

  const optionButtons = q.options.map((opt, i) =>
    [Markup.button.callback(
      `${optionLabels[i]} ${opt}`,
      `ct_ans_${userId}_${session.contestId}_${i}`
    )]
  );

  const header =
    `🏆 *Contest: Q${qNum}/${total}*\n` +
    timerBar(CONTEST_Q_TIMER) + `\n\n`;

  const questionText = header + `*${q.question}*`;

  let sentMsg;
  try {
    sentMsg = await ctx.reply(questionText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(optionButtons),
    });
  } catch (e) {
    console.error('Contest sendQuestion error:', e.message);
    return;
  }

  session.lastMsgId  = sentMsg.message_id;
  session.chatId     = sentMsg.chat.id;
  session.qStartTime = Date.now();
  session.answered   = false;

  // Countdown ticks
  const ticks = [25, 20, 15, 10, 5];
  const tickTimers = ticks.map(remaining => {
    const delay = (CONTEST_Q_TIMER - remaining) * 1000;
    return setTimeout(async () => {
      const s = contestSessions.get(userId);
      if (!s || s.currentIndex !== session.currentIndex) return;
      const updText =
        `🏆 *Contest: Q${qNum}/${total}*\n` +
        timerBar(remaining) + `\n\n` +
        `*${q.question}*` +
        (s.answered ? `\n\n_✏️ Answer recorded — waiting for timer..._` : '');
      try {
        await ctx.telegram.editMessageText(
          s.chatId, s.lastMsgId, undefined,
          updText,
          { parse_mode: 'Markdown', ...Markup.inlineKeyboard(optionButtons) }
        );
      } catch (_) {}
    }, delay);
  });
  session.tickTimers = tickTimers;

  // Hard timer: advance after 30s
  const hardTimer = setTimeout(async () => {
    const s = contestSessions.get(userId);
    if (!s || s.currentIndex !== session.currentIndex) return;

    (s.tickTimers || []).forEach(t => clearTimeout(t));

    if (!s.answered) {
      s.answers.push({
        qIndex: s.currentIndex,
        chosen: -1,
        timeTaken: CONTEST_Q_TIMER,
      });
    }

    try {
      await ctx.telegram.editMessageText(
        s.chatId, s.lastMsgId, undefined,
        `⏰ *Time's up for Q${qNum}!*\n\n` +
        `*${q.question}*\n\n` +
        `_Moving to next question..._`,
        { parse_mode: 'Markdown' }
      );
    } catch (_) {}

    s.currentIndex++;
    await saveContestProgress(s).catch(() => {});
    setTimeout(() => sendContestQuestion(ctx, userId), 1500);
  }, CONTEST_Q_TIMER * 1000);

  session.qTimer = hardTimer;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Handle answer click (contest mode)
// ─────────────────────────────────────────────────────────────────────────────
async function handleContestAnswer(ctx, userId, contestId, chosenIndex) {
  const session = contestSessions.get(userId);
  if (!session) return ctx.answerCbQuery('No active contest.');
  if (ctx.from.id !== userId) return ctx.answerCbQuery('Not your contest!');
  if (session.contestId !== contestId) return ctx.answerCbQuery('Wrong contest.');

  if (session.answered) {
    return ctx.answerCbQuery('✏️ Answer already recorded!');
  }

  const timeTaken = Math.round((Date.now() - session.qStartTime) / 1000);
  session.answers.push({
    qIndex: session.currentIndex,
    chosen: chosenIndex,
    timeTaken,
  });
  session.answered = true;

  await ctx.answerCbQuery('✅ Answer recorded! Wait for timer...');

  const q = session.questions[session.currentIndex];
  const qNum = session.currentIndex + 1;
  const total = session.questions.length;
  const optionLabels = ['🅰️', '🅱️', '🅲️', '🅳️'];

  const elapsed = Math.round((Date.now() - session.qStartTime) / 1000);
  const remaining = Math.max(0, CONTEST_Q_TIMER - elapsed);

  try {
    await ctx.editMessageText(
      `🏆 *Contest: Q${qNum}/${total}*\n` +
      timerBar(remaining) + `\n\n` +
      `*${q.question}*\n\n` +
      `✏️ *You answered: ${optionLabels[chosenIndex]} ${q.options[chosenIndex]}*\n` +
      `_Result will be shown after the contest ends._`,
      { parse_mode: 'Markdown' }
    );
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
//  Finish contest attempt
// ─────────────────────────────────────────────────────────────────────────────
async function finishContestAttempt(ctx, userId) {
  const session = contestSessions.get(userId);
  if (!session) return;

  clearContestSession(userId);

  const { contestId, questions, answers, startTime } = session;
  const totalTimeSec = Math.round((Date.now() - startTime) / 1000);

  let score = 0, wrong = 0, skipped = 0;
  answers.forEach(a => {
    const q = questions[a.qIndex];
    if (a.chosen === -1) {
      skipped++;
    } else if (a.chosen === q.correct_index) {
      score++;
    } else {
      wrong++;
    }
  });
  skipped += (questions.length - answers.length);

  try {
    await upsertSubmission(contestId, userId, {
      answers,
      score,
      wrong,
      skipped,
      time_taken_sec: totalTimeSec,
      finished: true,
      submitted_at: new Date().toISOString(),
    });
    await db.updateUserStats(userId, {
      quizzes_delta: 1,
      wins_delta: 0,
      score_delta: score,
    });
  } catch (e) {
    console.error('Contest submission save error:', e.message);
  }

  const c = await getContest(contestId).catch(() => null);
  const contestEndTime = c ? new Date(c.end_time).getTime() : 0;
  const isContestOver  = Date.now() >= contestEndTime;

  await ctx.reply(
    `✅ *Contest Submitted!*\n\n` +
    `🏆 *${session.contestName}*\n\n` +
    `You answered *${answers.filter(a => a.chosen !== -1).length}/${questions.length}* questions\n` +
    `⏱ Your time: *${fmtTime(totalTimeSec)}*\n\n` +
    (isContestOver
      ? `🏁 Contest has ended — results are available!`
      : `⏳ Contest is still running...\n_Results & leaderboard will be published when the contest ends._\n_You'll be notified!_`),
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(
        isContestOver
          ? [
              [Markup.button.callback('📊 My Result', `ct_myresult_${contestId}`)],
              [Markup.button.callback('🏅 Leaderboard', `ct_leaderboard_${contestId}`)],
            ]
          : [[Markup.button.callback('🔙 Contest Zone', 'ct_menu')]]
      ),
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Save progress to DB (for resume support)
// ─────────────────────────────────────────────────────────────────────────────
async function saveContestProgress(session) {
  const { contestId, answers } = session;
  await upsertSubmission(contestId, session._userId, {
    answers,
    finished: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Show MY result (after contest ends)
// ─────────────────────────────────────────────────────────────────────────────
async function showMyResult(ctx, contestId) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  let c, sub, questions;
  try {
    c         = await getContest(contestId);
    sub       = await getSubmission(contestId, userId);
    questions = await getContestQuestions(contestId);
  } catch (e) {
    return ctx.reply('❌ Could not load your result. Please try again.');
  }

  if (!sub || !sub.finished) {
    return ctx.reply('❌ You did not submit this contest.');
  }

  const answers   = sub.answers || [];
  const total     = questions.length;
  const score     = sub.score;
  const wrong     = sub.wrong;
  const skipped   = sub.skipped;
  const netPoints = score - (wrong * 0.25);
  const accuracy  = total > 0 ? Math.round((score / total) * 100) : 0;

  let reviewText = '';
  answers.forEach((a, i) => {
    const q = questions[a.qIndex] || questions[i];
    if (!q) return;
    const optionLabels = ['A', 'B', 'C', 'D'];
    let status;
    if (a.chosen === -1) {
      status = `⏭ Skipped`;
    } else if (a.chosen === q.correct_index) {
      status = `✅ Correct`;
    } else {
      status = `❌ Wrong (Correct: ${optionLabels[q.correct_index]})`;
    }
    reviewText += `*Q${a.qIndex + 1}.* ${status} — ⏱ ${a.timeTaken}s\n`;
  });

  for (let i = answers.length; i < total; i++) {
    reviewText += `*Q${i + 1}.* ⏭ Not attempted\n`;
  }

  const grade =
    accuracy >= 90 ? '🏆 Outstanding' :
    accuracy >= 75 ? '🥇 Excellent' :
    accuracy >= 60 ? '🥈 Good' :
    accuracy >= 40 ? '🥉 Average' : '📉 Keep Practicing';

  const text =
    `📊 *My Result — ${c.name}*\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `✅ Correct:  *${score}*  (+${score} pts)\n` +
    `❌ Wrong:    *${wrong}*  (−${(wrong * 0.25).toFixed(2)} pts)\n` +
    `⏭ Skipped:  *${skipped}*  (0 pts)\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⭐ Net Score: *${netPoints.toFixed(2)} / ${total}*\n` +
    `📊 Accuracy: *${accuracy}%*\n` +
    `⏱ Time:      *${fmtTime(sub.time_taken_sec)}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${grade}\n\n` +
    `*Question-wise Review:*\n` +
    reviewText;

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🏅 Leaderboard', `ct_leaderboard_${contestId}`)],
      [Markup.button.callback('🔙 Contest Zone', 'ct_menu')],
    ]),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Show leaderboard
// ─────────────────────────────────────────────────────────────────────────────
async function showContestLeaderboard(ctx, contestId) {
  await ctx.answerCbQuery();
  let c, board;
  try {
    c     = await getContest(contestId);
    board = await getContestLeaderboard(contestId, 10);
  } catch (e) {
    return ctx.reply('❌ Could not load leaderboard. Try again.');
  }

  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

  let text = `🏅 *Leaderboard — ${c.name}*\n\n`;
  if (!board.length) {
    text += '_No results yet. Contest may still be running._';
  } else {
    board.forEach((row, i) => {
      const highlight = row.telegram_id === ctx.from.id ? ' ← You' : '';
      text +=
        `${medals[i] || `${i + 1}.`} *${row.name}*${highlight}\n` +
        `   Score: ${row.score} | Time: ${fmtTime(row.time_taken_sec)} | Rank #${row.rank}\n`;
    });
  }

  if (c.prize_pool > 0 && c.status === 'completed') {
    text += `\n💰 *Prize Pool: ₹${c.prize_pool}*\n_Top winners will be credited to their wallets._`;
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📊 My Result', `ct_myresult_${contestId}`)],
      [Markup.button.callback('🔙 Contest Zone', 'ct_menu')],
    ]),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Clear session + timers
// ─────────────────────────────────────────────────────────────────────────────
function clearContestSession(userId) {
  const session = contestSessions.get(userId);
  if (session) {
    if (session.qTimer) clearTimeout(session.qTimer);
    (session.tickTimers || []).forEach(t => clearTimeout(t));
  }
  contestSessions.delete(userId);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Admin: Create contest
// ─────────────────────────────────────────────────────────────────────────────
async function adminCreateContest(ctx, data) {
  const { name, category, startTime, durationMin, questionCount, prizePool, entryFee } = data;
  const start = new Date(startTime);
  const end   = new Date(start.getTime() + durationMin * 60000);

  const { data: contest, error } = await db.supabase
    .from('contests')
    .insert([{
      name,
      category,
      status: 'upcoming',
      start_time: start.toISOString(),
      end_time:   end.toISOString(),
      duration_min: durationMin,
      question_count: questionCount,
      prize_pool:  prizePool,
      entry_fee:   entryFee,
      is_paid:     entryFee > 0,
      created_by:  ctx.from.id,
    }])
    .select()
    .single();

  if (error) throw error;
  return contest;
}

// Assign questions to contest
async function adminAssignQuestions(contestId, questionIds) {
  const rows = questionIds.map((qid, i) => ({
    contest_id:  contestId,
    question_id: qid,
    sort_order:  i,
  }));
  const { error } = await db.supabase.from('contest_questions').insert(rows);
  if (error) throw error;
}

// Update contest status manually (admin override)
async function updateContestStatus(contestId, status) {
  const { error } = await db.supabase
    .from('contests')
    .update({ status })
    .eq('id', contestId);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
//  AUTO STATUS TRANSITION (runs every 60s)
//  • upcoming  → live      when now >= start_time
//  • live      → completed when now >= end_time
// ─────────────────────────────────────────────────────────────────────────────
async function runAutoTransitions() {
  try {
    const now = new Date().toISOString();

    // upcoming → live
    const { data: toLive } = await db.supabase
      .from('contests')
      .select('id, name')
      .eq('status', 'upcoming')
      .lte('start_time', now);

    if (toLive && toLive.length > 0) {
      for (const c of toLive) {
        await db.supabase.from('contests').update({ status: 'live' }).eq('id', c.id);
        console.log(`✅ Contest auto-transitioned to LIVE: [${c.id}] ${c.name}`);
      }
    }

    // live → completed
    const { data: toComplete } = await db.supabase
      .from('contests')
      .select('id, name')
      .eq('status', 'live')
      .lte('end_time', now);

    if (toComplete && toComplete.length > 0) {
      for (const c of toComplete) {
        await db.supabase.from('contests').update({ status: 'completed' }).eq('id', c.id);
        console.log(`✅ Contest auto-transitioned to COMPLETED: [${c.id}] ${c.name}`);
      }
    }
  } catch (e) {
    console.error('Auto-transition error:', e.message);
  }
}

function startAutoTransitionCron() {
  runAutoTransitions();
  setInterval(runAutoTransitions, 60 * 1000);
  console.log('🕐 Contest auto-transition cron started (every 60s)');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Register all contest handlers on bot
// ─────────────────────────────────────────────────────────────────────────────
function registerContestHandlers(bot) {
  bot.action('ct_menu', (ctx) => showContestMenu(ctx));
  bot.action('ct_registered_info', (ctx) => ctx.answerCbQuery('You are already registered! You\'ll get a reminder when it goes live.'));

  bot.action('ct_live',      (ctx) => showContestList(ctx, 'live'));
  bot.action('ct_upcoming',  (ctx) => showContestList(ctx, 'upcoming'));
  bot.action('ct_completed', (ctx) => showContestList(ctx, 'completed'));

  bot.action(/ct_detail_(\d+)/, (ctx) => showContestDetail(ctx, parseInt(ctx.match[1])));
  bot.action(/ct_register_(\d+)/, (ctx) => handleRegister(ctx, parseInt(ctx.match[1])));
  bot.action(/ct_join_(\d+)/, (ctx) => handleJoinAndStart(ctx, parseInt(ctx.match[1])));

  bot.action(/ct_start_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await startContestAttempt(ctx, parseInt(ctx.match[1]));
  });

  bot.action(/ct_pay_(\d+)/, (ctx) => {
    ctx.answerCbQuery();
    ctx.reply('💳 Payment integration coming soon! (Razorpay/UPI)');
  });

  // Answer: ct_ans_{userId}_{contestId}_{optionIndex}
  bot.action(/ct_ans_(\d+)_(\d+)_(\d+)/, async (ctx) => {
    const userId    = parseInt(ctx.match[1]);
    const contestId = parseInt(ctx.match[2]);
    const chosen    = parseInt(ctx.match[3]);
    await handleContestAnswer(ctx, userId, contestId, chosen);
  });

  bot.action(/ct_myresult_(\d+)/, (ctx) => showMyResult(ctx, parseInt(ctx.match[1])));
  bot.action(/ct_leaderboard_(\d+)/, (ctx) => showContestLeaderboard(ctx, parseInt(ctx.match[1])));
}

module.exports = {
  showContestMenu,
  registerContestHandlers,
  adminCreateContest,
  adminAssignQuestions,
  updateContestStatus,
  clearContestSession,
  startAutoTransitionCron,
};
