# Course Stream Buffer

Course Stream Buffer is a small Chrome extension that improves Udemy lecture loading by:

- forcing `preload="auto"` on Udemy `<video>` elements,
- continuously monitoring buffer windows while videos load,
- attempting to raise supported player buffering goals up to 60 seconds (where the page exposes a compatible player API).

This project is designed to run in your browser as an unpacked extension and is intentionally lightweight.

## Features

- Supports multiple active videos on the page.
- Shows a live on-page overlay with:
  - current buffered seconds ahead of playback,
  - effective buffer goal status,
  - inferred player capability status.
- Keeps playback rate untouched (1x only).

## Install (recommended)

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `course_stream_buffer` directory in this repository.
5. Open a Udemy lecture page and let the overlay confirm activity.

## How to know it is working

You should see the floating overlay in the lower-right while on a lecture page:

- Green-ish text background: buffer is at or above 60s.
- Amber: partial progress toward 60s.
- Red: low buffered window.

If the overlay shows:

- `goal 60s active` → a recognized player API accepted the buffering request.
- `player not accessible ...` → the page player could not be directly configured.

Even when configuration is unavailable, the extension still keeps a browser-side preload hint active for every detected `<video>`.

## Public release (GitHub)

You told me you want this published publicly under your account. I cannot perform authenticated publishing from this environment without your repository token/credentials, but you can publish fast:

```bash
git init
git add .
git commit -m "Initial release of Course Stream Buffer"
git branch -M main
git remote add origin https://github.com/<your-username>/course-stream-buffer.git
git push -u origin main
```

If your username is `minhluan1590`, use:

```bash
git remote set-url origin https://github.com/minhluan1590/course-stream-buffer.git
```

## Repository structure

- `course_stream_buffer/manifest.json` - extension manifest.
- `course_stream_buffer/content.js` - core buffering and detection logic.
- `course_stream_buffer/icon16.png`, `course_stream_buffer/icon48.png`, `course_stream_buffer/icon128.png` - UI assets.
- Legacy files from the previous baseline remain in this repository as `legacy_*` items and are not used by the published extension:
  - `legacy_udemy_video_preloader.crx`, `legacy_udemy_video_preloader.pem`
  - `legacy_screenshot1.png`, `legacy_screenshot2.png`
  - `legacy_udemy_video_preloader`, `legacy_udemy_video_preloader_safe`

## License

MIT License.

## Limitations and safety note

Not all Udemy player builds expose a public JavaScript API for changing buffer goals. In those cases the extension behaves safely by only applying browser-level preload hints and transparent diagnostics.
