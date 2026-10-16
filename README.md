# Image ASCII Studio

A completely local photo-to-ASCII converter. It runs in a browser on macOS or Windows with no package install step and no network requirement.

## Run

Open `index.html` in a modern browser.

For camera capture, some browsers require a local server before allowing webcam permission. From this folder you can run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

On Windows with Python installed:

```sh
py -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000`.

## Export

- `TXT` saves plain black-and-white ASCII text.
- `PNG` saves the rendered preview.
- `HTML` saves a standalone colored or black-and-white ASCII document.
- `Black` mode renders white characters on a black background.
- `Reset Sliders` restores the detail, size, shape, contrast, brightness, edge, and glyph strength defaults.

Everything happens locally in the browser.

Very large output is automatically reduced to stay within 240,000 characters,
8,192 pixels per canvas side, and 16 million canvas pixels. Character size can
therefore affect the maximum detail. PNG exports use the rendered preview directly.

## Checks

No dependencies are required. With Node.js installed, run:

```sh
node --check app.js
node tests/smoke.js
```
