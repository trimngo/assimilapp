# German Study Companion

An offline phone-friendly companion for your German Assimil course. Import your own scanned PDF and audio once; the files and your study progress stay on the device. No book, recordings, or progress are uploaded by the app.

## Study routine

1. **Review:** play the previous two or three available lessons in order.
2. **Blind listening:** play the current lesson twice, with the book hidden, and stop automatically.
3. **Understand:** read the lesson’s German, English, and notes inside the app.
4. **Read along:** play audio while following the scanned pages. A floating playback bar remains available while scrolling.
5. **Shadowing:** detect pauses locally, pause and repeat individual segments, move to the next sentence, or continue automatically after a repeat gap. Then speak along with text and without text. Boundaries can be edited or split at the playhead.
6. **Read aloud and exercises:** keep the relevant lesson pages visible.
7. **Write:** view the lesson while copying sentences on paper.
8. **Recall:** show only your selected English translation area; reveal and hide the full lesson to check your answer.

Filenames such as `L001-LESSON.mp3` match recordings to lessons automatically. Unrecognized names can be associated manually. Playback speed is adjustable. Current lesson and study step save automatically.

## One-time book setup

In Understand, open **Set lesson pages**. Enter the first, last, and English PDF page numbers; these may differ from printed book numbers. Preview the pages, then save. Optionally estimate subsequent lessons using the same page count, and save exceptions individually. No page offsets are guessed before you set a pattern.

Choose **Select English area**, drag a rectangle around the English translation, and save it. You can reuse that layout for other lessons. Recall renders a separate cropped canvas, rather than covering the German with an overlay. The app does not assume that a scanned PDF has selectable text or run OCR.

Shadowing proposes segments from pauses in the recording; they are not guaranteed linguistic sentence boundaries. Check them once and edit start/end times as needed, including removing introductions or combining phrases. Detection uses only the current recording, locally. Timings and page mappings are saved and included in progress backups.

## iPhone and offline use

Open the site in Safari, use Share → Add to Home Screen, and import inside the installed app. Safari and Home Screen storage may differ. Wait for **App available offline**, then close the app, enable Airplane Mode, and reopen. Verify saved progress, playback, and lesson pages. Retain original materials and export a backup; browser storage retention is subject to iOS policies.

The header shows the running version. In **Get started → App updates**, choose **Check for updates** while online. If an update is ready, choose **Reload app**. A successful check says whether the running version matches the latest published release. While offline, the app shows its running version without claiming it is latest. For an older installation without this control, open online, allow the new app shell to download, then close and reopen or refresh. Updates keep the same IndexedDB database, file IDs, and OPFS files. Only app-shell caches are replaced. Restore a backup after importing its original materials so mappings can reconnect by filename and size. Version 1 progress backups remain supported.

## GitHub Pages

For this repository, use Settings → Pages → Deploy from a branch → `work` → `/(root)`. The root entry page forwards to `dist/`; `.nojekyll` serves the static app directly. The stable app URL is `https://trimngo.github.io/assimilapp/dist/`. Future pushes to `work` update this deployment without changing branches.

An optional workflow deploys `dist/` from `main` when Pages is configured to use GitHub Actions. Keep the current branch-based setup if you want the installed app’s `/dist/` URL to remain stable. Moving to a different origin would require importing materials again; do not move the installed app URL unnecessarily.

## Implementation and checks

Buildless HTML/JavaScript. Files stream into OPFS where writable files are supported, with an IndexedDB blob fallback. PDF.js 4.10.38 is bundled with its worker, standard fonts, and licenses for offline rendering. File slices are supplied through a local range transport so opening a large book does not copy the whole PDF into an application buffer. Pages are rendered at a bounded resolution. PDF code evaluation is disabled.

The service worker caches the complete app shell atomically, including PDF dependencies, and replaces only caches with the app’s own prefix. For each release, update the version in `version.json`, `updates.js`, `sw.js`, and the HTML badge, and increment the matching shell cache names in `updates.js` and `sw.js`. The release JSON is network-only so stale installations can discover updates. Study materials are never part of the hosted source or service-worker cache.

Run `npm test` for pause detection and timing validation checks; no installation or build is required. Browser checks covered review sequencing, two-pass listening, scanned PDF rendering, landscape spreads, page patterns, English cropping, reveal/hide, sentence pauses and replay, practice with/without text, backup/restore, offline restart, and preservation of legacy files/progress. The supplied first recording was also checked for pause detection. The original book exceeds the workspace attachment-transfer limit, so its exact page layout and actual iPhone rendering still need to be verified on the device.
