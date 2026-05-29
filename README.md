# RankRiser247 Bot v2 — Setup Guide

## What's New in v2
- ⏱ **30-second timer** per question (configurable)
- ⏭ **Skip button** on every question
- 🛠 **Admin Panel** — add/edit/delete/list questions via Telegram
- 🗄 **Supabase database** — question bank, users, session history
- 📊 **Auto & Manual modes** — random questions or ordered set
- 🎯 Questions for all zones: Exam, Contest, Battle

---

## Step 1 — Supabase Setup (Free)

1. Go to **supabase.com** → New Project (free tier)
2. Wait for it to spin up (~2 min)
3. Go to **SQL Editor** → New Query
4. Paste the entire contents of `supabase_schema.sql` → click **Run**
5. You'll see "35 rows inserted" — your question bank is ready!

**Get your credentials:**
- Go to **Project Settings → API**
- Copy `Project URL` → this is your `SUPABASE_URL`
- Copy `service_role` key (not anon key) → this is your `SUPABASE_SERVICE_KEY`

---

## Step 2 — Environment Variables

Rename `.env.example` → `.env` and fill in:

```
BOT_TOKEN=your_telegram_bot_token
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...your_service_role_key
ADMIN_IDS=your_telegram_user_id
QUESTION_TIMER_SECONDS=30
QUESTIONS_PER_SESSION=10
```

**How to get your Telegram user ID:**
- Message @userinfobot on Telegram → it replies with your ID

---

## Step 3 — Install & Run

```bash
npm install
npm start
```

You should see: `✅ RankRiser247 Bot v2 started`

---

## Step 4 — Deploy on Railway

In Railway → Variables tab, add ALL variables from `.env`:
- `BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ADMIN_IDS`
- `QUESTION_TIMER_SECONDS` = 30
- `QUESTIONS_PER_SESSION` = 10

Then Redeploy.

---

## Admin Panel Usage

Send `/admin` in your bot (only works for user IDs in ADMIN_IDS).

### Add a question:
1. `/admin` → ➕ Add Question
2. Select Zone (Exam / Contest / Battle)
3. Select Category (SSC CGL / Railway / Bank PO / UPSC / General)
4. Type question text
5. Type options A, B, C, D one by one
6. Select correct answer
7. Type explanation (or type "skip")
8. Confirm → saved to Supabase!

### Edit a question:
`/admin` → ✏️ Edit Question → enter ID → edit text or explanation

### Delete a question:
`/admin` → 🗑 Delete Question → enter ID → confirm

### View all questions:
`/admin` → 📋 List Questions → filter by zone

### Find by ID:
`/admin` → 🔍 Find by ID → enter number

---

## Auto vs Manual Mode

In `index.js`, each exam has `mode: 'auto'` (default):
- **auto** — picks random questions from the category each time
- **manual** — serves questions in `sort_order` sequence

To switch an exam to manual mode:
```js
// In index.js, change the exam_start handler:
await startQuiz(ctx, {
  zone: exam.zone,
  category: exam.category,
  examName: exam.name,
  count: exam.questions,
  mode: 'manual',  // ← change this
});
```

Set `sort_order` values in Supabase table to control question sequence.

---

## Adding More Questions

### Option A — Via bot admin panel (easiest)
Send `/admin` → ➕ Add Question

### Option B — Via Supabase dashboard
Go to Supabase → Table Editor → questions → Insert Row

### Option C — Via SQL
```sql
INSERT INTO questions (zone, category, question, options, correct_index, explanation)
VALUES (
  'exam',
  'ssc_cgl',
  'Your question here?',
  '["Option A", "Option B", "Option C", "Option D"]',
  1,  -- 0=A, 1=B, 2=C, 3=D
  'Explanation text here.'
);
```

---

## File Structure
```
quiz_bot_v2/
├── index.js              ← Main bot, all zones & commands
├── package.json
├── .env.example
├── supabase_schema.sql   ← Run once in Supabase SQL editor
├── db/
│   └── supabase.js       ← All database operations
├── handlers/
│   ├── quiz.js           ← Timer, skip, answer, results
│   └── admin.js          ← Full admin panel
└── utils/
    └── quizEngine.js     ← Session state, scoring logic
```
