# German Study Companion — storage prototype

Buildless, browser-local PWA for an iPhone storage trial. No study files or progress are sent to a server. Import a PDF and audio, move through eight study instructions, and retain the current lesson and step. Filenames such as `L001-LESSON.mp3`, `L002-LESSON.mp3`, and `Lesson 3.mp3` automatically associate recordings with lessons. Changing the lesson loads its associated recording. Explicit manual choices are preserved; recordings without recognizable names can be associated manually. Files stream into OPFS where writable files are available, otherwise they are stored as IndexedDB blobs. IndexedDB records are written only after an OPFS file has been fully saved. Duplicate imports are skipped and storage failures are surfaced.

Serve `dist/` over HTTPS (localhost works for development). The service worker caches only the application shell. It does not cache imported files, authentication pages, or third-party requests. Installed app storage and Safari tab storage may differ: install first and import inside the installed app.

On iPhone: open in Safari, Share → Add to Home Screen, launch from the icon, import materials, wait for “App available offline”, save a lesson/step, close, enable Airplane Mode, and reopen. Verify playback and opening the stored PDF, then repeat after restarting. Browser storage is subject to iOS retention policies. Export progress and retain original materials.

This intentionally tests storage first: full PDF opened in a separate tab, automatic filename matching, manual pauses and seeking. Lesson page mapping, dual-page rendering, automatic sentence segmentation, English-only cropping, and automatic two-play listening are follow-up features. Audio format support and full PDF handling must be checked with actual materials on iOS.

## GitHub Pages

For the source repository layout, upload `dist/` and `.github/workflows/pages.yml` to the repository's `main` branch. In Settings → Pages, choose **GitHub Actions** as the source. The workflow deploys only `dist/` and can be triggered manually from Actions. No build or dependencies are needed. The app uses relative URLs to work at a project subpath such as `/assimilapp/`.

Alternatively, use the ready-to-host ZIP: put its extracted files directly at the repository root (so `index.html` is at the root), then choose Settings → Pages → Deploy from a branch → `main` → `/(root)`. No workflow is necessary for this option.

Do not commit your PDF, audio, browser profiles, or exported progress. The hosted interface can be public while your imported files remain local to the browser. GitHub hosting itself receives ordinary page requests, but this app sends no study materials or progress. Opening the same app at a different origin will not bring its local files or progress along.

When releasing changed application assets, increment `CACHE` in `dist/sw.js` and the matching cache name in `dist/app.js`. Application updates must not delete OPFS or IndexedDB data. Reopening online installs an updated service worker and refreshes only app assets.

## Verification

Verified in local Chromium at a phone-sized viewport: OPFS imports, IndexedDB fallback, duplicate detection, deletion, saved lesson and step, progress export/restore, full browser restart followed by offline reload, audio playback, and opening a stored sample PDF. Imported a generated 64.01 MiB PDF with the three supplied MP3s; confirmed file retention and boundary bytes after restart. Each supplied MP3 matched lessons 1–3 automatically and played offline. The original scanned PDF could not be transferred into this workspace because it exceeds the 32 MiB attachment-transfer limit. This limit does not apply to the PWA's file picker. The original PDF and Home Screen installation have not been tested on an iPhone.
