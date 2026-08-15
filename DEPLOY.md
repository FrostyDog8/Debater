# Deployment — GitHub Pages

Same pattern as [Lyrico](https://github.com/FrostyDog8/Lyrico): push `main`, the site updates.

## One-time setup

### 1. Create the GitHub repository

```bash
cd E:\WePlay\DebateRoulette
gh repo create FrostyDog8/DebateRoulette --public --source=. --remote=origin --push
```

Or in the browser: new empty repo `DebateRoulette` (no README), then:

```bash
git remote add origin https://github.com/FrostyDog8/DebateRoulette.git
git branch -M main
git push -u origin main
```

### 2. Enable Pages from Actions

1. Repo **Settings → Pages**
2. **Source:** GitHub Actions
3. Wait for the **Deploy GitHub Pages** workflow on `main`

Site: `https://FrostyDog8.github.io/DebateRoulette/`

Join links look like: `https://FrostyDog8.github.io/DebateRoulette/#/r/ABCD`

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
