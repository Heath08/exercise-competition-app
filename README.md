# Exercise Competition App

A simple React + Vite app with Tailwind and optional Firebase live sync.

## Quick Start
1. Install Node.js (18+).
2. In this folder, run:
   ```bash
   npm install
   npm run dev
   ```
3. Open the local URL it prints (usually http://localhost:5173).

## Deploy
- Vercel: `vercel` or import this repo in Vercel and deploy.
- Netlify: `netlify deploy` (or drag & drop the `dist` folder after `npm run build`).
- Hostinger: run `npm run build` and upload the `dist` folder to your site.

## Live Sync (optional)
Enable Anonymous Auth + Firestore in Firebase console. Then paste your Web config JSON into the app's Live Sync panel and set a Room ID.
