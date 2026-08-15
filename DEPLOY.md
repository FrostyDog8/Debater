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

1. Repo **Settings → Pages**
2. **Source:** GitHub Actions
3. Wait for the **Deploy GitHub Pages** workflow on `main`

Site: `https://FrostyDog8.github.io/Debater/`

Join links look like: `https://FrostyDog8.github.io/Debater/#/r/ABCD`

### 3. Supabase

This app reuses the existing WePlay project (`vfqppsvvsdfmlnbzqgta`). Public URL + anon key live in `.env.production` (client-side, same as WePlay).

Enable **Anonymous** sign-ins so guests can host/join without email.

Realtime must be on for `rooms` and `room_players` (already used by WePlay).

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
