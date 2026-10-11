const express = require('express');
const { rateLimit } = require('express-rate-limit');

function createAuthRouter({
  pool,
  establishAuthSession,
  requireAuth,
  demo,
  bcrypt,
  crypto,
  setFlash,
  clearAuthCookie
}) {
  const router = express.Router();

  function formRateLimit({ windowMs, limit, message }) {
    return rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler(req, res) {
        setFlash(req, 'error', message);
        res.redirect(req.path.startsWith('/login') ? '/login' : '/register');
      }
    });
  }

  const loginLimiter = formRateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'There have been several sign-in attempts from this network. Please wait a little before trying again.'
  });

  const registerLimiter = formRateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 8,
    message: 'There have been several sign-up attempts from this network. Please wait before trying again.'
  });

  router.get('/register', (req, res) => {
    if (req.user || req.session?.user) return res.redirect('/dashboard');
    res.render('auth', { mode: 'register' });
  });

  router.get('/login', (req, res) => {
    if (req.user || req.session?.user) return res.redirect('/dashboard');
    res.render('auth', { mode: 'login' });
  });

  router.post('/register', registerLimiter, async (req, res, next) => {
    try {
      const name = String(req.body.name || '').trim().slice(0, 80);
      const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
      const password = String(req.body.password || '');

      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
        setFlash(req, 'error', 'Add your name, a valid email, and a password with at least 10 characters.');
        return res.redirect('/register');
      }

      const passwordHash = await bcrypt.hash(password, 12);

      if (pool) {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows[0]) {
          setFlash(req, 'error', 'An account with that email already exists.');
          return res.redirect('/register');
        }

        const result = await pool.query(
          'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
          [name, email, passwordHash]
        );
        const user = result.rows[0];
        return establishAuthSession(req, res, next, user);
      }

      if (demo.users.some((item) => item.email === email)) {
        setFlash(req, 'error', 'An account with that email already exists.');
        return res.redirect('/register');
      }

      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        password_hash: passwordHash
      };
      demo.users.push(user);
      return establishAuthSession(req, res, next, user);
    } catch (error) {
      if (error.code === '23505') {
        setFlash(req, 'error', 'An account with that email already exists.');
        return res.redirect('/register');
      }
      next(error);
    }
  });

  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
      const password = String(req.body.password || '');

      if (!email || !password) {
        setFlash(req, 'error', 'Enter your email address and password.');
        return res.redirect('/login');
      }

      const user = pool
        ? (await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email])).rows[0]
        : demo.users.find((item) => item.email === email);

      if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
        setFlash(req, 'error', 'That email and password combination was not recognized.');
        return res.redirect('/login');
      }

      return establishAuthSession(req, res, next, user);
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', requireAuth, (req, res) => {
    clearAuthCookie(res);
    req.session.destroy(() => res.redirect('/'));
  });

  router.get('/api/auth/me', (req, res) => {
    const user = req.user || req.session?.user;
    if (!user) return res.status(401).json({ authenticated: false });
    res.json({ authenticated: true, user });
  });

  return router;
}

module.exports = { createAuthRouter };
