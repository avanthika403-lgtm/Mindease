const express = require('express');

function createSettingsRouter({
  requireAuth,
  renderPage,
  setFlash,
  pool,
  query,
  demo,
  bcrypt,
  signUserToken,
  setAuthCookie,
  clearAuthCookie
}) {
  const router = express.Router();

  router.get('/settings', requireAuth, (req, res) => renderPage(req, res, 'settings'));

  router.post('/settings/profile', requireAuth, async (req, res, next) => {
    try {
      const name = String(req.body.name || '').trim().slice(0, 80);
      const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setFlash(req, 'error', 'Add a name and a valid email address.');
        return res.redirect('/settings');
      }

      if (pool) {
        const conflict = await query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.session.user.id]);
        if (conflict.rows[0]) {
          setFlash(req, 'error', 'An account with that email already exists.');
          return res.redirect('/settings');
        }
        await query('UPDATE users SET name = $1, email = $2 WHERE id = $3', [name, email, req.session.user.id]);
      } else {
        const user = demo.users.find((item) => item.id === req.session.user.id);
        if (demo.users.some((item) => item.email === email && item.id !== req.session.user.id)) {
          setFlash(req, 'error', 'An account with that email already exists.');
          return res.redirect('/settings');
        }
        if (user) {
          user.name = name;
          user.email = email;
        }
      }

      const updatedUser = {
        id: req.session.user.id,
        name,
        email
      };
      const token = signUserToken(updatedUser);
      setAuthCookie(res, token);
      req.user = updatedUser;
      req.session.user = updatedUser;
      setFlash(req, 'success', 'Your profile has been updated.');
      res.redirect('/settings');
    } catch (error) {
      if (error.code === '23505') {
        setFlash(req, 'error', 'An account with that email already exists.');
        return res.redirect('/settings');
      }
      next(error);
    }
  });

  router.post('/settings/password', requireAuth, async (req, res, next) => {
    try {
      const current = String(req.body.current_password || '');
      const nextPassword = String(req.body.new_password || '');
      const user = pool
        ? (await query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id])).rows[0]
        : demo.users.find((item) => item.id === req.session.user.id);
      if (!user || !user.password_hash || !(await bcrypt.compare(current, user.password_hash)) || nextPassword.length < 10) {
        setFlash(req, 'error', 'Check your current password and use at least 10 characters for the new one.');
        return res.redirect('/settings');
      }
      const hash = await bcrypt.hash(nextPassword, 12);
      if (pool) await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.session.user.id]);
      else if (user) user.password_hash = hash;
      setFlash(req, 'success', 'Password updated.');
      res.redirect('/settings');
    } catch (error) { next(error); }
  });

  router.post('/settings/delete', requireAuth, async (req, res, next) => {
    try {
      const password = String(req.body.password || '');
      const user = pool
        ? (await query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id])).rows[0]
        : demo.users.find((item) => item.id === req.session.user.id);
      const passwordValid = Boolean(user?.password_hash && await bcrypt.compare(password, user.password_hash));
      if (!user || !passwordValid) {
        setFlash(req, 'error', 'Password not recognized. No data has been removed.');
        return res.redirect('/settings');
      }
      if (pool) {
        await query('DELETE FROM users WHERE id = $1', [req.session.user.id]);
      } else {
        demo.users = demo.users.filter((item) => item.id !== req.session.user.id);
        demo.moods = demo.moods.filter((item) => item.user_id !== req.session.user.id);
        demo.diaries = demo.diaries.filter((item) => item.user_id !== req.session.user.id);
      }
      clearAuthCookie(res);
      req.session.destroy(() => res.redirect('/'));
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createSettingsRouter };
