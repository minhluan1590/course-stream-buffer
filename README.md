# Course Stream Buffer

Course Stream Buffer is a Chrome extension that monitors the native Udemy video buffer and applies only standard browser preload hints. It never changes playback speed or Udemy's internal player configuration.

## Features

- Applies `preload="auto"` to detected `<video>` elements.
- Shows the browser-reported buffered-ahead time on demand.
- Optional in-page diagnostic overlay (hidden by default).
- Does not call `video.load()` or alter private player state, avoiding MediaSource playback interruptions.

## Install

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `course_stream_buffer`
5. Open a Udemy lecture page
6. Open Extension options to tune behaviour

## Extension options

Open options from the extension card in `chrome://extensions/` → Details → Extension options:

- Show diagnostics: enable/disable debug overlay (default off)

## How to know it is working

Enable diagnostics and open a Udemy video:

- **Green**: at least 30 seconds currently buffered.
- **Amber**: 5–29 seconds currently buffered.
- **Red**: under 5 seconds currently buffered.

If diagnostics is disabled (default), verify by jumping around videos quickly:

- the next segment should begin receiving data sooner than before,
- fewer stalls should occur after fast navigation.

## Release package (compiled download)

This repository ships release assets from GitHub Releases.

Workflow:
- On tag push (`v*`) a `.zip` file is automatically built from `course_stream_buffer`.
- The zip appears on the release page for that tag.

Manual packaging:

```bash
zip -r course-stream-buffer.zip course_stream_buffer -x "*.DS_Store" "*.git/*"
```

Public release page:
`https://github.com/minhluan1590/course-stream-buffer/releases`

## Repository structure

- `course_stream_buffer/manifest.json`
- `course_stream_buffer/content.js`
- `course_stream_buffer/options.html`
- `course_stream_buffer/options.js`
- `course_stream_buffer/icon16.png`, `course_stream_buffer/icon48.png`, `course_stream_buffer/icon128.png`
- `.github/workflows/release.yml`

## Notes

Udemy uses an adaptive MediaSource stream. The site, your connection, and its DRM/CDN controls determine buffer size; no Chrome extension can safely force unlimited buffering or create extra authenticated video sessions. This extension intentionally does not interfere with that pipeline.

## License

MIT
