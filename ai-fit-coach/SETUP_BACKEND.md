# Backend setup (v0.2 scaffold)

1. Create a Supabase project. Run `supabase/migrations/202611150001_initial.sql` in its SQL editor (or via Supabase CLI migration).
2. Enable email authentication in Supabase Auth; configure email confirmations and rate limits.
3. Copy `.env.example` to `.env` and fill in project URL and publishable/anon key (never a service-role key).
4. In Supabase Edge Function secrets, set `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_MODEL` to a model available in your Anthropic account.
5. Deploy function `coach` with JWT verification enabled. The function validates the bearer token again using `getUser()`.
6. Run `npm install`, then `npx expo start`.

## Current implementation status
- The Coach tab calls `askCoach` when Supabase is configured and falls back to the local rule-based coach on any error. There is still no login screen, so without a session the AI coach is never reached.
- The app sends a short training context (goal, level, equipment, plan, best values; no name) with each question; the function caps it at 2000 characters.
- `fitness_profiles` still uses the v0.2 columns (three goals, single equipment text). Extend the schema before syncing the new profile (four goals, level, days, equipment list, limitations).
- SQL schema and server-side Claude proxy are starter implementations, NOT production-ready.
- Before inviting real users: add signup/login screens and sync, server-side atomic rate limiting, billing entitlements, spending caps, abuse protection, logging without sensitive messages, consent/privacy flows, deletion/export, and end-to-end tests.
- `coach_usage` is reserved for a future atomic server-side quota implementation; it is not enforced yet.
- Claude usage incurs costs; do not deploy a public unlimited endpoint.
