# German Study Companion

An offline iPhone-friendly companion for your German Assimil course. Import your book PDFs and audio once; files and progress stay on the device. The hosted app contains only software and prepared page/timing metadata.

## Start studying

Open [the app](https://trimngo.github.io/assimilapp/dist/) in Safari, choose Share → Add to Home Screen, then import inside the installed app. Safari tabs and Home Screen apps may have separate storage.

In **Menu → My materials**, select your full `ASSIMIl German book.pdf` and lesson MP3s. The supplied `001-300.pdf`, `301-600.pdf`, and `601-614.pdf` still work as an alternative. Imports can be split into batches. Start with recordings 1–3 if you prefer. The app checks the full book’s 614-page layout once (keep it open until the check finishes), or verifies the split originals by fingerprint. It automatically finds each lesson's pages, and matches audio without assigning recordings manually. Keep the original materials and export progress occasionally; iOS storage retention is not guaranteed.

Choose a lesson and follow the eight steps. Only the current instruction and relevant controls appear; materials, backup, and updates live in the menu.

1. **Review:** play the previous two or three available lesson dialogues in order.
2. **Blind listening:** play the current dialogue twice with the book hidden, then stop.
3. **Understand:** read the German, English translation, notes, and exercises on the mapped pages.
4. **Read along:** listen to the dialogue while following the pages. A compact playback bar appears when the main player scrolls out of view.
5. **Shadowing:** play, pause, and repeat prepared sentence cuts. Then speak along with text and without. Practice options offer a repeat gap, automatic continuation, and timing edits.
6. **Read aloud & exercises:** keep the lesson pages visible; the player can play the full recording, including exercises.
7. **Write:** copy the sentences by hand while reading the pages.
8. **Recall:** see all the prepared English translation crops; reveal and hide the lesson to check your German.

Lesson and study step save automatically. Wait for **App available offline**, then try closing and reopening in Airplane Mode. Imported materials are read from local storage each session, without uploading or importing them again.

## Prepared course and custom materials

The [course index and preprocessing guide](course/README.md) cover all 100 lessons, 208 reviewed English recall crops, recording fingerprints, dialogue ranges, and 1,296 sentence timing drafts. The app uses those small metadata files to seek within original MP3s; it does not run speech recognition or decode known recordings to detect pauses.

Automatic sentence checks passed for 22 lessons. There are 215 flagged boundaries across 78 lessons; draft cuts are identified in sentence practice and can be adjusted. Automatic alignment is not a manual listening review. The first three lessons have independently checked sentence endpoints.

Split PDFs and recordings are identified by SHA-256; renamed originals still match. A full PDF is recognized by checking all 614 pages against prepared text and position fingerprints. Small glyph and punctuation changes are tolerated, while changed page order or text placement refuses automatic mapping. The verified result is saved with the local file, so reopening does not repeat the check. A PDF without the expected text layer or layout needs custom page settings; alternative recordings need their own timings. No Google sign-in or OAuth setup is required. Save Drive files to Files on your phone, then choose them with the existing import picker.

For other books, **Book options** retains custom page numbers, optional page patterns, and English-area selection. **Playback options** allows manual audio choices. Existing file identities, page mappings, custom timings, and progress remain stored. Known originals use prepared cuts by default; previous timing lists can be selected with **Use saved custom timings**. New timing edits take precedence until you switch back. Choose **Use automatically matched pages** or **Use prepared sentence timings** to switch back from custom settings. Local pause detection is available only on request for other recordings. Recall refuses an uncropped whole page when there is no English-only area.

## Updates and backups

In **Menu → Help & updates**, check the running version and choose **Check for updates** while online, then **Reload app** when a release is ready. Updates preserve IndexedDB and OPFS materials and progress, replacing only the app's shell cache. Offline checks show the running version without claiming it is the latest.

In **Menu → My materials → Backup & storage**, export or restore progress, custom book settings, audio choices, and timing edits. Backups exclude media files. Import the original files before restoring so settings reconnect by filename and size. Version 1 and 2 progress backups remain supported.

## GitHub Pages

Use Settings → Pages → Deploy from a branch → `work` → `/(root)`. The root page redirects to `dist/`; `.nojekyll` serves the static app directly. Future pushes on `work` update the stable `/dist/` URL without changing branches. An optional workflow deploys `dist/` from `main` if Pages is instead configured for GitHub Actions.

## Implementation and checks

Buildless HTML/JavaScript. Large files stream into OPFS when supported, with an IndexedDB blob fallback. PDF.js 4.10.38 and its dependencies are bundled offline. A local range transport reads PDF slices without copying the entire book into an application buffer; canvases have bounded resolution. PDF evaluation is disabled. Multiple PDFs are opened lazily, including lesson 57's split-source pages. Full books use the same global page references directly. File hashing uses bounded 1 MB chunks; layout recognition reads the existing PDF text layer without OCR or image rendering.

`dist/course-index.json` mirrors `course/assimil-german.index.json`; `dist/combined-layout.json` mirrors the prepared layout fingerprints in `course/combined-layout.json`. The incremental hash implementation is bundled from @noble/hashes 1.8.0 under its MIT license. Copy the reviewed source into `dist/` when changing prepared data. The service worker installs the app shell atomically, including the course metadata, and never caches imported materials. `version.json` stays network-only. For releases, update `version.json`, `updates.js`, `sw.js`, and the HTML badge; increment matching shell cache names in `updates.js` and `sw.js`.

Run `npm test` for timing validation, fingerprint matching, full-book and split-PDF references, layout validation, bounded file hashing, complete recall coverage, and prepared timing padding. Run `python scripts/check_course.py` to validate the preprocessing output. Browser checks use the supplied PDFs and recordings to exercise automatic import, dialogue repeats, sentence playback, recall, split-source rendering, backup/restore, and offline restart. Actual iPhone testing remains necessary.
