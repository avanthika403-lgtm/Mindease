const express = require('express');

function createWellnessRouter({
  requireAuth,
  getUserData,
  renderPage,
  setFlash,
  pool,
  query,
  encryptField,
  demo,
  crypto,
  chatLimiter,
  crisisPattern,
  crisisMessage,
  crisisResources,
  getChatHistory,
  professionalHelpPattern,
  retrieveWellnessResources,
  groqConfigured,
  getUshaReply
}) {
  const router = express.Router();

  router.get('/dashboard', requireAuth, async (req, res, next) => {
    try {
      const data = await getUserData(req.session.user.id);
      const today = new Date().toISOString().slice(0, 10);
      const todayMood = data.moods.find((entry) => String(entry.entry_date).slice(0, 10) === today);
      renderPage(req, res, 'dashboard', { ...data, todayMood });
    } catch (error) { next(error); }
  });

  router.get('/mood', requireAuth, async (req, res, next) => {
    try { renderPage(req, res, 'mood', await getUserData(req.session.user.id)); }
    catch (error) { next(error); }
  });

  router.post('/mood', requireAuth, async (req, res, next) => {
    try {
      const score = Number(req.body.score);
      const screenMinutes = Number(req.body.screen_minutes || 0);
      const note = String(req.body.note || '').trim().slice(0, 500);
      const entryDate = String(req.body.entry_date || new Date().toISOString().slice(0, 10));
      if (!Number.isInteger(score) || score < 1 || score > 10 || !Number.isInteger(screenMinutes) || screenMinutes < 0 || screenMinutes > 1440 || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
        setFlash(req, 'error', 'Check the mood, screen time, and date fields.');
        return res.redirect('/mood');
      }
      if (pool) await query('INSERT INTO mood_entries (user_id, score, note, screen_minutes, entry_date) VALUES ($1, $2, $3, $4, $5)', [req.session.user.id, encryptField(score), encryptField(note), encryptField(screenMinutes), entryDate]);
      else demo.moods.push({ id: crypto.randomUUID(), user_id: req.session.user.id, score: encryptField(score), note: encryptField(note), screen_minutes: encryptField(screenMinutes), entry_date: entryDate, created_at: new Date().toISOString() });
      setFlash(req, 'success', 'Mood saved. Thank you for checking in.');
      res.redirect('/mood');
    } catch (error) { next(error); }
  });

  router.get('/diary', requireAuth, async (req, res, next) => {
    try { renderPage(req, res, 'diary', await getUserData(req.session.user.id)); }
    catch (error) { next(error); }
  });

  router.post('/diary', requireAuth, async (req, res, next) => {
    try {
      const fields = ['situation', 'thought', 'feeling', 'evidence_for', 'evidence_against', 'balanced_thought'];
      const entry = Object.fromEntries(fields.map((field) => [field, String(req.body[field] || '').trim().slice(0, 1800)]));
      if (fields.filter((field) => !['evidence_for', 'evidence_against'].includes(field)).some((field) => !entry[field])) {
        setFlash(req, 'error', 'Complete the situation, thought, feeling, and balanced-thought fields.');
        return res.redirect('/diary');
      }
      const encryptedEntry = fields.map((field) => encryptField(entry[field]));
      if (pool) await query('INSERT INTO diary_entries (user_id, situation, thought, feeling, evidence_for, evidence_against, balanced_thought) VALUES ($1, $2, $3, $4, $5, $6, $7)', [req.session.user.id, ...encryptedEntry]);
      else demo.diaries.push({ id: crypto.randomUUID(), user_id: req.session.user.id, ...Object.fromEntries(fields.map((field, index) => [field, encryptedEntry[index]])), created_at: new Date().toISOString() });
      setFlash(req, 'success', 'Your reflection has been saved privately.');
      res.redirect('/diary');
    } catch (error) { next(error); }
  });

  router.get('/chat', requireAuth, (req, res) => renderPage(req, res, 'chat'));

  router.post('/chat', requireAuth, chatLimiter, async (req, res) => {
    const message = String(req.body.message || '').trim().slice(0, 2000);
    if (!message) return res.json({ reply: 'Share as much or as little as feels right.', crisis: false, resources: [] });
    const history = getChatHistory(req.body.history);
    if (crisisPattern.test(message)) return res.json({ reply: crisisMessage, crisis: true, resources: crisisResources });
    const resourceSearchText = [...history.slice(-4).map((item) => item.content), message].join(' ');
    const retrievedResources = retrieveWellnessResources(resourceSearchText);
    const resources = [...retrievedResources.map(({ title, url }) => ({ label: title, url }))];
    if (professionalHelpPattern.test(resourceSearchText)) {
      resources.push(
        { label: 'Find professional or crisis support near you', url: 'https://findahelpline.com/' },
        { label: 'Mental health information from NIMH', url: 'https://www.nimh.nih.gov/health/topics/caring-for-your-mental-health' }
      );
    }
    if (!groqConfigured) {
      return res.json({
        reply: 'I’m here with you. What feels most important about this right now? You might also try naming one small thing you need in this moment.',
        crisis: false,
        resources,
        service: 'fallback'
      });
    }
    try {
      const reply = await getUshaReply(message, history, retrievedResources);
      res.json({ reply, crisis: false, resources });
    } catch (error) {
      console.error('USHA provider request failed:', error.message);
      res.status(502).json({
        reply: 'USHA is temporarily unavailable. You can try again shortly, or use the support links below to connect with a person.',
        crisis: false,
        resources,
        serviceUnavailable: true
      });
    }
  });

  router.get('/care', requireAuth, (req, res) => renderPage(req, res, 'care'));
  router.get('/insights', requireAuth, async (req, res, next) => {
    try { renderPage(req, res, 'insights', await getUserData(req.session.user.id)); }
    catch (error) { next(error); }
  });
  router.get('/help', requireAuth, (req, res) => renderPage(req, res, 'help'));

  return router;
}

module.exports = { createWellnessRouter };
