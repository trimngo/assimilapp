# Isolated Google Drive download probe

Open `/drive-test/` on the same GitHub Pages site as the study app. It tests ordinary `fetch` downloads from public Google Drive file links, followed by local persistence and offline reopening. It does not establish that Drive works until someone runs it against real public links in their browser.

## Run the live test

1. Set the full PDF and one MP3 to **Anyone with the link**. Use individual file links, not an audio-folder link.
2. Open the test page in Safari or the BOOX browser. Download and save the PDF, then the MP3.
3. Open the saved PDF and MP3 and confirm they are the correct complete files.
4. Wait for **Test page available offline**, enable Airplane Mode, reload, and reopen/play both saved files.
5. Copy the log under **Test details** if anything fails. The log omits Drive file IDs and URLs.
6. **Remove test downloads** frees only the test media. The small offline test page remains cached.

## Isolation

- No changes to `dist/`, its versions, or the main app menu.
- Service worker scope: `/drive-test/` only. Shell cache: `assimil-drive-test-shell-v1`.
- IndexedDB database: `assimil-drive-download-test`. OPFS subdirectory: `assimil-drive-download-test`.
- The main app uses separate storage. Test downloads still count toward the browser origin's shared storage quota.
- No sign-in, OAuth, API key, cookies, proxy, or opaque `no-cors` responses. A browser blocked request may mean CORS, sharing settings, or network restrictions.
- The page rejects HTML/JSON/text responses and checks PDF/MP3 signatures before saving. Saving uses a temporary OPFS file and commits metadata only after completion, or IndexedDB blobs when writable OPFS files are unavailable.

## Browser regression check

Serve the repository locally, install Playwright, then run:

```sh
node scripts/check_drive_download_test.mjs /path/to/full-book.pdf /path/to/L001-LESSON.mp3
```

`PROBE_URL`, `PLAYWRIGHT_MODULE`, and `CHROMIUM_PATH` override the server URL and browser installation. The test uses intercepted requests rather than contacting Google. It checks blocked requests, confirmation HTML, wrong file types, cancellation, OPFS and IndexedDB persistence, offline PDF/audio reopening, and preserving sentinel study data and the main worker during cleanup.
