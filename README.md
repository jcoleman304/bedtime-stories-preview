# 1-Minute Bedtime Stories (preview)

Personalized, AI-written, one-minute bedtime stories for children ages 3 to 10.
Mobile-first static web app on GitHub Pages with a Supabase backend.

Preview: https://jcoleman304.github.io/bedtime-stories-preview/

## Stack
- `index.html`, `styles.css`, `app.js`: vanilla single-page app, no build step.
- `config.js`: public Supabase URL + publishable key (safe to ship; RLS protects data).
- `supabase/migrations/`: Postgres schema (profiles, children, stories) with RLS.
- `supabase/functions/generate-story/`: Deno edge function. Verifies the parent's JWT,
  enforces the free quota (3 stories / 7 days), writes the story with Claude Haiku 5.5,
  runs a second safety-review pass, and saves the story. The Anthropic key lives only here.
- Read to me: device `speechSynthesis` in the preview. Premium voices are a launch item.

## One-time backend setup
Blocked until the Coleman Company Supabase org's overdue invoice is settled
(Supabase refuses new projects account-wide while any invoice is overdue).

```bash
cd ~/Documents/Dev/bedtime-stories
supabase projects create bedtime-stories --org-id pgpjhreptkslejqwubqg \
  --db-password "$(cat .dbpass)" --region us-east-1 --yes
supabase link --project-ref <REF> --password "$(cat .dbpass)"
supabase db push
supabase config push                      # auth: site_url, redirect URLs, no email confirmation
supabase secrets set ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"
supabase functions deploy generate-story
supabase projects api-keys --project-ref <REF>   # copy the publishable/anon key into config.js
```
Then set `SUPABASE_URL` and `SUPABASE_KEY` in `config.js`, commit, push.

## Plans (preview behavior)
Free: 3 stories/week, 1 child. Premium $4.99: unlimited, 1 child. Family $7.99: unlimited, 5 children,
continuing adventures. In preview, choosing a plan updates `profiles.plan` directly with no payment.
Before launch: remove the "profiles: own update (preview)" policy and let a Stripe webhook own `plan`.

## Before launch (not in preview)
- Stripe Checkout + webhook for plan changes.
- Premium narration voice (hosted TTS) behind Premium.
- Password reset flow and email confirmation on.
- Privacy policy + COPPA-aligned parent-only data handling statement.
- Custom domain + remove `noindex`.
