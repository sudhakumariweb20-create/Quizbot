// utils/quizEngine.js  —  Timer, skip, scoring, session management

const TIMER_SEC = parseInt(process.env.QUESTION_TIMER_SECONDS || '30');

// Scoring constants
const POINTS_CORRECT  =  1;      // +1 for correct answer
const POINTS_WRONG    = -0.25;   // -0.25 (1/4) negative marking for wrong answer
const POINTS_SKIP     =  0;      // 0 for skipped / timeout

// Active quiz sessions: Map<userId, sessionData>
const activeSessions = new Map();
// Active timers: Map<userId, timeoutRef>
const activeTimers = new Map();
// Countdown interval trackers: Map<userId, intervalRef>
const countdownIntervals = new Map();

function createSession({ userId, questions, zone, category, examName }) {
  const session = {
    userId,
    zone,
    category,
    examName,
    questions,
    currentIndex: 0,
    score: 0,           // integer count of correct answers (for stats)
    points: 0,          // float score with negative marking (+1 / -0.25)
    wrong: 0,           // count of wrong answers
    skipped: 0,
    answers: [],        // { questionId, chosen, correct, timeTaken, points }
    startTime: Date.now(),
    questionStartTime: Date.now(),
    pollMessageIds: [], // to delete old polls
  };
  activeSessions.set(userId, session);
  return session;
}

function getSession(userId) {
  return activeSessions.get(userId) || null;
}

function clearSession(userId) {
  clearTimer(userId);
  activeSessions.delete(userId);
}

function recordAnswer(userId, chosenIndex) {
  const session = getSession(userId);
  if (!session) return null;

  const q = session.questions[session.currentIndex];
  const timeTaken = Math.round((Date.now() - session.questionStartTime) / 1000);
  const isCorrect = chosenIndex === q.correct_index;

  const pointsEarned = isCorrect ? POINTS_CORRECT : POINTS_WRONG;
  if (isCorrect) {
    session.score++;
  } else {
    session.wrong++;
  }
  session.points = Math.round((session.points + pointsEarned) * 100) / 100;

  session.answers.push({
    questionId: q.id,
    chosen: chosenIndex,
    correct: q.correct_index,
    isCorrect,
    timeTaken,
    points: pointsEarned,
  });
  session.currentIndex++;
  return { isCorrect, explanation: q.explanation, correct: q.correct_index, pointsEarned };
}

function recordSkip(userId) {
  const session = getSession(userId);
  if (!session) return;
  const q = session.questions[session.currentIndex];
  session.skipped++;
  session.answers.push({
    questionId: q.id,
    chosen: -1,
    correct: q.correct_index,
    isCorrect: false,
    timeTaken: TIMER_SEC,
    points: POINTS_SKIP,
    skipped: true,
  });
  session.currentIndex++;
}

function recordTimeout(userId) {
  const session = getSession(userId);
  if (!session) return;
  const q = session.questions[session.currentIndex];
  session.answers.push({
    questionId: q.id,
    chosen: -1,
    correct: q.correct_index,
    isCorrect: false,
    timeTaken: TIMER_SEC,
    points: POINTS_SKIP,
    timeout: true,
  });
  session.currentIndex++;
}

function isFinished(userId) {
  const session = getSession(userId);
  if (!session) return true;
  return session.currentIndex >= session.questions.length;
}

function getProgress(userId) {
  const session = getSession(userId);
  if (!session) return null;
  return {
    current: session.currentIndex + 1,
    total: session.questions.length,
    score: session.score,       // correct count
    wrong: session.wrong,       // wrong count
    skipped: session.skipped,
    points: session.points,     // float score with negative marking
  };
}

function getSummary(userId) {
  const session = getSession(userId);
  if (!session) return null;
  const totalTime = Math.round((Date.now() - session.startTime) / 1000);
  const total = session.questions.length;
  const pct = Math.round((session.score / total) * 100);
  const grade =
    pct >= 90 ? '🏆 Outstanding' :
    pct >= 75 ? '🥇 Excellent' :
    pct >= 60 ? '🥈 Good' :
    pct >= 40 ? '🥉 Average' : '📉 Keep Practicing';

  return {
    score: session.score,         // correct count (integer)
    wrong: session.wrong,         // wrong count (integer)
    points: session.points,       // net score after negative marking (float)
    total,
    skipped: session.skipped,
    pct,
    grade,
    totalTime,
    zone: session.zone,
    category: session.category,
    examName: session.examName,
    answers: session.answers,
  };
}

// ── Timer management ─────────────────────────────────────────

function startTimer(userId, onTimeout) {
  clearTimer(userId);
  const ref = setTimeout(() => {
    onTimeout(userId);
  }, TIMER_SEC * 1000);
  activeTimers.set(userId, ref);
}

function clearTimer(userId) {
  const ref = activeTimers.get(userId);
  if (ref) { clearTimeout(ref); activeTimers.delete(userId); }
}

// ── Countdown interval (updates message every second) ────────

function startCountdown(userId, onTick) {
  clearCountdown(userId);
  let remaining = TIMER_SEC;
  const ref = setInterval(() => {
    remaining--;
    if (remaining > 0) onTick(remaining);
    else clearCountdown(userId);
  }, 1000);
  countdownIntervals.set(userId, ref);
}

function clearCountdown(userId) {
  const ref = countdownIntervals.get(userId);
  if (ref) { clearInterval(ref); countdownIntervals.delete(userId); }
}

function getTimerSeconds() { return TIMER_SEC; }
function getScoringInfo() { return { POINTS_CORRECT, POINTS_WRONG, POINTS_SKIP }; }

module.exports = {
  createSession, getSession, clearSession,
  recordAnswer, recordSkip, recordTimeout,
  isFinished, getProgress, getSummary,
  startTimer, clearTimer,
  startCountdown, clearCountdown,
  getTimerSeconds, getScoringInfo,
};
