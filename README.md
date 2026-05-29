# RankRiser247 Telegram Quiz Bot

A full-featured Telegram bot mirroring your app's sections:
- 🏆 Contest Zone (live/upcoming tournaments with prize pools)
- 📚 Exam Zone (free & paid mock tests via Telegram Quiz Polls)
- ⚔️ Battle Zone (1v1 challenges)
- 👤 Profile (rank, quizzes, wins, wallet, achievements)

## Quick Start

1. **Create your bot** — message @BotFather on Telegram → `/newbot` → get your `BOT_TOKEN`

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure env**
   ```bash
   cp .env.example .env
   # Edit .env and add your BOT_TOKEN
   ```

4. **Run**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

## Bot Commands
| Command | Description |
|---------|-------------|
| `/start` | Main menu with keyboard |
| `/profile` | View your profile |
| `/contests` | Browse Contest Zone |
| `/exams` | Browse Exam Zone |
| `/leaderboard` | Top 5 leaderboard |

## Adding Real Questions
Replace `SAMPLE_QUESTIONS` in `index.js` with a DB query. Recommended schema:

```sql
CREATE TABLE questions (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER,
  question TEXT,
  options JSONB,       -- ["A", "B", "C", "D"]
  correct_index INTEGER,
  explanation TEXT
);
```

## Adding Payments (Razorpay)
1. Go to @BotFather → your bot → Payments → choose provider
2. Get your `PAYMENT_PROVIDER_TOKEN`
3. Replace `pay_contest_*` and `pay_exam_*` action handlers with:

```js
ctx.replyWithInvoice({
  title: exam.name,
  description: `${exam.questions} questions • ${exam.duration} min`,
  payload: `exam_${exam.id}_user_${ctx.from.id}`,
  provider_token: process.env.PAYMENT_PROVIDER_TOKEN,
  currency: 'INR',
  prices: [{ label: exam.name, amount: exam.price * 100 }]  // paise
});
```

## Production Deployment
- Deploy to a VPS (DigitalOcean, Railway, Render)
- Switch from polling to webhooks:
  ```js
  bot.launch({ webhook: { domain: 'https://yourdomain.com', port: 3000 } });
  ```
- Add PostgreSQL for persistent user data
- Add Redis for live contest state and timers
