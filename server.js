require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');
const { csrfSync } = require('csrf-sync');
const { generateSecret, generateURI, verify } = require('otplib');
const QRCode = require('qrcode');

const app = express();
const port = Number(process.env.PORT) || 3000;
if ((process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) || ((process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) && !process.env.DATA_ENCRYPTION_KEY)) {
  throw new Error('Set SESSION_SECRET in production and DATA_ENCRYPTION_KEY whenever PostgreSQL or production mode is enabled.');
}
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined }) : null;
const demo = { users: [], moods: [], diaries: [] };
const encryptionKey = crypto.createHash('sha256').update(process.env.DATA_ENCRYPTION_KEY || 'local-demo-encryption-key-change-before-deployment').digest();
const { generateToken, csrfSynchronisedProtection } = csrfSync({
  getTokenFromRequest: (req) => req.headers['x-csrf-token'] || req.body?._csrf
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
  connectSrc: ["'self'"]
} } }));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  name: 'mindease.sid',
  secret: process.env.SESSION_SECRET || 'local-development-secret-change-before-deploying',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 },
  ...(pool ? { store: new (require('connect-pg-simple')(session))({ pool, createTableIfMissing: true }) } : {})
}));
app.use((req, res, next) => {
  res.locals.csrfToken = generateToken(req);
  next();
});
app.use(csrfSynchronisedProtection);
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.totpSetup = null;
  res.locals.currentPath = req.path;
  res.locals.demoMode = !pool;
  next();
});

const crisisPattern = /\b(suicid(?:e|al)|kill myself|end my life|self[- ]harm|hurt myself|want to die|better off dead)\b/i;
const crisisMessage = 'If you may act on these thoughts, call emergency services now or go to the nearest emergency department. In the U.S. or Canada, call or text 988. In India, call Tele-MANAS at 14416. If you are elsewhere, contact your local crisis line. If you can, tell someone you trust and stay with them.';

function encryptField(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptField(value) {
  if (typeof value !== 'string' || !value.startsWith('v1.')) return String(value ?? '');
  const [, iv, tag, encrypted] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

function revealMood(entry) {
  return { ...entry, score: Number(decryptField(entry.score)), screen_minutes: Number(decryptField(entry.screen_minutes || '0')), note: decryptField(entry.note) };
}

function revealDiary(entry) {
  return Object.fromEntries(Object.entries(entry).map(([key, value]) => ['situation', 'thought', 'feeling', 'evidence_for', 'evidence_against', 'balanced_thought'].includes(key) ? [key, decryptField(value)] : [key, value]));
}

async function query(text, values = []) {
  if (!pool) throw new Error('Database is not configured');
  return pool.query(text, values);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function establishSession(req, res, next, user) {
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.user = user;
    req.session.save((saveError) => saveError ? next(saveError) : res.redirect('/dashboard'));
  });
}

async function getUserData(userId) {
  if (!pool) {
    return {
      moods: demo.moods.filter((entry) => entry.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(revealMood),
      diaries: demo.diaries.filter((entry) => entry.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(revealDiary)
    };
  }
  const [moods, diaries] = await Promise.all([
    query('SELECT * FROM mood_entries WHERE user_id = $1 ORDER BY entry_date DESC, created_at DESC LIMIT 90', [userId]),
    query('SELECT * FROM diary_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId])
  ]);
  return { moods: moods.rows.map(revealMood), diaries: diaries.rows.map(revealDiary) };
}

function renderPage(req, res, page, extras = {}) {
  res.render('app', { page, totpSetup: null, ...extras });
}

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('home');
});

app.get('/register', (req, res) => res.render('auth', { mode: 'register' }));
app.get('/login', (req, res) => res.render('auth', { mode: 'login' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: 'Too many attempts. Please wait a few minutes and try again.' });

app.post('/register', authLimiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
    const password = String(req.body.password || '');
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
      setFlash(req, 'error', 'Add your name, a valid email, and a password with at least 10 characters.');
      return res.redirect('/register');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    let user;
    if (pool) {
      const result = await query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email', [name, email, passwordHash]);
      user = result.rows[0];
    } else {
      if (demo.users.some((item) => item.email === email)) {
        setFlash(req, 'error', 'An account with that email already exists.');
        return res.redirect('/register');
      }
      user = { id: crypto.randomUUID(), name, email, password_hash: passwordHash, totp_enabled: false, totp_secret: null };
      demo.users.push(user);
    }
    establishSession(req, res, next, { id: user.id, name: user.name, email: user.email, totpEnabled: false });
  } catch (error) {
    if (error.code === '23505') {
      setFlash(req, 'error', 'An account with that email already exists.');
      return res.redirect('/register');
    }
    next(error);
  }
});

app.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = pool
      ? (await query('SELECT id, name, email, password_hash, totp_secret, totp_enabled FROM users WHERE email = $1', [email])).rows[0]
      : demo.users.find((item) => item.email === email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      setFlash(req, 'error', 'That email and password combination was not recognized.');
      return res.redirect('/login');
    }
    if (user.totp_enabled) {
      const result = await verify({ secret: decryptField(user.totp_secret), token: String(req.body.totp || '').trim() });
      if (!result.valid) {
        setFlash(req, 'error', 'Enter a valid authenticator code to finish signing in.');
        return res.redirect('/login');
      }
    }
    establishSession(req, res, next, { id: user.id, name: user.name, email: user.email, totpEnabled: Boolean(user.totp_enabled) });
  } catch (error) { next(error); }
});

app.post('/logout', requireAuth, (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const data = await getUserData(req.session.user.id);
    const today = new Date().toISOString().slice(0, 10);
    const todayMood = data.moods.find((entry) => String(entry.entry_date).slice(0, 10) === today);
    renderPage(req, res, 'dashboard', { ...data, todayMood });
  } catch (error) { next(error); }
});

app.get('/mood', requireAuth, async (req, res, next) => {
  try { renderPage(req, res, 'mood', await getUserData(req.session.user.id)); }
  catch (error) { next(error); }
});

app.post('/mood', requireAuth, async (req, res, next) => {
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

app.get('/diary', requireAuth, async (req, res, next) => {
  try { renderPage(req, res, 'diary', await getUserData(req.session.user.id)); }
  catch (error) { next(error); }
});

app.post('/diary', requireAuth, async (req, res, next) => {
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

app.get('/chat', requireAuth, (req, res) => renderPage(req, res, 'chat'));

app.post('/chat', requireAuth, async (req, res) => {
  const message = String(req.body.message || '').trim().slice(0, 2000);
  if (!message) return res.json({ reply: 'Share as much or as little as feels right.', crisis: false });
  if (crisisPattern.test(message)) return res.json({ reply: crisisMessage, crisis: true });
  if (!process.env.GEMINI_API_KEY) return res.json({ reply: 'I’m here with you. What feels most important about this right now? You might also try naming one small thing you need in this moment.', crisis: false });
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || 'gemini-2.5-flash')}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_instruction: { parts: [{ text: 'You are USHA, a warm and careful self-help companion, not a therapist. Listen without diagnosing, offer gentle reflective prompts and practical self-care, and encourage professional support when appropriate. Be concise. Never claim to provide emergency care. If the user may be in immediate danger, tell them to contact emergency services and a trusted person now.' }] }, contents: [{ parts: [{ text: message }] }] })
    });
    const result = await response.json();
    const reply = result.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join(' ').trim();
    res.json({ reply: response.ok && reply ? reply : 'I’m having trouble responding just now. Take a slow breath, and consider reaching out to someone you trust.', crisis: false });
  } catch {
    res.json({ reply: 'I’m having trouble responding just now. Take a slow breath, and consider reaching out to someone you trust.', crisis: false });
  }
});

app.get('/care', requireAuth, (req, res) => renderPage(req, res, 'care'));
app.get('/insights', requireAuth, async (req, res, next) => {
  try { renderPage(req, res, 'insights', await getUserData(req.session.user.id)); }
  catch (error) { next(error); }
});
app.get('/help', requireAuth, (req, res) => renderPage(req, res, 'help'));
app.get('/settings', requireAuth, (req, res) => renderPage(req, res, 'settings'));

app.post('/settings/profile', requireAuth, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFlash(req, 'error', 'Add a name and a valid email address.');
      return res.redirect('/settings');
    }
    if (pool) await query('UPDATE users SET name = $1, email = $2 WHERE id = $3', [name, email, req.session.user.id]);
    else {
      const user = demo.users.find((item) => item.id === req.session.user.id);
      if (demo.users.some((item) => item.email === email && item.id !== req.session.user.id)) {
        setFlash(req, 'error', 'An account with that email already exists.');
        return res.redirect('/settings');
      }
      user.name = name;
      user.email = email;
    }
    req.session.user.name = name;
    req.session.user.email = email;
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

app.post('/settings/2fa/setup', requireAuth, async (req, res, next) => {
  try {
    const secret = generateSecret();
    req.session.pendingTotpSecret = secret;
    const uri = generateURI({ issuer: 'Mind Ease', label: req.session.user.email, secret });
    const qrData = await QRCode.toDataURL(uri, { width: 190, margin: 1 });
    renderPage(req, res, 'settings', { totpSetup: { qrData, secret } });
  } catch (error) { next(error); }
});

app.post('/settings/2fa/enable', requireAuth, async (req, res, next) => {
  try {
    const secret = req.session.pendingTotpSecret;
    const result = secret ? await verify({ secret, token: String(req.body.totp || '').trim() }) : { valid: false };
    if (!result.valid) {
      setFlash(req, 'error', 'Enter the current six-digit code from your authenticator app.');
      return res.redirect('/settings');
    }
    if (pool) await query('UPDATE users SET totp_secret = $1, totp_enabled = TRUE WHERE id = $2', [encryptField(secret), req.session.user.id]);
    else {
      const user = demo.users.find((item) => item.id === req.session.user.id);
      user.totp_secret = encryptField(secret);
      user.totp_enabled = true;
    }
    req.session.user.totpEnabled = true;
    delete req.session.pendingTotpSecret;
    setFlash(req, 'success', 'Two-step sign-in is now enabled.');
    res.redirect('/settings');
  } catch (error) { next(error); }
});

app.post('/settings/2fa/disable', requireAuth, async (req, res, next) => {
  try {
    const user = pool
      ? (await query('SELECT password_hash, totp_secret FROM users WHERE id = $1', [req.session.user.id])).rows[0]
      : demo.users.find((item) => item.id === req.session.user.id);
    const passwordValid = user && await bcrypt.compare(String(req.body.password || ''), user.password_hash);
    const codeResult = user?.totp_secret ? await verify({ secret: decryptField(user.totp_secret), token: String(req.body.totp || '').trim() }) : { valid: false };
    if (!passwordValid || !codeResult.valid) {
      setFlash(req, 'error', 'Confirm with your password and current authenticator code.');
      return res.redirect('/settings');
    }
    if (pool) await query('UPDATE users SET totp_secret = NULL, totp_enabled = FALSE WHERE id = $1', [req.session.user.id]);
    else { user.totp_secret = null; user.totp_enabled = false; }
    req.session.user.totpEnabled = false;
    setFlash(req, 'success', 'Two-step sign-in has been disabled.');
    res.redirect('/settings');
  } catch (error) { next(error); }
});

app.post('/settings/password', requireAuth, async (req, res, next) => {
  try {
    const current = String(req.body.current_password || '');
    const nextPassword = String(req.body.new_password || '');
    const user = pool
      ? (await query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id])).rows[0]
      : demo.users.find((item) => item.id === req.session.user.id);
    if (!user || !(await bcrypt.compare(current, user.password_hash)) || nextPassword.length < 10) {
      setFlash(req, 'error', 'Check your current password and use at least 10 characters for the new one.');
      return res.redirect('/settings');
    }
    const hash = await bcrypt.hash(nextPassword, 12);
    if (pool) await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.session.user.id]);
    else user.password_hash = hash;
    setFlash(req, 'success', 'Password updated.');
    res.redirect('/settings');
  } catch (error) { next(error); }
});

app.post('/settings/delete', requireAuth, async (req, res, next) => {
  try {
    const password = String(req.body.password || '');
    const user = pool
      ? (await query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id])).rows[0]
      : demo.users.find((item) => item.id === req.session.user.id);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      setFlash(req, 'error', 'Password not recognized. No data has been removed.');
      return res.redirect('/settings');
    }
    if (pool) await query('DELETE FROM users WHERE id = $1', [req.session.user.id]);
    else {
      demo.users = demo.users.filter((item) => item.id !== req.session.user.id);
      demo.moods = demo.moods.filter((item) => item.user_id !== req.session.user.id);
      demo.diaries = demo.diaries.filter((item) => item.user_id !== req.session.user.id);
    }
    req.session.destroy(() => res.redirect('/'));
  } catch (error) { next(error); }
});

app.use((req, res) => res.status(404).render('error', { status: 404, message: 'We could not find that page.' }));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const message = error.code === '23505' ? 'An account with that email already exists.' : 'Something went wrong. Please try again.';
  const status = Number(error.status || error.statusCode) || 500;
  res.status(status).render('error', { status, message: status === 403 ? 'This form has expired. Refresh the page and try again.' : message });
});

app.listen(port, () => console.log(`Mind Ease is available at http://localhost:${port}${pool ? ' (PostgreSQL)' : ' (local demo mode)'}`));