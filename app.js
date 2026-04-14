// Gray-Scott Reaction Diffusion Simulator
// Bioluminescent deep-sea aesthetic

const CELL_SIZE = 2; // pixels per cell

const PRESETS = {
  spots:        { f: 0.035,  k: 0.065 },
  coral:        { f: 0.0545, k: 0.062 },
  fingerprints: { f: 0.037,  k: 0.060 },
  maze:         { f: 0.029,  k: 0.057 },
};

const Du = 0.2097;
let Dv = 0.105;
let f = PRESETS.spots.f;
let k = PRESETS.spots.k;

let canvas, ctx;
let W, H;        // grid dimensions (pixels / CELL_SIZE)
let uCurr, vCurr, uNext, vNext;
let imageData, pixels;
let isPointerDown = false;
let animId;
let frameCount = 0;

function init() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d', { willReadFrequently: false });

  resize();
  window.addEventListener('resize', () => { resize(); resetGrid(); });

  // Pointer events for seeding
  canvas.addEventListener('mousedown', e => { isPointerDown = true; seed(e.clientX, e.clientY); });
  canvas.addEventListener('mousemove', e => { if (isPointerDown) seed(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { isPointerDown = false; });

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    isPointerDown = true;
    seed(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (isPointerDown) seed(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  window.addEventListener('touchend', () => { isPointerDown = false; });

  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const p = PRESETS[btn.dataset.preset];
      f = p.f; k = p.k;
      document.getElementById('slider-feed').value = f;
      document.getElementById('slider-kill').value = k;
      document.getElementById('val-feed').textContent = f.toFixed(4);
      document.getElementById('val-kill').textContent = k.toFixed(4);
      setStatus('preset loaded — watch it evolve...');
    });
  });

  // Sliders
  document.getElementById('slider-feed').addEventListener('input', e => {
    f = parseFloat(e.target.value);
    document.getElementById('val-feed').textContent = f.toFixed(4);
    clearActivePreset();
  });
  document.getElementById('slider-kill').addEventListener('input', e => {
    k = parseFloat(e.target.value);
    document.getElementById('val-kill').textContent = k.toFixed(4);
    clearActivePreset();
  });
  document.getElementById('slider-dv').addEventListener('input', e => {
    Dv = parseFloat(e.target.value);
    document.getElementById('val-dv').textContent = Dv.toFixed(3);
    clearActivePreset();
  });

  // Buttons
  document.getElementById('btn-reset').addEventListener('click', () => {
    resetGrid();
    setStatus('substrate cleared — seeding fresh life...');
  });
  document.getElementById('btn-save').addEventListener('click', saveOrganism);
  document.getElementById('btn-share').addEventListener('click', share);

  resetGrid();
  loop();
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  W = Math.floor(canvas.width / CELL_SIZE);
  H = Math.floor(canvas.height / CELL_SIZE);
  imageData = ctx.createImageData(W, H);
  pixels = imageData.data;
}

function resetGrid() {
  const N = W * H;
  uCurr = new Float32Array(N).fill(1.0);
  vCurr = new Float32Array(N).fill(0.0);
  uNext = new Float32Array(N);
  vNext = new Float32Array(N);

  // Scatter seed patches across the canvas (center-biased)
  const numSeeds = 12 + Math.floor(Math.random() * 8);
  for (let s = 0; s < numSeeds; s++) {
    const cx = Math.floor(W * 0.2 + Math.random() * W * 0.6);
    const cy = Math.floor(H * 0.2 + Math.random() * H * 0.6);
    placeSeed(cx, cy, 3);
  }

  setStatus('life is forming in the dark...');
  frameCount = 0;
}

function placeSeed(cx, cy, radius) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      if (gx >= 0 && gx < W && gy >= 0 && gy < H) {
        const i = gy * W + gx;
        vCurr[i] = 1.0;
        uCurr[i] = 0.0;
      }
    }
  }
}

function seed(screenX, screenY) {
  const gx = Math.floor(screenX / CELL_SIZE);
  const gy = Math.floor(screenY / CELL_SIZE);
  placeSeed(gx, gy, 5);
  setStatus('chemical introduced — watching pattern propagate...');
}

// Laplacian with 9-point stencil (wrapped edges)
function step() {
  const STEPS_PER_FRAME = 9;
  for (let s = 0; s < STEPS_PER_FRAME; s++) {
    simulateStep();
    // Swap buffers
    let tmp = uCurr; uCurr = uNext; uNext = tmp;
    tmp = vCurr; vCurr = vNext; vNext = tmp;
  }
}

function simulateStep() {
  for (let y = 0; y < H; y++) {
    const yU = y === 0 ? H - 1 : y - 1;
    const yD = y === H - 1 ? 0 : y + 1;

    for (let x = 0; x < W; x++) {
      const xL = x === 0 ? W - 1 : x - 1;
      const xR = x === W - 1 ? 0 : x + 1;

      const i   = y  * W + x;
      const iU  = yU * W + x;
      const iD  = yD * W + x;
      const iL  = y  * W + xL;
      const iR  = y  * W + xR;
      const iUL = yU * W + xL;
      const iUR = yU * W + xR;
      const iDL = yD * W + xL;
      const iDR = yD * W + xR;

      const u = uCurr[i];
      const v = vCurr[i];

      // 9-point Laplacian
      const lapU = -u
        + 0.2 * (uCurr[iU] + uCurr[iD] + uCurr[iL] + uCurr[iR])
        + 0.05 * (uCurr[iUL] + uCurr[iUR] + uCurr[iDL] + uCurr[iDR]);

      const lapV = -v
        + 0.2 * (vCurr[iU] + vCurr[iD] + vCurr[iL] + vCurr[iR])
        + 0.05 * (vCurr[iUL] + vCurr[iUR] + vCurr[iDL] + vCurr[iDR]);

      const uvv = u * v * v;
      const du = Du * lapU - uvv + f * (1.0 - u);
      const dv = Dv * lapV + uvv - (f + k) * v;

      let nu = u + du;
      let nv = v + dv;

      if (nu < 0) nu = 0; else if (nu > 1) nu = 1;
      if (nv < 0) nv = 0; else if (nv > 1) nv = 1;

      uNext[i] = nu;
      vNext[i] = nv;
    }
  }
}

// Bioluminescent color mapping
// V = 0   → near-black deep blue (#010812)
// V = 0.3 → dim teal
// V = 0.6 → bright cyan
// V = 1.0 → near-white phosphorescent white
function colorV(v) {
  if (v < 0.05) {
    // Deep void
    const t = v / 0.05;
    return [
      Math.round(1 + t * 3),
      Math.round(8 + t * 12),
      Math.round(18 + t * 30)
    ];
  } else if (v < 0.3) {
    const t = (v - 0.05) / 0.25;
    return [
      Math.round(4   + t * 0),
      Math.round(20  + t * 100),
      Math.round(48  + t * 112)
    ];
  } else if (v < 0.65) {
    const t = (v - 0.3) / 0.35;
    return [
      Math.round(4   + t * 0),
      Math.round(120 + t * 100),
      Math.round(160 + t * 60)
    ];
  } else if (v < 0.85) {
    const t = (v - 0.65) / 0.2;
    return [
      Math.round(0   + t * 80),
      Math.round(220 + t * 35),
      Math.round(220 + t * 35)
    ];
  } else {
    const t = (v - 0.85) / 0.15;
    return [
      Math.round(80  + t * 175),
      Math.round(255),
      Math.round(255)
    ];
  }
}

function render() {
  const data = pixels;
  for (let i = 0; i < W * H; i++) {
    const v = vCurr[i];
    const [r, g, b] = colorV(v);
    const p = i * 4;
    data[p]     = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  }
  // Draw the grid-resolution image then scale up to fill canvas
  ctx.putImageData(imageData, 0, 0);
  if (CELL_SIZE > 1) {
    ctx.drawImage(canvas, 0, 0, W, H, 0, 0, canvas.width, canvas.height);
  }
}

function loop() {
  step();
  render();
  frameCount++;

  if (frameCount === 60) setStatus('patterns emerging from reaction-diffusion dynamics');
  if (frameCount === 300) setStatus('click anywhere to introduce a new chemical seed');
  if (frameCount === 700) setStatus('try a different preset — each has its own organism');

  animId = requestAnimationFrame(loop);
}

function setStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

function clearActivePreset() {
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
}

function saveOrganism() {
  // Render full-resolution to a temp canvas
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tempCtx = tempCanvas.getContext('2d');

  // Draw current simulation state at full resolution
  const fullImg = ctx.createImageData(W, H);
  const d = fullImg.data;
  for (let i = 0; i < W * H; i++) {
    const v = vCurr[i];
    const [r, g, b] = colorV(v);
    const p = i * 4;
    d[p] = r; d[p+1] = g; d[p+2] = b; d[p+3] = 255;
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = W;
  offscreen.height = H;
  const offCtx = offscreen.getContext('2d');
  offCtx.putImageData(fullImg, 0, 0);

  tempCtx.imageSmoothingEnabled = false;
  tempCtx.drawImage(offscreen, 0, 0, W, H, 0, 0, tempCanvas.width, tempCanvas.height);

  const url = tempCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'organism-' + Date.now() + '.png';
  a.click();
  setStatus('organism captured — check your downloads');
}

function share() {
  if (navigator.share) {
    navigator.share({ title: document.title, url: location.href });
  } else {
    navigator.clipboard.writeText(location.href)
      .then(() => {
        setStatus('link copied to clipboard — send it to someone who needs this');
      })
      .catch(() => {
        setStatus('copy this link: ' + location.href);
      });
  }
}

window.addEventListener('DOMContentLoaded', init);
