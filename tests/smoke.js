"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");

function makeElement(overrides = {}) {
  const listeners = new Map();
  const element = {
    listeners,
    addEventListener(name, callback) { listeners.set(name, callback); },
    appendChild() {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    files: [],
    getContext() {
      return {
        canvas: element,
        clearRect() {},
        drawImage() {},
        fillRect() {},
        fillText() {},
        getImageData() {
          const data = new Uint8ClampedArray(element.width * element.height * 4);
          for (let i = 0; i < data.length; i += 4) {
            data[i] = data[i + 1] = data[i + 2] = 128;
            data[i + 3] = 255;
          }
          return { data };
        },
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        lineJoin: "miter",
        lineWidth: 1,
        strokeStyle: "",
        strokeText() {},
        textBaseline: "top",
        font: ""
      };
    },
    height: 0,
    hidden: false,
    matches() {
      return false;
    },
    remove() {},
    setAttribute() {},
    style: {
      setProperty() {}
    },
    textContent: "",
    value: "",
    width: 0,
    ...overrides
  };
  return element;
}

const elements = new Map([
  ["#image-input", makeElement()],
  ["#drop-zone", makeElement()],
  ["#file-name", makeElement()],
  ["#camera-button", makeElement()],
  ["#camera-panel", makeElement()],
  ["#camera-video", makeElement()],
  ["#capture-button", makeElement()],
  ["#close-camera-button", makeElement()],
  ["#settings-form", makeElement()],
  ["#detail", makeElement({ value: "420" })],
  ["#detail-value", makeElement()],
  ["#fontSize", makeElement({ value: "6" })],
  ["#font-value", makeElement()],
  ["#glyphStrength", makeElement({ value: "1" })],
  ["#glyph-value", makeElement()],
  ["#shape", makeElement({ value: "0.72" })],
  ["#shape-value", makeElement()],
  ["#contrast", makeElement({ value: "1.18" })],
  ["#contrast-value", makeElement()],
  ["#brightness", makeElement({ value: "0" })],
  ["#brightness-value", makeElement()],
  ["#edge", makeElement({ value: "0.35" })],
  ["#edge-value", makeElement()],
  ["#dither", makeElement({ checked: true })],
  ["#invert", makeElement({ checked: false })],
  ["#charset", makeElement({ value: "detailed" })],
  ["#color-settings", makeElement()],
  ["#ascii-canvas", makeElement()],
  ["#status", makeElement()],
  ["#stats", makeElement()],
  ["#source-canvas", makeElement()],
  ["#reset-button", makeElement()],
  ["#copy-button", makeElement()],
  ["#txt-button", makeElement()],
  ["#png-button", makeElement()],
  ["#html-button", makeElement()]
]);

const formValues = { mode: "mono", colorStyle: "ink" };
class FakeFormData {
  get(name) {
    return formValues[name] || null;
  }
}

const timers = new Map();
let timerId = 0;
const context = {
  Blob,
  FormData: FakeFormData,
  Image: class {},
  atob(value) {
    return Buffer.from(value, "base64").toString("binary");
  },
  URL: {
    createObjectURL() {
      return "blob:test";
    },
    revokeObjectURL() {}
  },
  console,
  document: {
    body: makeElement(),
    createDocumentFragment() {
      return makeElement();
    },
    createElement() {
      return makeElement();
    },
    createTextNode(text) {
      return { text };
    },
    querySelector(selector) {
      if (!elements.has(selector)) {
        throw new Error(`Missing test element for ${selector}`);
      }
      return elements.get(selector);
    }
  },
  navigator: {
    clipboard: {
      async writeText() {}
    },
    mediaDevices: null
  },
  window: {
    addEventListener() {},
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) {
      callback();
    },
    setTimeout(callback) {
      timers.set(++timerId, callback);
      return timerId;
    }
  }
};

vm.runInNewContext(source, context, { filename: "app.js" });

assert.ok(Math.abs(context.relativeLuminance(255, 255, 255) - 1) < 1e-12);
assert.ok(Math.abs(context.relativeLuminance(0, 0, 0)) < 1e-12);
assert.strictEqual(context.charsWithoutDither(new Float32Array([0, 0.5, 1]), " .#", false).join(""), "#. ");
assert.strictEqual(context.charsWithoutDither(new Float32Array([0, 0.5, 1]), " .#", true).join(""), " .#");
assert.strictEqual(context.charsWithErrorDiffusion(new Float32Array([0, 0.5, 1, 0.25]), 2, 2, " .#", false).length, 4);
assert.strictEqual(context.backgroundForOptions({ mode: "mono", invert: false }), "#f8f5ed");
assert.strictEqual(context.backgroundForOptions({ mode: "mono", invert: true }), "#050606");
assert.strictEqual(context.backgroundForOptions({ mode: "black", invert: false }), "#050606");
assert.strictEqual(context.monoInkForOptions({ invert: false }), "#111313");
assert.strictEqual(context.monoInkForOptions({ mode: "mono", invert: true }), "#f5f1e7");
assert.strictEqual(context.monoInkForOptions({ mode: "black", invert: false }), "#f5f1e7");
assert.strictEqual(context.monoShade(0.2, { invert: false }), 51);
assert.strictEqual(context.monoShade(0.2, { invert: true }), 204);
assert.strictEqual(context.visibleGlyph(" ", { glyphStrength: 0.85 }), ".");
assert.strictEqual(context.visibleGlyph(" ", { mode: "black", glyphStrength: 1 }), " ");
assert.strictEqual(context.visibleGlyph(" ", { glyphStrength: 0.5 }), " ");
assert.strictEqual(context.characterInvertForOptions({ mode: "black", invert: false }), true);
assert.strictEqual(context.characterInvertForOptions({ mode: "black", invert: true }), false);
assert.strictEqual(context.characterInvertForOptions({ mode: "color", colorStyle: "ink", invert: false }), true);
assert.strictEqual(context.characterInvertForOptions({ mode: "color", colorStyle: "fill", invert: false }), false);
assert.strictEqual(JSON.stringify(context.resolveGridSize({ naturalWidth: 4000, naturalHeight: 3000 }, {
  requestedCols: 900,
  shape: 0.72
})), JSON.stringify({
  cols: 666,
  rows: 360,
  capped: true,
  requestedCols: 900
}));
assert.strictEqual(context.escapeHtml("<span>&\"'</span>"), "&lt;span&gt;&amp;&quot;&#39;&lt;/span&gt;");

// Check actual cell and canvas limits across extreme aspect ratios and font sizes.
for (const width of [1, 100, 4000, 100000]) {
  for (const height of [1, 100, 3000, 100000]) {
    for (const fontSize of [3, 6, 14]) {
      for (const shape of [0.45, 0.72, 0.9]) {
        const grid = context.resolveGridSize({ width, height }, { requestedCols: 900, shape, fontSize });
        const metrics = context.renderMetrics(fontSize);
        const padding = Math.max(12, Math.round(fontSize * 2));
        const canvasWidth = Math.ceil(grid.cols * metrics.cellWidth + padding * 2);
        const canvasHeight = Math.ceil(grid.rows * metrics.cellHeight + padding * 2);
        assert.ok(Number.isInteger(grid.cols) && grid.cols >= 1);
        assert.ok(Number.isInteger(grid.rows) && grid.rows >= 1);
        assert.ok(grid.cols * grid.rows <= 240000);
        assert.ok(canvasWidth <= 8192 && canvasHeight <= 8192);
        assert.ok(canvasWidth * canvasHeight <= 16000000);
      }
    }
  }
}

// Glyph opacity must never leak into the next cell's background.
for (const mode of ["mono", "color", "black"]) {
  const alphas = [];
  const ctx = {
    canvas: { width: 100, height: 100 },
    globalAlpha: 0.4,
    fillRect() { alphas.push(this.globalAlpha); },
    fillText() {},
    strokeText() {}
  };
  const options = { mode, colorStyle: "fill", glyphStrength: 0.4, fontSize: 6 };
  context.paintAscii(ctx, {
    cols: 2, rows: 1, chars: ["#", "#"], colors: [100, 100, 100, 100, 100, 100],
    colorLuma: [0.4, 0.4], luma: [0.4, 0.4]
  }, options, 12, context.renderMetrics(6));
  assert.ok(alphas.every((alpha) => alpha === 1));
  assert.strictEqual(ctx.globalAlpha, 1);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function checkAsyncFlows() {
  const imageLoads = [];
  context.fileToImage = () => {
    const load = deferred();
    imageLoads.push(load);
    return load.promise;
  };
  const older = context.loadFile({ type: "image/png", name: "older.png" });
  const newer = context.loadFile({ type: "image/png", name: "newer.png" });
  imageLoads[1].resolve({ width: 20, height: 20 });
  await newer;
  imageLoads[0].resolve({ width: 10, height: 10 });
  await older;
  assert.strictEqual(elements.get("#file-name").textContent, "newer.png");
  assert.strictEqual(vm.runInNewContext("state.image.width", context), 20);
  assert.strictEqual(elements.get("#png-button").disabled, true);

  const failed = context.loadFile({ type: "image/png", name: "broken.png" });
  const latest = context.loadFile({ type: "image/png", name: "latest.png" });
  imageLoads[3].resolve({ width: 30, height: 30 });
  await latest;
  imageLoads[2].reject(new Error("stale failure"));
  await failed;
  assert.strictEqual(elements.get("#status").textContent, "Rendering...");

  const requests = [];
  context.navigator.mediaDevices = { getUserMedia() {
    const request = deferred();
    requests.push(request);
    return request.promise;
  } };
  let stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped += 1; } }] };
  const camera = context.startCamera();
  assert.strictEqual(elements.get("#capture-button").disabled, true);
  assert.strictEqual(elements.get("#camera-panel").hidden, false);
  context.stopCamera();
  requests[0].resolve(stream);
  await camera;
  assert.strictEqual(stopped, 1, "A cancelled camera request must release its late stream");
  assert.strictEqual(elements.get("#camera-panel").hidden, true);
  assert.strictEqual(elements.get("#camera-video").srcObject, null);

  const active = context.startCamera();
  requests[1].resolve(stream);
  await active;
  elements.get("#camera-video").videoWidth = 640;
  elements.get("#camera-video").listeners.get("loadeddata")();
  assert.strictEqual(elements.get("#capture-button").disabled, false);
  context.stopCamera();
  assert.strictEqual(stopped, 2);

  // Only the most recent scheduled render may run; failures must disable exports.
  timers.clear();
  let renders = 0;
  const originalRender = context.renderAscii;
  context.renderAscii = () => { renders += 1; };
  context.scheduleRender(260);
  context.scheduleRender(260);
  assert.strictEqual(timers.size, 1);
  [...timers.values()][0]();
  assert.strictEqual(renders, 1);
  context.renderAscii = () => { throw new Error("Canvas allocation failed"); };
  context.console = { error() {} };
  context.scheduleRender(0);
  [...timers.values()].at(-1)();
  assert.match(elements.get("#status").textContent, /could not be rendered/);
  assert.strictEqual(elements.get("#png-button").disabled, true);
  assert.strictEqual(vm.runInNewContext("state.lastResult", context), null);
  context.renderAscii = originalRender;

  // Exercise the complete pipeline with a deterministic image sample in every mode.
  elements.get("#detail").value = "80";
  for (const mode of ["mono", "black", "color"]) {
    for (const colorStyle of ["ink", "fill"]) {
      formValues.mode = mode;
      formValues.colorStyle = colorStyle;
      context.renderAscii();
      const result = vm.runInNewContext("state.lastResult", context);
      assert.strictEqual(result.text.split("\n").length, result.rows);
      assert.ok(result.text.split("\n").every((line) => line.length === result.cols));
      assert.ok(result.luma.every(Number.isFinite));
      assert.match(context.exportHtmlBody(result), /^<pre>.*<\/pre>$/s);
      assert.strictEqual(elements.get("#png-button").disabled, false);
    }
  }

  // PNG encoding uses the existing preview and reports a null-blob failure.
  vm.runInNewContext("state.lastResult = { text: 'test' }", context);
  elements.get("#ascii-canvas").toBlob = (callback) => callback(null);
  context.downloadPng();
  assert.match(elements.get("#status").textContent, /PNG export failed/);
  const png = new Blob(["test"], { type: "image/png" });
  let downloaded;
  context.downloadExistingBlob = (filename, blob) => { downloaded = { filename, blob }; };
  elements.get("#ascii-canvas").toBlob = (callback) => callback(png);
  context.downloadPng();
  assert.strictEqual(downloaded.blob, png);
  assert.strictEqual(downloaded.filename, "latest.png");
}

checkAsyncFlows().then(() => {
  console.log("smoke tests passed (render limits, opacity, image/camera races, scheduling, export errors)");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
