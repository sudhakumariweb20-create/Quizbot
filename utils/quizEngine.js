// utils/quizEngine.js  —  Timer, skip, scoring, session management

const TIMER_SEC = parseInt(process.env.QUESTION_TIMER_SECONDS || '30');

// Active quiz sessions: Map<userId, sessionData>
const activeSessions = new Map();
// Active timers: Map<userId, timeoutRef>
const activeTimers = new Map();

function createSession({ userId, questions, zone, category, examName }) {
  const session = {
    userId,
    zone,
    category,
    examName,
    questions,
    currentIndex: 0,
    score: 0,
    skipped: 0,
    answers: [],          // { questionId, chosen, correct, timeTaken }
    startTime: Date.now(),
    questionStartTime: Date.now(),
    pollMessageIds: [],   // to delete old polls
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

  if (isCorrect) session.score++;
  session.answers.push({
    questionId: q.id,
    chosen: chosenIndex,
    correct: q.correct_index,
    isCorrect,
    timeTaken,
  });
  session.currentIndex++;
  return { isCorrect, explanation: q.explanation, correct: q.correct_index };
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
    score: session.score,
    skipped: session.skipped,
  };
}

function getSummary(userId) {
  const session = getSession(userId);
  if (!session) return null;
  const totalTime = Math.round((Date.now() - session.startTime) / 1000);
  const pct = Math.round((session.score / session.questions.length) * 100);
  const grade =
    pct >= 90 ? '🏆 Outstanding' :
    pct >= 75 ? '🥇 Excellent' :
    pct >= 60 ? '🥈 Good' :
    pct >= 40 ? '🥉 Average' : '📉 Keep Practicing';

  return {
    score: session.score,
    total: session.questions.length,
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

function getTimerSeconds() { return TIMER_SEC; }

module.exports = {
  createSession, getSession, clearSession,
  recordAnswer, recordSkip, recordTimeout,
  isFinished, getProgress, getSummary,
  startTimer, clearTimer, getTimerSeconds,
};
