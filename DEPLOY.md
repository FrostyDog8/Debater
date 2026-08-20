# Deployment — GitHub Pages

Same pattern as [Lyrico](https://github.com/FrostyDog8/Lyrico): push `main`, the site updates.

## One-time setup

### 1. Create the GitHub repository

The GitHub repo is [FrostyDog8/Debater](https://github.com/FrostyDog8/Debater). Local `origin` already points there. First push from `E:\WePlay\DebateRoulette`:

```bash
git push -u origin main
```

GitHub’s default README commit is already on `main`, so the first push may need a merge before it will accept the app.

### 2. Enable Pages from Actions

Use **GitHub Actions**, not **Deploy from a branch**. Branch deploy publishes the source `index.html` and shows a blank screen.

1. Repo **Settings → Pages**
2. **Source:** GitHub Actions
3. Re-run the **Deploy GitHub Pages** workflow if it failed with “Get Pages site failed”

Site: `https://FrostyDog8.github.io/Debater/`

Join links look like: `https://FrostyDog8.github.io/Debater/#/r/ABCD`

### 3. Supabase

This app uses the same Supabase *project* as WePlay, but **its own tables**:

- `debater_rooms` — Debater sessions (primary key `id` = game id; room codes are recyclable)
- `debater_players` — players in a Debater room
- `debater_topics` — every suggested topic + `game_id`

Run [`supabase/debater-tables.sql`](supabase/debater-tables.sql) once in the SQL Editor (see [`supabase/README.md`](supabase/README.md)).

Enable **Anonymous** sign-ins so guests can host/join without email.

Realtime must include `debater_rooms` and `debater_players` (the SQL adds them to `supabase_realtime`).

## Updating the live game

```powershell
.\update-github.ps1
```

Or:

```bash
git add -A
git commit -m "Describe the change"
git push
```

GitHub Pages rebuilds in a minute or two.

## Working locally

```bash
npm install
npm run dev
```

Local changes do not hit the live site until you push.

## Ads

Deferred for v1. The live site does not show AdSense or ad placeholders on home, lobby, or debate. Do not add AdSense env vars on Pages until ads ship.

## Google Analytics (optional)

1. Create a GA4 property and copy the Measurement ID (`G-…`).
2. Repo **Settings → Secrets and variables → Actions**: add secret `VITE_GA_MEASUREMENT_ID`.
3. Redeploy (push or re-run the Pages workflow). Locally you can also set it in `.env`.
