# Mind Ease

A web-based mental wellness self-help app built with Express, EJS, and PostgreSQL. The application is not a replacement for professional mental health care.

## Run locally

Requirements: Node.js 20 or newer. From the project folder:

```powershell
npm install
npm run dev
```

Open http://localhost:3000. Without `DATABASE_URL`, the app runs in local demo mode. Demo accounts and entries are held in memory and are cleared when the server restarts.

## Persistent PostgreSQL setup

1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` to the database connection string.
4. Set `SESSION_SECRET` and `DATA_ENCRYPTION_KEY` to separate, randomly generated secrets. For example, use `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` twice and keep the values private.
5. Apply `schema.sql` to the database, for example with `psql "$env:DATABASE_URL" -f schema.sql` from PowerShell.
6. Run `npm start`.

The PostgreSQL session table is created automatically. Use HTTPS and set `NODE_ENV=production` when deployed. Production startup refuses to run without both session and encryption secrets.

## Optional Gemini companion

Set `GEMINI_API_KEY` in `.env` to enable Gemini for USHA. Without it, the chat uses a local supportive fallback. Chat messages are sent to the configured Gemini API when enabled; never enter information you would not want to share with that provider.

The app checks messages for common crisis phrases before making an AI request and presents emergency resources. This keyword check is not a clinical assessment and cannot guarantee detection.

## Included features

- Email registration and sign-in, bcrypt password hashing, rate-limited authentication, optional TOTP two-step verification, and account deletion.
- Mood check-ins, notes, screen-time records, history, and visual summaries.
- Structured CBT thought diary with previous reflections.
- USHA chat with Gemini integration when configured and crisis-language handling.
- Timed 4-7-8 breathing practice, 5-4-3-2-1 grounding, and self-care prompts.
- Help resources, profile and password editing, AES-256-GCM encryption for mood/diary fields and TOTP secrets, and CSRF protection.

## Notes

The app is an educational project, not a clinical service. Crisis resources shown include 988 for the U.S. and Canada, Tele-MANAS 14416 for India, and 112 for emergency contact; availability varies by location. Confirm resource numbers for the deployment region before public release.

The included schema is intended for a fresh project database. Before applying schema changes to an existing deployment, create and test a migration and back up its data.