# Debate Roulette

Standalone party debate game. Phones or PCs in a browser. Talk in the room or on Discord — this site only runs topics, timers, claps, and votes.

This is **not** the WePlay app. It is its own git repo and GitHub Pages site. It talks to the **same Supabase project** WePlay already uses.

Live (after you push): `https://FrostyDog8.github.io/Debater/`

## Local

```bash
cd E:\WePlay\DebateRoulette
npm install
npm test
npm run dev
```

Open the URL Vite prints. Host on one browser (or device), join with the 4-letter code on others.

Anonymous sign-in must be on in Supabase: **Authentication → Providers → Anonymous**.

## GitHub Pages (same idea as Lyrico)

Push `main`. GitHub Actions builds the site and publishes Pages.

See [DEPLOY.md](DEPLOY.md). Or run `.\update-github.ps1` after the remote exists.

## Rules (short)

- Start with 3+ players. Host sets prep / debate length / timed turns vs free-for-all.
- Everyone writes a pack (topic + two stances). You never debate your own.
- 6+: play once, drop the two lowest scores (odd leftover gets a second-chance match with +1 vote per listener).
- 5: two games each, drop two, then a 3-player round-robin.
- 4: two games each, then a final.
- 3: round-robin, top two to a final.
- Listeners split 11 votes; claps during the speech are 1/20 vote each (2s cooldown).
- Cutoff ties: both stay. Final ties: replay the final including a new topic.

## Ads

Deferred. v1 ships without AdSense or ad placeholders on home, lobby, or play. Wire ads later.
