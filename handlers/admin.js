// handlers/admin.js  —  Full admin panel for question management

const { Markup } = require('telegraf');
const db = require('../db/supabase');

const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(Boolean);

function isAdmin(ctx) {
  return ADMIN_IDS.includes(ctx.from?.id);
}

function adminGuard(ctx, next) {
  if (!isAdmin(ctx)) {
    return ctx.reply('⛔ You are not authorized to use admin commands.');
  }
  return next();
}

// ── Admin state machine (per user) ────────────────────────────
const adminState = new Map(); // userId -> { step, data }

function setState(userId, state) { adminState.set(userId, state); }
function getState(userId) { return adminState.get(userId) || null; }
function clearState(userId) { adminState.delete(userId); }

// ── /admin — main panel ───────────────────────────────────────
async function showAdminPanel(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access denied.');

  const [examCount, contestCount, battleCount] = await Promise.all([
    db.countQuestions({ zone: 'exam' }).catch(() => 0),
    db.countQuestions({ zone: 'contest' }).catch(() => 0),
    db.countQuestions({ zone: 'battle' }).catch(() => 0),
  ]);

  const text =
    `🛠 *Admin Panel — RankRiser247*\n\n` +
    `📚 Exam Zone questions: *${examCount}*\n` +
    `🏆 Contest Zone questions: *${contestCount}*\n` +
    `⚔️ Battle Zone questions: *${battleCount}*\n\n` +
    `Choose an action:`;

  return ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('➕ Add Question', 'adm_add')],
      [Markup.button.callback('📋 List Questions', 'adm_list'), Markup.button.callback('🔍 Find by ID', 'adm_find')],
      [Markup.button.callback('✏️ Edit Question', 'adm_edit'), Markup.button.callback('🗑 Delete Question', 'adm_delete')],
      [Markup.button.callback('📊 Stats', 'adm_stats')],
    ]),
  });
}

// ── ADD QUESTION flow ─────────────────────────────────────────
async function startAddQuestion(ctx) {
  setState(ctx.from.id, { step: 'add_zone', data: {} });
  return ctx.reply(
    '➕ *Add New Question*\n\nStep 1/7 — Select Zone:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📚 Exam Zone', 'adm_zone_exam')],
        [Markup.button.callback('🏆 Contest Zone', 'adm_zone_contest')],
        [Markup.button.callback('⚔️ Battle Zone', 'adm_zone_battle')],
        [Markup.button.callback('❌ Cancel', 'adm_cancel')],
      ]),
    }
  );
}

function handleZoneSelect(zone) {
  return async (ctx) => {
    ctx.answerCbQuery();
    const state = getState(ctx.from.id);
    if (!state) return;
    state.data.zone = zone;
    state.step = 'add_category';
    setState(ctx.from.id, state);

    return ctx.reply(
      '📂 Step 2/7 — Select Category:',
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('SSC CGL', 'adm_cat_ssc_cgl'), Markup.button.callback('Railway NTPC', 'adm_cat_railway_ntpc')],
          [Markup.button.callback('Bank PO', 'adm_cat_bank_po'), Markup.button.callback('UPSC', 'adm_cat_upsc')],
          [Markup.button.callback('General GK', 'adm_cat_general')],
          [Markup.button.callback('❌ Cancel', 'adm_cancel')],
        ]),
      }
    );
  };
}

function handleCategorySelect(category) {
  return async (ctx) => {
    ctx.answerCbQuery();
    const state = getState(ctx.from.id);
    if (!state) return;
    state.data.category = category;
    state.step = 'add_question';
    setState(ctx.from.id, state);
    return ctx.reply('📝 Step 3/7 — Type the *question text*:\n\n_Example: What is the capital of India?_', { parse_mode: 'Markdown' });
  };
}

// ── LIST questions ────────────────────────────────────────────
async function listQuestions(ctx, zone = null, category = null, page = 1) {
  try {
    const { data, total } = await db.listQuestions({ zone, category, page, limit: 8 });
    if (!data || data.length === 0) return ctx.reply('No questions found.');

    let text = `📋 *Questions* (${total} total) — Page ${page}\n\n`;
    data.forEach((q, i) => {
      const status = q.is_active ? '✅' : '❌';
      text += `${status} *ID ${q.id}* [${q.zone}/${q.category}]\n_${q.question.substring(0, 60)}${q.question.length > 60 ? '...' : ''}_\n\n`;
    });

    const totalPages = Math.ceil(total / 8);
    const navBtns = [];
    if (page > 1) navBtns.push(Markup.button.callback('◀️ Prev', `adm_list_page_${page - 1}`));
    if (page < totalPages) navBtns.push(Markup.button.callback('Next ▶️', `adm_list_page_${page + 1}`));

    return ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('All', 'adm_list_all'),
          Markup.button.callback('Exam', 'adm_list_zone_exam'),
          Markup.button.callback('Contest', 'adm_list_zone_contest'),
          Markup.button.callback('Battle', 'adm_list_zone_battle'),
        ],
        navBtns.length ? navBtns : [],
        [Markup.button.callback('🔙 Admin Panel', 'adm_home')],
      ]),
    });
  } catch (e) {
    return ctx.reply('❌ Error fetching questions: ' + e.message);
  }
}

// ── STATS ─────────────────────────────────────────────────────
async function showStats(ctx) {
  try {
    const zones = ['exam', 'contest', 'battle'];
    const cats  = ['ssc_cgl', 'railway_ntpc', 'bank_po', 'upsc', 'general'];

    const counts = await Promise.all(
      zones.map(z => db.countQuestions({ zone: z }).catch(() => 0))
    );
    const catCounts = await Promise.all(
      cats.map(c => db.countQuestions({ category: c }).catch(() => 0))
    );

    let text = '📊 *Question Bank Stats*\n\n*By Zone:*\n';
    zones.forEach((z, i) => { text += `• ${z}: *${counts[i]}* questions\n`; });
    text += '\n*By Category:*\n';
    cats.forEach((c, i) => { text += `• ${c}: *${catCounts[i]}*\n`; });

    return ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Admin Panel', 'adm_home')]]),
    });
  } catch (e) {
    return ctx.reply('❌ Error: ' + e.message);
  }
}

// ── Handle text input during add/edit flows ───────────────────
async function handleAdminText(ctx) {
  if (!isAdmin(ctx)) return;
  const state = getState(ctx.from.id);
  if (!state) return; // not in admin flow, let other handlers take it

  const text = ctx.message.text.trim();

  // ── ADD flow steps ─────────────────────────────────────────
  if (state.step === 'add_question') {
    state.data.question = text;
    state.step = 'add_optA';
    setState(ctx.from.id, state);
    return ctx.reply('🅰️ Step 4/7 — Type *Option A*:', { parse_mode: 'Markdown' });
  }

  if (state.step === 'add_optA') {
    state.data.optA = text;
    state.step = 'add_optB';
    setState(ctx.from.id, state);
    return ctx.reply('🅱️ Step 4/7 — Type *Option B*:', { parse_mode: 'Markdown' });
  }

  if (state.step === 'add_optB') {
    state.data.optB = text;
    state.step = 'add_optC';
    setState(ctx.from.id, state);
    return ctx.reply('🅲 Step 4/7 — Type *Option C*:', { parse_mode: 'Markdown' });
  }

  if (state.step === 'add_optC') {
    state.data.optC = text;
    state.step = 'add_optD';
    setState(ctx.from.id, state);
    return ctx.reply('🅳 Step 4/7 — Type *Option D*:', { parse_mode: 'Markdown' });
  }

  if (state.step === 'add_optD') {
    state.data.optD = text;
    state.step = 'add_correct';
    setState(ctx.from.id, state);
    const d = state.data;
    return ctx.reply(
      `✅ Step 5/7 — Which is the *correct answer*?\n\nA: ${d.optA}\nB: ${d.optB}\nC: ${d.optC}\nD: ${d.optD}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('A', 'adm_correct_0'), Markup.button.callback('B', 'adm_correct_1'),
           Markup.button.callback('C', 'adm_correct_2'), Markup.button.callback('D', 'adm_correct_3')],
        ]),
      }
    );
  }

  if (state.step === 'add_explanation') {
    state.data.explanation = text;
    state.step = 'add_confirm';
    setState(ctx.from.id, state);
    return confirmAddQuestion(ctx, state.data);
  }

  // ── EDIT flow steps ────────────────────────────────────────
  if (state.step === 'edit_find_id') {
    const id = parseInt(text);
    if (isNaN(id)) return ctx.reply('Please enter a valid numeric ID.');
    try {
      const q = await db.getQuestionById(id);
      state.data.editId = id;
      state.data.editQ = q;
      state.step = 'edit_menu';
      setState(ctx.from.id, state);
      return showEditMenu(ctx, q);
    } catch (e) {
      return ctx.reply('❌ Question not found. Try again or /admin to cancel.');
    }
  }

  if (state.step === 'edit_question_text') {
    await db.updateQuestion(state.data.editId, { question: text });
    clearState(ctx.from.id);
    return ctx.reply('✅ Question text updated!', Markup.inlineKeyboard([[Markup.button.callback('🔙 Admin Panel', 'adm_home')]]));
  }

  if (state.step === 'edit_explanation') {
    await db.updateQuestion(state.data.editId, { explanation: text });
    clearState(ctx.from.id);
    return ctx.reply('✅ Explanation updated!', Markup.inlineKeyboard([[Markup.button.callback('🔙 Admin Panel', 'adm_home')]]));
  }

  // ── DELETE flow ────────────────────────────────────────────
  if (state.step === 'delete_find_id') {
    const id = parseInt(text);
    if (isNaN(id)) return ctx.reply('Please enter a valid numeric ID.');
    try {
      const q = await db.getQuestionById(id);
      state.data.deleteId = id;
      state.step = 'delete_confirm';
      setState(ctx.from.id, state);
      return ctx.reply(
        `🗑 *Confirm Delete?*\n\nID: ${q.id}\nQuestion: _${q.question}_`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Yes, Delete', 'adm_delete_confirm'), Markup.button.callback('❌ Cancel', 'adm_cancel')],
          ]),
        }
      );
    } catch (e) {
      return ctx.reply('❌ Question not found.');
    }
  }

  // ── FIND by ID ─────────────────────────────────────────────
  if (state.step === 'find_id') {
    const id = parseInt(text);
    if (isNaN(id)) return ctx.reply('Please enter a valid numeric ID.');
    try {
      const q = await db.getQuestionById(id);
      clearState(ctx.from.id);
      const opts = q.options || [];
      return ctx.reply(
        `🔍 *Question ID ${q.id}*\n\n` +
        `Zone: ${q.zone} | Category: ${q.category}\n` +
        `Status: ${q.is_active ? '✅ Active' : '❌ Inactive'}\n\n` +
        `*Q: ${q.question}*\n\n` +
        `A: ${opts[0]}\nB: ${opts[1]}\nC: ${opts[2]}\nD: ${opts[3]}\n\n` +
        `✅ Correct: Option ${['A','B','C','D'][q.correct_index]} — ${opts[q.correct_index]}\n\n` +
        `📖 _${q.explanation || 'No explanation'}_`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✏️ Edit', `adm_edit_id_${q.id}`), Markup.button.callback('🗑 Delete', `adm_del_id_${q.id}`)],
            [Markup.button.callback(q.is_active ? '❌ Deactivate' : '✅ Activate', `adm_toggle_${q.id}`)],
            [Markup.button.callback('🔙 Admin Panel', 'adm_home')],
          ]),
        }
      );
    } catch (e) {
      return ctx.reply('❌ Question not found.');
    }
  }
}

async function confirmAddQuestion(ctx, data) {
  const opts = [data.optA, data.optB, data.optC, data.optD];
  const correctLabels = ['A', 'B', 'C', 'D'];
  const text =
    `📋 *Confirm New Question*\n\n` +
    `Zone: *${data.zone}* | Category: *${data.category}*\n\n` +
    `*Q: ${data.question}*\n\n` +
    `A: ${data.optA}\nB: ${data.optB}\nC: ${data.optC}\nD: ${data.optD}\n\n` +
    `✅ Correct: *Option ${correctLabels[data.correct_index]}* — ${opts[data.correct_index]}\n\n` +
    `📖 Explanation: _${data.explanation || 'None'}_`;

  return ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ Save Question', 'adm_save'), Markup.button.callback('❌ Cancel', 'adm_cancel')],
    ]),
  });
}

function showEditMenu(ctx, q) {
  return ctx.reply(
    `✏️ *Editing Question ID ${q.id}*\n\n_${q.question}_\n\nWhat do you want to edit?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📝 Question Text', 'adm_edit_field_question')],
        [Markup.button.callback('📖 Explanation', 'adm_edit_field_explanation')],
        [Markup.button.callback(q.is_active ? '❌ Deactivate' : '✅ Activate', `adm_toggle_${q.id}`)],
        [Markup.button.callback('🔙 Admin Panel', 'adm_cancel')],
      ]),
    }
  );
}

// ── Register all admin handlers on bot ────────────────────────
function registerAdminHandlers(bot) {
  bot.command('admin', adminGuard, (ctx) => showAdminPanel(ctx));

  // Main panel actions
  bot.action('adm_home', (ctx) => { ctx.answerCbQuery(); showAdminPanel(ctx); });
  bot.action('adm_add',  (ctx) => { ctx.answerCbQuery(); startAddQuestion(ctx); });
  bot.action('adm_stats',(ctx) => { ctx.answerCbQuery(); showStats(ctx); });

  // Zone select
  bot.action('adm_zone_exam',    handleZoneSelect('exam'));
  bot.action('adm_zone_contest', handleZoneSelect('contest'));
  bot.action('adm_zone_battle',  handleZoneSelect('battle'));

  // Category select
  bot.action('adm_cat_ssc_cgl',      handleCategorySelect('ssc_cgl'));
  bot.action('adm_cat_railway_ntpc', handleCategorySelect('railway_ntpc'));
  bot.action('adm_cat_bank_po',      handleCategorySelect('bank_po'));
  bot.action('adm_cat_upsc',         handleCategorySelect('upsc'));
  bot.action('adm_cat_general',      handleCategorySelect('general'));

  // Correct answer select
  [0, 1, 2, 3].forEach(i => {
    bot.action(`adm_correct_${i}`, async (ctx) => {
      ctx.answerCbQuery();
      const state = getState(ctx.from.id);
      if (!state) return;
      state.data.correct_index = i;
      state.step = 'add_explanation';
      setState(ctx.from.id, state);
      ctx.reply('📖 Step 6/7 — Type an *explanation* for this answer (or type "skip" to skip):', { parse_mode: 'Markdown' });
    });
  });

  // Save new question
  bot.action('adm_save', async (ctx) => {
    ctx.answerCbQuery();
    const state = getState(ctx.from.id);
    if (!state) return;
    const d = state.data;
    try {
      const q = await db.addQuestion({
        zone: d.zone,
        category: d.category,
        question: d.question,
        options: [d.optA, d.optB, d.optC, d.optD],
        correct_index: d.correct_index,
        explanation: d.explanation === 'skip' ? '' : d.explanation,
      });
      clearState(ctx.from.id);
      ctx.reply(
        `✅ *Question saved! ID: ${q.id}*\n\nZone: ${q.zone} | Category: ${q.category}`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('➕ Add Another', 'adm_add'), Markup.button.callback('🔙 Panel', 'adm_home')]]) }
      );
    } catch (e) {
      ctx.reply('❌ Error saving: ' + e.message);
    }
  });

  // List actions
  bot.action('adm_list',          (ctx) => { ctx.answerCbQuery(); listQuestions(ctx); });
  bot.action('adm_list_all',      (ctx) => { ctx.answerCbQuery(); listQuestions(ctx); });
  bot.action('adm_list_zone_exam',     (ctx) => { ctx.answerCbQuery(); listQuestions(ctx, 'exam'); });
  bot.action('adm_list_zone_contest',  (ctx) => { ctx.answerCbQuery(); listQuestions(ctx, 'contest'); });
  bot.action('adm_list_zone_battle',   (ctx) => { ctx.answerCbQuery(); listQuestions(ctx, 'battle'); });
  bot.action(/adm_list_page_(\d+)/, (ctx) => {
    ctx.answerCbQuery();
    const page = parseInt(ctx.match[1]);
    listQuestions(ctx, null, null, page);
  });

  // Find by ID
  bot.action('adm_find', (ctx) => {
    ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'find_id', data: {} });
    ctx.reply('🔍 Enter the *Question ID* to find:', { parse_mode: 'Markdown' });
  });

  // Edit actions
  bot.action('adm_edit', (ctx) => {
    ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'edit_find_id', data: {} });
    ctx.reply('✏️ Enter the *Question ID* to edit:', { parse_mode: 'Markdown' });
  });
  bot.action(/adm_edit_id_(\d+)/, async (ctx) => {
    ctx.answerCbQuery();
    const id = parseInt(ctx.match[1]);
    const q = await db.getQuestionById(id).catch(() => null);
    if (!q) return ctx.reply('Question not found.');
    setState(ctx.from.id, { step: 'edit_menu', data: { editId: id, editQ: q } });
    showEditMenu(ctx, q);
  });
  bot.action('adm_edit_field_question', (ctx) => {
    ctx.answerCbQuery();
    const state = getState(ctx.from.id);
    if (!state) return;
    state.step = 'edit_question_text';
    setState(ctx.from.id, state);
    ctx.reply('📝 Type the new *question text*:', { parse_mode: 'Markdown' });
  });
  bot.action('adm_edit_field_explanation', (ctx) => {
    ctx.answerCbQuery();
    const state = getState(ctx.from.id);
    if (!state) return;
    state.step = 'edit_explanation';
    setState(ctx.from.id, state);
    ctx.reply('📖 Type the new *explanation*:', { parse_mode: 'Markdown' });
  });

  // Toggle active/inactive
  bot.action(/adm_toggle_(\d+)/, async (ctx) => {
    ctx.answerCbQuery();
    const id = parseInt(ctx.match[1]);
    const q = await db.getQuestionById(id).catch(() => null);
    if (!q) return ctx.reply('Not found.');
    await db.toggleQuestion(id, !q.is_active);
    ctx.reply(`${!q.is_active ? '✅ Activated' : '❌ Deactivated'} Question ID ${id}`);
  });

  // Delete
  bot.action('adm_delete', (ctx) => {
    ctx.answerCbQuery();
    setState(ctx.from.id, { step: 'delete_find_id', data: {} });
    ctx.reply('🗑 Enter the *Question ID* to delete:', { parse_mode: 'Markdown' });
  });
  bot.action(/adm_del_id_(\d+)/, async (ctx) => {
    ctx.answerCbQuery();
    const id = parseInt(ctx.match[1]);
    setState(ctx.from.id, { step: 'delete_confirm', data: { deleteId: id } });
    const q = await db.getQuestionById(id).catch(() => null);
    if (!q) return ctx.reply('Not found.');
    ctx.reply(
      `🗑 *Confirm Delete?*\n\nID: ${q.id}\nQ: _${q.question}_`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('✅ Yes, Delete', 'adm_delete_confirm'), Markup.button.callback('❌ Cancel', 'adm_cancel')]]) }
    );
  });
  bot.action('adm_delete_confirm', async (ctx) => {
    ctx.answerCbQuery();
    const state = getState(ctx.from.id);
    if (!state?.data?.deleteId) return;
    await db.deleteQuestion(state.data.deleteId).catch(() => {});
    clearState(ctx.from.id);
    ctx.reply('🗑 Question deleted.', Markup.inlineKeyboard([[Markup.button.callback('🔙 Admin Panel', 'adm_home')]]));
  });

  // Cancel
  bot.action('adm_cancel', (ctx) => {
    ctx.answerCbQuery();
    clearState(ctx.from.id);
    showAdminPanel(ctx);
  });

  return { handleAdminText, getState, isAdmin };
}

module.exports = { registerAdminHandlers, isAdmin, getState, handleAdminText };
