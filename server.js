require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');
const { csrfSync } = require('csrf-sync');
const { retrieveWellnessResources } = require('./usha-knowledge');
const { createAuthRouter } = require('./routes/auth');
const { createWellnessRouter } = require('./routes/wellness');
const { createSettingsRouter } = require('./routes/settings');
const { createPagesRouter } = require('./routes/pages');

const app = express();
const port = Number(process.env.PORT) || 3000;
const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'mind-ease-jwt-secret-key-development';

if ((process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) || ((process.env.NODE_ENV === 'production' || databaseUrl) && !process.env.DATA_ENCRYPTION_KEY)) {
  throw new Error('Set SESSION_SECRET in production and DATA_ENCRYPTION_KEY whenever PostgreSQL or production mode is enabled.');
}

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined }) : null;
const demo = { users: [], moods: [], diaries: [] };
const encryptionKey = crypto.createHash('sha256').update(process.env.DATA_ENCRYPTION_KEY || 'local-demo-encryption-key-change-before-deployment').digest();

const { generateToken, csrfSynchronisedProtection } = csrfSync({
  getTokenFromRequest: (req) => req.headers['x-csrf-token'] || req.body?._csrf
});

function signUserToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email
    },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

function verifyUserToken(token) {
  try {
    return jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }
}

function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

function clearAuthCookie(res) {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
}

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
app.use(cookieParser());
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

// Enforce CSRF protection on browser form submissions while allowing Bearer token API calls
app.use((req, res, next) => {
  if (req.headers.authorization && req.headers.authorization.toLowerCase().startsWith('bearer ')) {
    return next();
  }
  return csrfSynchronisedProtection(req, res, next);
});

// JWT authentication extractor & user session synchronization
app.use((req, res, next) => {
  let token = req.cookies?.token;
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      token = parts[1];
    }
  }

  if (token) {
    const decoded = verifyUserToken(token);
    if (decoded) {
      req.user = decoded;
      if (req.session) {
        req.session.user = decoded;
      }
    } else {
      req.user = null;
      if (req.session) delete req.session.user;
      clearAuthCookie(res);
    }
  } else if (req.session?.user) {
    req.user = req.session.user;
  } else {
    req.user = null;
  }

  res.locals.user = req.user;
  res.locals.flash = req.session?.flash || null;
  if (req.session) delete req.session.flash;
  res.locals.currentPath = req.path;
  res.locals.demoMode = !pool;
  res.locals.supabaseAuthConfigured = false;
  next();
});

const crisisPattern = /\b(suicid(?:e|al)|kill myself|end my life|self[- ]harm|hurt myself|want to die|better off dead)\b/i;
const crisisMessage = 'If you may act on these thoughts, call emergency services now or go to the nearest emergency department. In the U.S. or Canada, call or text 988. In India, call Tele-MANAS at 14416. If you are elsewhere, contact your local crisis line. If you can, tell someone you trust and stay with them.';
const crisisResources = [
  { label: 'U.S. & Canada: call or text 988', url: 'https://988lifeline.org/' },
  { label: 'Find a crisis line in your country', url: 'https://findahelpline.com/' },
  { label: 'India: Tele-MANAS', url: 'https://telemanas.mohfw.gov.in/' }
];
const professionalHelpPattern = /\b(therap(?:y|ist)|counsel(?:ing|lor|or)|psychologist|psychiatrist|professional help|mental health service)\b/i;

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { reply: 'You’ve sent several messages in a short time. Take a moment, then try again.', crisis: false }
});

function getChatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-8).flatMap((item) => {
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') return [];
    const content = item.content.trim().slice(0, 2000);
    return content ? [{ role: item.role, content }] : [];
  });
}

async function getUshaReply(message, history, retrievedResources) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return 'I’m here with you. What feels most important about this right now? You might also try naming one small thing you need in this moment.';
  }

  const resourceContext = retrievedResources.length
    ? retrievedResources.map((item) => `${item.title}: ${item.guidance} Source: ${item.url}`).join('\n')
    : 'No specific external resource matched. Rely on Mind Ease CBT and self-care principles.';

  const systemPrompt = [
    'You are USHA, the warm, empathetic, and compassionate AI mental wellness companion within Mind Ease.',
    '',
    'ABOUT THE MIND EASE PROJECT & OUR MISSION:',
    'Mind Ease is a web-based, private, and stigma-free mental wellness platform designed to help users manage everyday stress, anxiety, overwhelm, and negative thoughts.',
    'Our core goals are:',
    '1. Accessibility & Privacy: Provide an immediate, safe, judgment-free space to reflect and breathe, especially when professional therapy is expensive, waitlisted, or intimidating.',
    '2. Cognitive Behavioral Therapy (CBT): Help users recognize automatic negative thoughts (ANTs) and cognitive distortions (such as catastrophizing, all-or-nothing thinking, emotional reasoning, and mind-reading), and guide them to find balanced, kinder, and realistic perspectives.',
    '3. Mindful Tracking: Encourage users to build emotional self-awareness by connecting their mood scores with daily habits (like screen time, sleep, and lifestyle stressors).',
    '4. Somatic & Body-Based Regulation: Provide quick somatic calming tools (4-7-8 rhythmic breathing and 5-4-3-2-1 sensory grounding) to soothe nervous system activation.',
    '',
    'HOW YOU GUIDE AND MAKE SUGGESTIONS:',
    '- Empathy First: Always listen, validate feelings warmly, and meet the user where they are. Never invalidate their experience or rush to "fix" their problems without understanding.',
    '- In-App Mind Ease Tools (Suggest these gently when relevant):',
    '  * Thought Diary (/diary): Suggest writing down situations, automatic thoughts, feelings, evidence for/against, and crafting a balanced thought when stuck in worry or self-criticism.',
    '  * Mood Check-in (/mood): Suggest rating their daily mood (1-10) and noting screen time or sleep to observe patterns over time without self-judgment.',
    '  * A Moment of Care (/care): Recommend trying the 4-7-8 breathing exercise or 5-4-3-2-1 sensory grounding practice when feeling physically tense, restless, or panicked.',
    '- Actionable Everyday Suggestions: Suggest 1 or 2 small, realistic micro-steps (e.g. taking a sip of water, unclenching the jaw and dropping the shoulders, stepping away from screens for a few minutes, taking a short stroll, or connecting with a supportive friend).',
    '- Boundaries & Ethics: You are a supportive self-help tool, not a doctor, licensed therapist, or medical diagnostic system. Never diagnose psychiatric conditions or prescribe medication. If someone expresses acute crisis, self-harm, or despair, warmly guide them toward emergency services (988 in US/Canada, Tele-MANAS 14416 in India, 112) or trusted loved ones.',
    '- Tone & Structure: Conversational, gentle, soothing, and concise (2-4 brief paragraphs or clean bullet points). Avoid overwhelming walls of text. End with a thoughtful, open reflection question.',
    '',
    'TRUSTED REFERENCE CONTEXT:',
    resourceContext
  ].join('\n');

  const contents = [
    ...history.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content })),
    { role: 'user', content: message }
  ];

  const candidateModels = [
    process.env.GROQ_MODEL,
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b'
  ].filter(Boolean);

  let lastError = null;
  for (const model of candidateModels) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model,
          temperature: 0.6,
          max_tokens: 800,
          messages: [{ role: 'system', content: systemPrompt }, ...contents]
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error?.message || `Groq returned HTTP ${response.status}`);
      }

      const result = await response.json();
      const reply = result.choices?.[0]?.message?.content?.trim();
      if (reply) return reply.slice(0, 4000);
    } catch (err) {
      lastError = err;
      console.warn(`Groq request with model ${model} failed: ${err.message}. Trying next candidate...`);
    }
  }

  throw lastError || new Error('Groq returned an empty response');
}

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
  const user = req.user || req.session?.user;
  if (!user) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/login');
  }
  next();
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function establishAuthSession(req, res, next, user) {
  const userPayload = {
    id: user.id,
    name: user.name,
    email: user.email
  };
  const token = signUserToken(userPayload);
  setAuthCookie(res, token);
  req.user = userPayload;

  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.user = userPayload;
    req.session.save((saveError) => {
      if (saveError) return next(saveError);
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.json({ success: true, token, user: userPayload, redirectUrl: '/dashboard' });
      }
      return res.redirect('/dashboard');
    });
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
  res.render('app', { page, ...extras });
}

app.use('/', createAuthRouter({
  pool,
  establishAuthSession,
  requireAuth,
  demo,
  bcrypt,
  crypto,
  setFlash,
  clearAuthCookie
}));

app.use('/', createWellnessRouter({
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
  groqConfigured: Boolean(process.env.GROQ_API_KEY),
  getUshaReply
}));

app.use('/', createSettingsRouter({
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
}));

app.use('/', createPagesRouter());

app.use((req, res) => res.status(404).render('error', { status: 404, message: 'We could not find that page.' }));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const message = error.code === '23505' ? 'An account with that email already exists.' : 'Something went wrong. Please try again.';
  const status = Number(error.status || error.statusCode) || 500;
  res.status(status).render('error', { status, message: status === 403 ? 'This form has expired. Refresh the page and try again.' : message });
});

app.listen(port, () => console.log(`Mind Ease is available at http://localhost:${port}${pool ? ' (PostgreSQL)' : ' (local demo mode)'}`));