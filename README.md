# Mind Ease

A web-based mental wellness self-help app built with Express, EJS, and PostgreSQL. The application is not a replacement for professional mental health care.

## Run locally

Requirements: Node.js 20 or newer. From the project folder:

```powershell
npm install
npm run dev
```

Open http://localhost:3000. Without `SUPABASE_DB_URL` or `DATABASE_URL`, the app runs in local demo mode. Demo accounts and entries are held in memory and are cleared when the server restarts. Configure credentials in `.env`; never commit that file.

## Database and Authentication Setup

1. Configure your PostgreSQL database (Supabase PostgreSQL, local PostgreSQL, Neon, etc.) using `DATABASE_URL` (or `SUPABASE_DB_URL`).
2. Authentication uses custom JWT tokens and bcrypt password hashing. It does not rely on Supabase email confirmation or third-party auth services.
3. Configure `JWT_SECRET`, `SESSION_SECRET`, and `DATA_ENCRYPTION_KEY` in `.env`.
   Example: run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` to generate secrets.
4. Apply `schema.sql` to your database. It creates the `users`, `mood_entries`, and `diary_entries` tables.
5. Start with `npm run dev` or `npm start`.

JWT tokens are stored securely in `httpOnly`, `SameSite=lax` cookies for browser requests and are also accepted via `Authorization: Bearer <token>` headers for API clients. Rate limiting protects both login and registration against brute-force attempts.

## USHA AI Companion & Groq Integration

Set `GROQ_API_KEY` in `.env`. `GROQ_MODEL` defaults to `openai/gpt-oss-120b` (with automatic fallback to `qwen/qwen3.8-27b`). Without a key, USHA provides a local supportive fallback message. When configured, USHA leverages Groq's high-speed inference to provide personalized, CBT-aligned emotional support, practical micro-steps, and in-app tool recommendations (Thought Diary, Mood Check-in, 4-7-8 Breathing, 5-4-3-2-1 Grounding). Mind Ease does not store chat transcripts.

USHA uses a small in-app retrieval set of general mental-wellbeing references from WHO, NIMH, and NHS. It selects relevant excerpts and supplies them to Llama as context; this is lightweight keyword retrieval, not clinical knowledge or a substitute for care. Relevant references and professional-support links appear as clickable links below replies. Common crisis phrases are checked before sending a message to Groq and return crisis support links directly; this keyword check is not a clinical assessment and cannot guarantee detection. Never rely on the app for emergency monitoring.

## Included features

- Custom JWT authentication with email & password registration/sign-in, bcrypt hashing, rate limiting, and account deletion.
- Mood check-ins, notes, screen-time records, history, and visual summaries.
- Structured CBT thought diary with previous reflections.
- USHA chat with Groq Llama integration, reference retrieval, external support links, and crisis-language handling.
- Timed 4-7-8 breathing practice, 5-4-3-2-1 grounding, and self-care prompts.
- Help resources, profile and password editing, AES-256-GCM encryption for mood/diary fields, and CSRF protection.

## Server organization

Express route handlers are grouped under `routes/`: `auth.js` handles registration, sign-in, email confirmation, and sign-out; `wellness.js` handles the dashboard, mood, diary, chat, care, and help pages; `settings.js` handles profile/security controls; and `pages.js` handles the public home page. `server.js` configures middleware, shared services, and mounts the routers.

## Notes

The app is an educational project, not a clinical service. Crisis resources shown include 988 for the U.S. and Canada, Tele-MANAS 14416 for India, and 112 for emergency contact; availability varies by location. Confirm resource numbers for the deployment region before public release.

The included schema is intended for a fresh project database. Before applying schema changes to an existing deployment, create and test a migration and back up its data.