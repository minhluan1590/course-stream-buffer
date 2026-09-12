# Course Stream Buffer

Course Stream Buffer is a Chrome extension that improves Udemy lecture playback by keeping videos preloaded and re-checking buffers aggressively while moving between lessons.

## Features

- Applies `preload="auto"` to detected `<video>` elements.
- Continues monitoring player sessions for many lecture videos.
- Attempts compatible player buffering goal changes on supported setups.
- Optional in-page diagnostic overlay (hidden by default).
- Optional unlimited buffering mode (best effort).
- Fast re-check when skipping/seeking to reduce wait after jumps.

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
- Buffer continuously: request a large/best-effort buffer
- Target seconds: fixed seconds when not in unlimited mode

## How to know it is working

Enable diagnostics and open a Udemy video:

- **Green**: buffer is at/near the configured target.
- **Amber**: partial buffering progress.
- **Red**: buffer is currently low.

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

Not every Udemy player exposes a public buffering API. When player-side control is unavailable, the extension still helps via preload and recheck behavior.

## License

MIT
