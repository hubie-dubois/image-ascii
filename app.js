"use strict";

const RAMP_DETAILED = " .'`^\",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const CHARSETS = {
  detailed: RAMP_DETAILED,
  classic: " .:-=+*#%@",
  dense: " .,:;ox%#@",
  minimal: " .#@"
};

const MAX_CELLS = 240000;
const MAX_CANVAS_SIDE = 8192;
const MAX_CANVAS_PIXELS = 16000000;
const RENDER_DEBOUNCE_MS = 260;
const PREVIEW_BG = "#050606";
const PREVIEW_INK = "#f5f1e7";
const MONO_BG = "#f8f5ed";
const DARK_INK = "#111313";
const SLIDER_DEFAULTS = {
  detail: "420",
  fontSize: "6",
  glyphStrength: "1",
  shape: "0.72",
  contrast: "1.18",
  brightness: "0",
  edge: "0.35"
};

const els = {
  imageInput: document.querySelector("#image-input"),
  dropZone: document.querySelector("#drop-zone"),
  fileName: document.querySelector("#file-name"),
  cameraButton: document.querySelector("#camera-button"),
  cameraPanel: document.querySelector("#camera-panel"),
  cameraVideo: document.querySelector("#camera-video"),
  captureButton: document.querySelector("#capture-button"),
  closeCameraButton: document.querySelector("#close-camera-button"),
  form: document.querySelector("#settings-form"),
  detail: document.querySelector("#detail"),
  detailValue: document.querySelector("#detail-value"),
  fontSize: document.querySelector("#fontSize"),
  fontValue: document.querySelector("#font-value"),
  glyphStrength: document.querySelector("#glyphStrength"),
  glyphValue: document.querySelector("#glyph-value"),
  shape: document.querySelector("#shape"),
  shapeValue: document.querySelector("#shape-value"),
  contrast: document.querySelector("#contrast"),
  contrastValue: document.querySelector("#contrast-value"),
  brightness: document.querySelector("#brightness"),
  brightnessValue: document.querySelector("#brightness-value"),
  edge: document.querySelector("#edge"),
  edgeValue: document.querySelector("#edge-value"),
  dither: document.querySelector("#dither"),
  invert: document.querySelector("#invert"),
  charset: document.querySelector("#charset"),
  colorSettings: document.querySelector("#color-settings"),
  asciiCanvas: document.querySelector("#ascii-canvas"),
  status: document.querySelector("#status"),
  stats: document.querySelector("#stats"),
  sourceCanvas: document.querySelector("#source-canvas"),
  resetButton: document.querySelector("#reset-button"),
  copyButton: document.querySelector("#copy-button"),
  txtButton: document.querySelector("#txt-button"),
  pngButton: document.querySelector("#png-button"),
  htmlButton: document.querySelector("#html-button")
};

const state = {
  image: null,
  imageName: "ascii-art",
  lastResult: null,
  cameraStream: null,
  cameraToken: 0,
  imageToken: 0,
  renderToken: 0,
  renderTimer: 0
};

const sourceCtx = els.sourceCanvas.getContext("2d", { willReadFrequently: true });
const previewCtx = els.asciiCanvas.getContext("2d");
const rampCache = new Map();

bindEvents();
syncControls();
drawPlaceholder();

function bindEvents() {
  els.imageInput.addEventListener("change", () => {
    const file = els.imageInput.files && els.imageInput.files[0];
    if (file) loadFile(file);
    els.imageInput.value = "";
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("is-dragging");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  els.form.addEventListener("input", handleSettingsChange);
  els.form.addEventListener("change", handleSettingsChange);

  els.cameraButton.addEventListener("click", startCamera);
  els.captureButton.addEventListener("click", capturePhoto);
  els.closeCameraButton.addEventListener("click", () => {
    stopCamera();
    setStatus("Camera closed.");
  });
  els.resetButton.addEventListener("click", resetSliders);
  els.copyButton.addEventListener("click", copyText);
  els.txtButton.addEventListener("click", downloadText);
  els.pngButton.addEventListener("click", downloadPng);
  els.htmlButton.addEventListener("click", downloadHtml);
  els.cameraVideo.addEventListener("loadeddata", () => {
    els.captureButton.disabled = !state.cameraStream || !els.cameraVideo.videoWidth;
    if (!els.captureButton.disabled) setStatus("Camera ready.");
  });
  window.addEventListener("pagehide", stopCamera);
}

function handleSettingsChange(event) {
  if (event.type === "change" && event.target && event.target.matches && event.target.matches("input[type='range']")) {
    return;
  }

  syncControls();
  const delay = event.target && event.target.matches && event.target.matches("input[type='range']")
    ? RENDER_DEBOUNCE_MS
    : 0;
  scheduleRender(delay);
}

function syncControls() {
  const options = getOptions();
  els.detailValue.value = String(options.requestedCols);
  els.fontValue.value = `${options.fontSize}px`;
  els.glyphValue.value = options.glyphStrength.toFixed(2);
  els.shapeValue.value = options.shape.toFixed(2);
  els.contrastValue.value = options.contrast.toFixed(2);
  els.brightnessValue.value = formatSigned(options.brightness);
  els.edgeValue.value = options.edge.toFixed(2);
  els.colorSettings.hidden = options.mode !== "color";
}

function getOptions() {
  const formData = new FormData(els.form);
  return {
    mode: String(formData.get("mode") || "mono"),
    colorStyle: String(formData.get("colorStyle") || "ink"),
    requestedCols: Number(els.detail.value),
    fontSize: Number(els.fontSize.value),
    glyphStrength: Number(els.glyphStrength.value),
    shape: Number(els.shape.value),
    contrast: Number(els.contrast.value),
    brightness: Number(els.brightness.value),
    edge: Number(els.edge.value),
    dither: els.dither.checked,
    invert: els.invert.checked,
    charset: String(els.charset.value || "detailed")
  };
}

function formatSigned(value) {
  if (Math.abs(value) < 0.005) return "0";
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function resetSliders() {
  Object.entries(SLIDER_DEFAULTS).forEach(([key, value]) => {
    els[key].value = value;
  });
  syncControls();
  scheduleRender(0);
}

async function loadFile(file) {
  if (!file.type.startsWith("image/")) {
    setStatus("Select an image file.");
    return;
  }

  const token = ++state.imageToken;
  stopCamera();
  try {
    setStatus("Loading image...");
    const image = await fileToImage(file);
    if (token !== state.imageToken) return;
    state.image = image;
    state.imageName = stripExtension(file.name) || "ascii-art";
    els.fileName.textContent = file.name;
    scheduleRender(0);
  } catch (error) {
    if (token !== state.imageToken) return;
    console.error(error);
    setStatus("The image could not be loaded.");
  }
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    image.src = url;
  });
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Camera access is not available in this browser.");
    return;
  }

  stopCamera();
  const token = state.cameraToken;
  els.cameraButton.disabled = true;
  els.cameraPanel.hidden = false;
  setStatus("Waiting for camera permission...");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    if (token !== state.cameraToken) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    state.cameraStream = stream;
    els.cameraVideo.srcObject = stream;
    setStatus("Starting camera...");
  } catch (error) {
    if (token !== state.cameraToken) return;
    stopCamera();
    console.error(error);
    setStatus("Camera permission was blocked or unavailable.");
  }
}

function capturePhoto() {
  const video = els.cameraVideo;
  if (!state.cameraStream || !video.videoWidth || !video.videoHeight) return;
  const token = ++state.imageToken;

  els.sourceCanvas.width = video.videoWidth;
  els.sourceCanvas.height = video.videoHeight;
  sourceCtx.drawImage(video, 0, 0);
  const image = new Image();
  image.onload = () => {
    if (token !== state.imageToken) return;
    state.image = image;
    state.imageName = `camera-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
    els.fileName.textContent = "Camera capture";
    scheduleRender(0);
  };
  image.onerror = () => {
    if (token === state.imageToken) setStatus("The camera photo could not be loaded.");
  };
  image.src = els.sourceCanvas.toDataURL("image/png");
  stopCamera();
}

function stopCamera() {
  state.cameraToken += 1;
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
  }
  els.cameraVideo.srcObject = null;
  els.cameraPanel.hidden = true;
  els.captureButton.disabled = true;
  els.cameraButton.disabled = false;
}

function scheduleRender(delay) {
  window.clearTimeout(state.renderTimer);

  if (!state.image) {
    setActions(false);
    return;
  }

  const token = ++state.renderToken;
  setActions(false);
  setStatus(delay ? "Waiting for slider input..." : "Rendering...");
  state.renderTimer = window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      if (token !== state.renderToken) return;
      try {
        renderAscii();
      } catch (error) {
        console.error(error);
        state.lastResult = null;
        setActions(false);
        setStatus("The preview could not be rendered. Try a smaller image or lower detail.");
      }
    });
  }, delay);
}

function renderAscii() {
  if (!state.image) {
    setActions(false);
    return;
  }

  const options = getOptions();
  const grid = resolveGridSize(state.image, options);
  const sampled = sampleImageToCells(state.image, grid.cols, grid.rows, options);
  const detailedLuma = options.edge > 0
    ? applyEdgeBoost(sampled.luma, grid.cols, grid.rows, options.edge)
    : sampled.luma;
  const ramp = getCalibratedRamp(options.charset, options.fontSize);
  const invertForChars = characterInvertForOptions(options);
  const chars = options.dither
    ? charsWithErrorDiffusion(detailedLuma, grid.cols, grid.rows, ramp, invertForChars)
    : charsWithoutDither(detailedLuma, ramp, invertForChars);
  const text = buildText(chars, grid.cols, grid.rows);

  const result = {
    cols: grid.cols,
    rows: grid.rows,
    capped: grid.capped,
    requestedCols: grid.requestedCols,
    chars,
    colors: sampled.colors,
    luma: detailedLuma,
    colorLuma: sampled.colorLuma,
    text,
    options
  };

  drawPreview(result, options);
  state.lastResult = result;
  els.stats.textContent = `${grid.cols} x ${grid.rows}`;
  setStatus(statusForResult(result));
  setActions(true);
}

function resolveGridSize(image, options) {
  const width = image.naturalWidth || image.width || 1;
  const height = image.naturalHeight || image.height || 1;
  const ratio = height / width;
  const shapeFactor = ratio * options.shape;
  const requestedCols = Math.max(1, Math.round(options.requestedCols));
  const fontSize = options.fontSize || Number(SLIDER_DEFAULTS.fontSize);
  const metrics = renderMetrics(fontSize);
  const padding = Math.max(12, Math.round(fontSize * 2));
  const maxRows = Math.floor((MAX_CANVAS_SIDE - padding * 2) / metrics.cellHeight);
  const maxCols = Math.floor((MAX_CANVAS_SIDE - padding * 2) / metrics.cellWidth);
  let cols = Math.max(1, Math.min(requestedCols, maxCols,
    Math.floor(Math.sqrt(MAX_CELLS / shapeFactor)), Math.floor(maxRows / shapeFactor)));
  let rows = Math.max(1, Math.min(maxRows, Math.round(shapeFactor * cols)));

  // Include padding and rounding in the limits, even for a one-column portrait.
  while (cols * rows > MAX_CELLS ||
    Math.ceil(cols * metrics.cellWidth + padding * 2) *
    Math.ceil(rows * metrics.cellHeight + padding * 2) > MAX_CANVAS_PIXELS) {
    if (cols > 1) {
      cols -= 1;
      rows = Math.max(1, Math.min(maxRows, Math.round(shapeFactor * cols)));
    } else {
      rows -= 1;
    }
  }

  return {
    cols,
    rows,
    capped: cols < requestedCols,
    requestedCols
  };
}

function sampleImageToCells(image, cols, rows, options) {
  const cellCount = cols * rows;
  const scale = cellCount <= 90000 ? 3 : 2;
  const sampleCols = cols * scale;
  const sampleRows = rows * scale;

  els.sourceCanvas.width = sampleCols;
  els.sourceCanvas.height = sampleRows;
  sourceCtx.imageSmoothingEnabled = true;
  sourceCtx.imageSmoothingQuality = "high";
  sourceCtx.fillStyle = "#ffffff";
  sourceCtx.fillRect(0, 0, sampleCols, sampleRows);
  sourceCtx.drawImage(image, 0, 0, sampleCols, sampleRows);

  const pixels = sourceCtx.getImageData(0, 0, sampleCols, sampleRows).data;
  const luma = new Float32Array(cellCount);
  const colors = new Uint8ClampedArray(cellCount * 3);
  const colorLuma = new Float32Array(cellCount);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let lumaSum = 0;
      let minLuma = 1;
      let maxLuma = 0;

      for (let sy = 0; sy < scale; sy += 1) {
        const pixelY = y * scale + sy;
        for (let sx = 0; sx < scale; sx += 1) {
          const pixelX = x * scale + sx;
          const pixelIndex = (pixelY * sampleCols + pixelX) * 4;
          const alpha = pixels[pixelIndex + 3] / 255;
          const r = pixels[pixelIndex] * alpha + 255 * (1 - alpha);
          const g = pixels[pixelIndex + 1] * alpha + 255 * (1 - alpha);
          const b = pixels[pixelIndex + 2] * alpha + 255 * (1 - alpha);
          const pixelLuma = relativeLuminance(r, g, b);

          rSum += r;
          gSum += g;
          bSum += b;
          lumaSum += pixelLuma;
          minLuma = Math.min(minLuma, pixelLuma);
          maxLuma = Math.max(maxLuma, pixelLuma);
        }
      }

      const cellIndex = y * cols + x;
      const samples = scale * scale;
      const r = Math.round(rSum / samples);
      const g = Math.round(gSum / samples);
      const b = Math.round(bSum / samples);
      const averageLuma = lumaSum / samples;
      const texture = maxLuma - minLuma;
      const mapped = toneMap(averageLuma, options);
      const microContrast = (mapped - 0.5) * texture * 0.45;

      luma[cellIndex] = clamp(mapped + microContrast, 0, 1);
      colors[cellIndex * 3] = r;
      colors[cellIndex * 3 + 1] = g;
      colors[cellIndex * 3 + 2] = b;
      colorLuma[cellIndex] = relativeLuminance(r, g, b);
    }
  }

  return {
    luma,
    colors,
    colorLuma
  };
}

function toneMap(luma, options) {
  return clamp((luma - 0.5) * options.contrast + 0.5 + options.brightness, 0, 1);
}

function relativeLuminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function applyEdgeBoost(luma, cols, rows, strength) {
  const output = new Float32Array(luma.length);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const index = y * cols + x;
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
        output[index] = luma[index];
        continue;
      }

      const a = luma[index - cols - 1];
      const b = luma[index - cols];
      const c = luma[index - cols + 1];
      const d = luma[index - 1];
      const f = luma[index + 1];
      const g = luma[index + cols - 1];
      const h = luma[index + cols];
      const i = luma[index + cols + 1];
      const gx = -a + c - 2 * d + 2 * f - g + i;
      const gy = -a - 2 * b - c + g + 2 * h + i;
      const edge = Math.min(1, Math.sqrt(gx * gx + gy * gy));
      output[index] = clamp(luma[index] - edge * strength * 0.55, 0, 1);
    }
  }
  return output;
}

function getCalibratedRamp(charsetName, fontSize) {
  const rawRamp = CHARSETS[charsetName] || CHARSETS.detailed;
  const cacheKey = `${charsetName}:${fontSize}`;
  if (rampCache.has(cacheKey)) return rampCache.get(cacheKey);

  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const size = 80;
    const fontPx = Math.max(42, fontSize * 8);
    const scored = [];

    canvas.width = size;
    canvas.height = size;
    rawRamp.split("").forEach((char) => {
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#ffffff";
      ctx.font = `${fontPx}px ${canvasFontStack()}`;
      ctx.textBaseline = "middle";
      ctx.fillText(char, 4, size / 2);

      const data = ctx.getImageData(0, 0, size, size).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        ink += data[i];
      }
      scored.push({ char, ink });
    });

    scored.sort((a, b) => a.ink - b.ink);
    const calibrated = scored.map((item) => item.char).join("");
    rampCache.set(cacheKey, calibrated);
    return calibrated;
  } catch (error) {
    rampCache.set(cacheKey, rawRamp);
    return rawRamp;
  }
}

function charsWithoutDither(luma, ramp, invert) {
  const chars = new Array(luma.length);
  const maxIndex = ramp.length - 1;
  for (let i = 0; i < luma.length; i += 1) {
    const value = invert ? luma[i] : 1 - luma[i];
    chars[i] = ramp[Math.round(clamp(value, 0, 1) * maxIndex)];
  }
  return chars;
}

function charsWithErrorDiffusion(luma, cols, rows, ramp, invert) {
  const working = new Float32Array(luma);
  const chars = new Array(luma.length);
  const maxIndex = ramp.length - 1;

  for (let y = 0; y < rows; y += 1) {
    const leftToRight = y % 2 === 0;
    const xStart = leftToRight ? 0 : cols - 1;
    const xEnd = leftToRight ? cols : -1;
    const step = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += step) {
      const index = y * cols + x;
      const value = clamp(invert ? working[index] : 1 - working[index], 0, 1);
      const rampIndex = Math.round(value * maxIndex);
      chars[index] = ramp[rampIndex];
      const quantized = rampIndex / maxIndex;
      const quantizedLuma = invert ? quantized : 1 - quantized;
      const error = working[index] - quantizedLuma;

      diffuse(working, cols, rows, x + step, y, error * 7 / 16);
      diffuse(working, cols, rows, x - step, y + 1, error * 3 / 16);
      diffuse(working, cols, rows, x, y + 1, error * 5 / 16);
      diffuse(working, cols, rows, x + step, y + 1, error * 1 / 16);
    }
  }

  return chars;
}

function diffuse(buffer, cols, rows, x, y, amount) {
  if (x < 0 || x >= cols || y < 0 || y >= rows) return;
  const index = y * cols + x;
  buffer[index] = clamp(buffer[index] + amount, 0, 1);
}

function buildText(chars, cols, rows) {
  const lines = new Array(rows);
  for (let y = 0; y < rows; y += 1) {
    let line = "";
    const offset = y * cols;
    for (let x = 0; x < cols; x += 1) {
      line += chars[offset + x];
    }
    lines[y] = line;
  }
  return lines.join("\n");
}

function drawPlaceholder() {
  els.asciiCanvas.width = 960;
  els.asciiCanvas.height = 560;
  els.asciiCanvas.style.width = "960px";
  els.asciiCanvas.style.height = "560px";
  previewCtx.fillStyle = PREVIEW_BG;
  previewCtx.fillRect(0, 0, els.asciiCanvas.width, els.asciiCanvas.height);
  previewCtx.fillStyle = "#767168";
  previewCtx.font = `16px ${canvasFontStack()}`;
  previewCtx.textBaseline = "top";
  previewCtx.fillText("No preview yet", 18, 18);
}

function drawPreview(result, options) {
  const metrics = renderMetrics(options.fontSize);
  const padding = Math.max(12, Math.round(options.fontSize * 2));
  const width = Math.ceil(result.cols * metrics.cellWidth + padding * 2);
  const height = Math.ceil(result.rows * metrics.cellHeight + padding * 2);

  els.asciiCanvas.width = width;
  els.asciiCanvas.height = height;
  els.asciiCanvas.style.width = `${width}px`;
  els.asciiCanvas.style.height = `${height}px`;
  paintAscii(previewCtx, result, options, padding, metrics);
}

function paintAscii(ctx, result, options, padding, metrics) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = backgroundForOptions(options);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.textBaseline = "top";
  ctx.font = `${fontWeightForOptions(options)} ${options.fontSize}px ${canvasFontStack()}`;
  ctx.lineJoin = "round";
  ctx.lineWidth = outlineWidthForOptions(options);

  for (let y = 0; y < result.rows; y += 1) {
    const drawY = padding + y * metrics.cellHeight;
    for (let x = 0; x < result.cols; x += 1) {
      const index = y * result.cols + x;
      const drawX = padding + x * metrics.cellWidth;
      const r = result.colors[index * 3];
      const g = result.colors[index * 3 + 1];
      const b = result.colors[index * 3 + 2];
      let glyph = result.chars[index];
      let fillStyle = PREVIEW_INK;
      let outlineStyle = "transparent";
      ctx.globalAlpha = 1;

      if (options.mode === "color" && options.colorStyle === "fill") {
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(drawX, drawY, metrics.cellWidth + 0.35, metrics.cellHeight + 0.35);
        fillStyle = result.colorLuma[index] > 0.52 ? DARK_INK : PREVIEW_INK;
        outlineStyle = result.colorLuma[index] > 0.52 ? PREVIEW_INK : DARK_INK;
      } else if (options.mode === "color") {
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(drawX, drawY, metrics.cellWidth + 0.35, metrics.cellHeight + 0.35);
        ctx.globalAlpha = 1;
        fillStyle = PREVIEW_INK;
        outlineStyle = DARK_INK;
      } else if (options.mode === "black") {
        fillStyle = PREVIEW_INK;
        outlineStyle = DARK_INK;
      } else {
        const shade = monoShade(result.luma[index], options);
        ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        ctx.fillRect(drawX, drawY, metrics.cellWidth + 0.35, metrics.cellHeight + 0.35);
        fillStyle = shade > 140 ? DARK_INK : PREVIEW_INK;
        outlineStyle = shade > 140 ? PREVIEW_INK : DARK_INK;
      }

      glyph = visibleGlyph(glyph, options);
      drawGlyph(ctx, glyph, drawX, drawY, fillStyle, outlineStyle, options);
    }
  }
  ctx.globalAlpha = 1;
}

function renderMetrics(fontSize) {
  return {
    cellWidth: Math.max(2, fontSize * 0.62),
    cellHeight: Math.max(3, fontSize * 0.82)
  };
}

function backgroundForOptions(options) {
  if (options.mode !== "mono") return PREVIEW_BG;
  return options.invert ? PREVIEW_BG : MONO_BG;
}

function monoInkForOptions(options) {
  if (options.mode === "black") return PREVIEW_INK;
  return options.invert ? PREVIEW_INK : DARK_INK;
}

function monoShade(luma, options) {
  const visibleLuma = options.invert ? 1 - luma : luma;
  return Math.round(clamp(visibleLuma, 0, 1) * 255);
}

function characterInvertForOptions(options) {
  if (options.mode === "color" && options.colorStyle === "ink") return !options.invert;
  if (options.mode === "black") return !options.invert;
  return options.invert;
}

function fontWeightForOptions(options) {
  return Math.round(450 + options.glyphStrength * 450);
}

function outlineWidthForOptions(options) {
  if (options.glyphStrength < 0.55) return 0;
  return Math.max(0.35, options.fontSize * 0.12 * options.glyphStrength);
}

function drawGlyph(ctx, glyph, x, y, fillStyle, outlineStyle, options) {
  if (!glyph) return;

  ctx.globalAlpha = clamp(options.glyphStrength, 0.35, 1);
  if (ctx.lineWidth > 0 && glyph !== " ") {
    ctx.strokeStyle = outlineStyle;
    ctx.strokeText(glyph, x, y);
  }
  ctx.fillStyle = fillStyle;
  ctx.fillText(glyph, x, y);
}

function visibleGlyph(glyph, options) {
  if (glyph !== " ") return glyph;
  if (options.mode === "black") return glyph;
  return options.glyphStrength >= 0.8 ? "." : glyph;
}

function statusForResult(result) {
  const count = (result.cols * result.rows).toLocaleString();
  if (result.capped) {
    return `${count} characters generated. Detail capped from ${result.requestedCols} to ${result.cols} to keep the app responsive.`;
  }
  return `${count} characters generated.`;
}

function setStatus(message) {
  els.status.textContent = message;
}

function setActions(enabled) {
  [els.copyButton, els.txtButton, els.pngButton, els.htmlButton].forEach((button) => {
    button.disabled = !enabled;
  });
}

async function copyText() {
  if (!state.lastResult) return;

  try {
    await navigator.clipboard.writeText(state.lastResult.text);
    setStatus("ASCII text copied.");
  } catch (error) {
    console.error(error);
    setStatus("Clipboard permission was blocked.");
  }
}

function downloadText() {
  if (!state.lastResult) return;
  downloadBlob(`${state.imageName}.txt`, "text/plain;charset=utf-8", state.lastResult.text);
}

function downloadHtml() {
  if (!state.lastResult) return;

  const result = state.lastResult;
  const options = result.options;
  const escapedTitle = escapeHtml(state.imageName);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapedTitle} ASCII</title>
<style>
body{margin:0;background:${backgroundForOptions(options)};color:${options.mode === "mono" || options.mode === "black" ? monoInkForOptions(options) : PREVIEW_INK}}
pre{display:inline-block;margin:0;padding:16px;font:${options.fontSize}px/0.82 ${cssFontStack()};letter-spacing:0;white-space:pre}
.fill{display:inline-block;width:.62em;overflow:hidden;text-align:center}
.outline{text-shadow:0 0 1px #000,0 0 2px #000}
</style>
</head>
<body>
${exportHtmlBody(result)}
</body>
</html>`;
  downloadBlob(`${state.imageName}.html`, "text/html;charset=utf-8", html);
}

function exportHtmlBody(result) {
  const options = result.options;
  if (options.mode === "black") {
    return `<pre>${escapeHtml(result.text)}</pre>`;
  }

  if (options.mode === "mono") {
    return `<pre>${exportSpanLines(result, true).join("\n")}</pre>`;
  }

  return `<pre>${exportSpanLines(result, false).join("\n")}</pre>`;
}

function exportSpanLines(result, mono) {
  const options = result.options;
  const lines = new Array(result.rows);
  for (let y = 0; y < result.rows; y += 1) {
    let line = "";
    for (let x = 0; x < result.cols; x += 1) {
      const index = y * result.cols + x;
      const r = result.colors[index * 3];
      const g = result.colors[index * 3 + 1];
      const b = result.colors[index * 3 + 2];
      const char = escapeHtml(visibleGlyph(result.chars[index], options));

      if (mono) {
        const shade = monoShade(result.luma[index], options);
        const ink = shade > 140 ? DARK_INK : PREVIEW_INK;
        line += `<span class="fill" style="background-color:rgb(${shade},${shade},${shade});color:${ink}">${char}</span>`;
        continue;
      }

      if (options.colorStyle === "fill") {
        const ink = result.colorLuma[index] > 0.52 ? DARK_INK : PREVIEW_INK;
        line += `<span class="fill" style="background-color:rgb(${r},${g},${b});color:${ink}">${char}</span>`;
      } else {
        line += `<span class="fill outline" style="background-color:rgba(${r},${g},${b},0.32);color:${PREVIEW_INK}">${char}</span>`;
      }
    }
    lines[y] = line;
  }
  return lines;
}

function downloadPng() {
  if (!state.lastResult) return;
  const filename = `${state.imageName}.png`;
  try {
    // Encode the existing preview instead of allocating and repainting a second canvas.
    els.asciiCanvas.toBlob((blob) => {
      if (blob) {
        downloadExistingBlob(filename, blob);
      } else {
        setStatus("PNG export failed. Try lower detail or a smaller character size.");
      }
    }, "image/png");
  } catch (error) {
    console.error(error);
    setStatus("PNG export failed. Try lower detail or a smaller character size.");
  }
}

function downloadBlob(filename, type, content) {
  downloadExistingBlob(filename, new Blob([content], { type }));
}

function downloadExistingBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stripExtension(filename) {
  return filename.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function cssFontStack() {
  return '"SFMono-Regular","Cascadia Mono",Consolas,"Liberation Mono",Menlo,monospace';
}

function canvasFontStack() {
  return '"SFMono-Regular", "Cascadia Mono", Consolas, "Liberation Mono", Menlo, monospace';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
