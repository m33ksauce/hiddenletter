# Hidden Letter

A kid-friendly writing trainer: pick a letter, then color every matching section (capital and lowercase) to reveal how it is written. The whole game runs in the browser — no server memory — and it can print as a worksheet.

## Play

1. Choose a capital or lowercase letter.
2. Color every puzzle piece that shows that letter (both capital and lowercase).
3. The filled pieces draw the hidden letter.

**New puzzle** keeps the same letter and shuffles the pieces. **Print** opens a printable worksheet (PDF). Progress is saved in `localStorage`, so a refresh keeps the current puzzle and colors.

## Develop

```bash
npm install
npm run populate-letters   # bake A–Z / a–z outlines into public/letters (dev server must be running)
npm run reslice-letters    # validate slices and export scripts/out/slice-*.svg for all letters
npm run dev
```

Letter outlines load from `public/letters/` at runtime. Re-run `populate-letters` after font or tracing changes.

### Debug tools (off by default)

Set `VITE_DEBUG_TOOLS=true` in `.env` to enable:

- **In the app:** “Review base letter shapes” preview screen
- **Scripts:** `scripts/capture-*.mjs`, `scripts/diagnose-slice.mjs`, `scripts/export-slice-svg.mjs`

Copy `.env.example` to `.env` and flip the flag when you need them.

## Deploy to Cloudflare

This is a static React SPA on [Workers static assets](https://developers.cloudflare.com/workers/static-assets/). After `wrangler login`:

```bash
npm run deploy
```

That builds the app and deploys it. SPA routes use `assets.not_found_handling = "single-page-application"` in `wrangler.jsonc`.

### GitHub → Cloudflare (recommended)

1. Push this repo to GitHub (see below).
2. In the [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/workers-and-pages), open the **hiddenletter** worker → **Settings** → **Builds** → **Connect** your GitHub repo.
3. Set **Build command** to `npm run build` and **Deploy command** to `npm run deploy` (or `npx wrangler deploy`).
4. Production branch: `main`. Push to deploy automatically.

Alternatively, GitHub Actions (`.github/workflows/deploy.yml`) deploys on push to `main` when these repository secrets are set:

- `CLOUDFLARE_API_TOKEN` — Workers edit token ([create one](https://dash.cloudflare.com/profile/api-tokens))
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID
