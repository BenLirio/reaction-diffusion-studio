// Gray-Scott Reaction Diffusion Simulator
// Bioluminescent deep-sea aesthetic

const CELL_SIZE = 3; // pixels per cell (larger = faster, slightly chunkier)
const MAX_GRID_CELLS = 90000; // hard cap on W*H to keep mobile/laptops smooth

const PRESETS = {
  spots:        { f: 0.035,  k: 0.065, caption: 'SPOTS: classic Turing dots — chemicals settle into separated cells' },
  coral:        { f: 0.0545, k: 0.062, caption: 'CORAL: branching growth that fills space like reef structures' },
  fingerprints: { f: 0.037,  k: 0.060, caption: 'PRINTS: parallel ridges and whorls — like skin patterns or zebra stripes' },
  maze:         { f: 0.029,  k: 0.057, caption: 'MAZE: labyrinthine corridors that wander and connect' },
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
let lastPointerX = 0, lastPointerY = 0;
let animId;
let frameCount = 0;

function init() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d', { willReadFrequently: false });

  resize();
  window.addEventListener('resize', () => { resize(); resetGrid(); });

  // Pointer events for seeding. Track the last pointer position so the loop can
  // keep seeding at that spot even when the user holds the button without moving
  // the cursor (fixes: "cube only places when mouse is moving").
  canvas.addEventListener('mousedown', e => {
    isPointerDown = true;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    seed(e.clientX, e.clientY);
  });
  canvas.addEventListener('mousemove', e => {
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    if (isPointerDown) seed(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', () => { isPointerDown = false; });

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    isPointerDown = true;
    lastPointerX = e.touches[0].clientX;
    lastPointerY = e.touches[0].clientY;
    seed(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    lastPointerX = e.touches[0].clientX;
    lastPointerY = e.touches[0].clientY;
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
      setCaption(p.caption);
      setStatus('preset loaded — watch it evolve...');
    });
  });

  // Sliders
  document.getElementById('slider-feed').addEventListener('input', e => {
    f = parseFloat(e.target.value);
    document.getElementById('val-feed').textContent = f.toFixed(4);
    clearActivePreset();
    setCaption('FEED ' + f.toFixed(4) + ' — speed at which new chemical is added (higher = more growth)');
  });
  document.getElementById('slider-kill').addEventListener('input', e => {
    k = parseFloat(e.target.value);
    document.getElementById('val-kill').textContent = k.toFixed(4);
    clearActivePreset();
    setCaption('KILL ' + k.toFixed(4) + ' — speed at which chemical decays (higher = sparser patterns)');
  });
  document.getElementById('slider-dv').addEventListener('input', e => {
    Dv = parseFloat(e.target.value);
    document.getElementById('val-dv').textContent = Dv.toFixed(3);
    clearActivePreset();
    setCaption('DIFF ' + Dv.toFixed(3) + ' — how far chemical spreads each step (higher = blurrier shapes)');
  });

  // Buttons
  document.getElementById('btn-reset').addEventListener('click', () => {
    resetGrid();
    setStatus('substrate cleared — seeding fresh life...');
  });
  document.getElementById('btn-save').addEventListener('click', saveOrganism);
  document.getElementById('btn-share').addEventListener('click', share);

  // Guide
  initGuide();

  resetGrid();
  loop();

  // Auto-open guide on first visit
  try {
    if (!localStorage.getItem('rds_guide_seen')) {
      openGuide();
    }
  } catch (_) { /* private mode — just skip auto-open */ }
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  // Start at the configured cell size, then bump up if the grid would exceed our cap
  let cellSize = CELL_SIZE;
  let cells = Math.floor(canvas.width / cellSize) * Math.floor(canvas.height / cellSize);
  while (cells > MAX_GRID_CELLS) {
    cellSize += 1;
    cells = Math.floor(canvas.width / cellSize) * Math.floor(canvas.height / cellSize);
  }
  W = Math.floor(canvas.width / cellSize);
  H = Math.floor(canvas.height / cellSize);
  // Resize the canvas backing store to match the simulation grid; CSS scales it
  // up to fill the viewport. This avoids the per-frame drawImage upscale.
  canvas.width = W;
  canvas.height = H;
  ctx.imageSmoothingEnabled = false;
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
  // Canvas backing store is W x H but CSS scales it to fill the viewport.
  // Map screen coords through the canvas's rendered size to grid coords.
  const rect = canvas.getBoundingClientRect();
  const gx = Math.floor((screenX - rect.left) / rect.width * W);
  const gy = Math.floor((screenY - rect.top) / rect.height * H);
  placeSeed(gx, gy, 5);
  setStatus('chemical introduced — watching pattern propagate...');
}

// Laplacian with 9-point stencil (wrapped edges)
function step() {
  const STEPS_PER_FRAME = 6;
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
  // Canvas backing store == grid size; CSS scales it to viewport. Single putImageData call.
  ctx.putImageData(imageData, 0, 0);
}

function loop() {
  // If the pointer is held down, keep seeding at the last known position each
  // frame — even if the cursor isn't moving. Without this, seeding only
  // happens on mousemove, which feels broken when the user holds still.
  if (isPointerDown) {
    seed(lastPointerX, lastPointerY);
  }

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

function setCaption(msg) {
  const el = document.getElementById('caption-text');
  if (el) el.textContent = msg;
}

function clearActivePreset() {
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
}

function saveOrganism() {
  // Scale the simulation grid up by 4x for a sharper downloadable PNG
  const SCALE = 4;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = W * SCALE;
  tempCanvas.height = H * SCALE;
  const tempCtx = tempCanvas.getContext('2d');

  const offscreen = document.createElement('canvas');
  offscreen.width = W;
  offscreen.height = H;
  const offCtx = offscreen.getContext('2d');

  const fullImg = offCtx.createImageData(W, H);
  const d = fullImg.data;
  for (let i = 0; i < W * H; i++) {
    const v = vCurr[i];
    const [r, g, b] = colorV(v);
    const p = i * 4;
    d[p] = r; d[p+1] = g; d[p+2] = b; d[p+3] = 255;
  }
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

// --- Guided tour -----------------------------------------------------------
// Walks a new user through what reaction-diffusion is and what each slider /
// preset actually does. Each step mutates the live simulation (preset +
// slider values) so the running canvas behind the modal *is* the example.

const GUIDE_STEPS = [
  {
    title: 'What is reaction-diffusion?',
    body:
      'Two invisible chemicals — <em>U</em> (food) and <em>V</em> (reactant) — sit on a grid. ' +
      'V consumes U to make more V, then slowly dies off. Because V also <strong>diffuses</strong> ' +
      '(spreads to neighbors), clusters of V compete for U at their edges. That competition ' +
      'carves patterns out of a uniform soup — the same math nature uses to make zebra stripes, ' +
      'leopard spots, and seashell whorls.',
    apply: () => { applyPresetByName('spots'); setSlider('slider-dv', 0.105); Dv = 0.105; document.getElementById('val-dv').textContent = '0.105'; resetGrid(); }
  },
  {
    title: 'Meet FEED — the food rate',
    body:
      '<strong>FEED</strong> is how fast fresh U (food) is added to every cell. More food lets ' +
      'V keep growing instead of starving out. <em>Low FEED</em> → patterns thin out and die. ' +
      '<em>High FEED</em> → V explodes outward, covering everything. Watch the canvas: we just ' +
      'cranked FEED higher than the spots preset, so you\'ll see more aggressive growth.',
    apply: () => { setSlider('slider-feed', 0.06); f = 0.06; document.getElementById('val-feed').textContent = '0.0600'; clearActivePreset(); resetGrid(); }
  },
  {
    title: 'Meet KILL — the decay rate',
    body:
      '<strong>KILL</strong> is how fast V is removed. It\'s the enemy of FEED. ' +
      '<em>Low KILL</em> → V lingers and fills space. <em>High KILL</em> → V dies before it can ' +
      'spread, leaving sparse isolated dots. The magic lives in the balance between FEED and ' +
      'KILL — tiny shifts in either one flip the pattern to a whole new regime.',
    apply: () => { setSlider('slider-feed', 0.037); f = 0.037; document.getElementById('val-feed').textContent = '0.0370'; setSlider('slider-kill', 0.072); k = 0.072; document.getElementById('val-kill').textContent = '0.0720'; clearActivePreset(); resetGrid(); }
  },
  {
    title: 'Meet DIFF — how far V spreads',
    body:
      '<strong>DIFF</strong> controls how quickly V leaks into neighboring cells each step. ' +
      '<em>Low DIFF</em> → sharp, crisp, pixel-scale patterns. <em>High DIFF</em> → blurry, ' +
      'connected blobs that merge into each other. We just bumped it up — notice how the edges ' +
      'get soft and the shapes want to link up.',
    apply: () => { setSlider('slider-dv', 0.17); Dv = 0.17; document.getElementById('val-dv').textContent = '0.170'; clearActivePreset(); resetGrid(); }
  },
  {
    title: 'Preset: SPOTS',
    body:
      'Classic Turing dots. FEED and KILL are tuned so V clusters can form but never overrun ' +
      'each other — every dot fights its neighbors for food, and they settle into a stable, ' +
      'roughly-even spacing. This is the pattern on most spotted animals.',
    apply: () => applyPresetByName('spots')
  },
  {
    title: 'Preset: CORAL & MAZE',
    body:
      '<strong>CORAL</strong>: slightly more food, slightly less kill. V can\'t form discrete ' +
      'dots anymore — it grows outward in branching fingers. <strong>MAZE</strong>: further ' +
      'down the dial — V forms connected corridors that wander and link into labyrinths. ' +
      'Same equations, different balance.',
    apply: () => applyPresetByName('coral'),
    subAction: () => setTimeout(() => { applyPresetByName('maze'); }, 3500)
  },
  {
    title: 'You\'re ready — the canvas is yours',
    body:
      '<strong>Click or drag</strong> to seed fresh V anywhere. Move the sliders to find ' +
      'patterns nobody has named yet — the interesting zones are right on the edges between ' +
      'presets. Hit <strong>SAVE ORGANISM</strong> when you find one you like. The ? button ' +
      'up top reopens this guide anytime.',
    apply: () => applyPresetByName('fingerprints')
  }
];

let guideIdx = 0;

function initGuide() {
  document.getElementById('btn-guide').addEventListener('click', openGuide);
  document.getElementById('guide-close').addEventListener('click', closeGuide);
  document.getElementById('guide-prev').addEventListener('click', () => goStep(guideIdx - 1));
  document.getElementById('guide-next').addEventListener('click', () => goStep(guideIdx + 1));
  document.getElementById('guide-finish').addEventListener('click', closeGuide);
}

function openGuide() {
  guideIdx = 0;
  document.getElementById('guide-overlay').classList.remove('hidden');
  renderStep();
}

function closeGuide() {
  document.getElementById('guide-overlay').classList.add('hidden');
  try { localStorage.setItem('rds_guide_seen', '1'); } catch (_) {}
  setStatus('sandbox is yours — click anywhere to seed, drag the sliders');
}

function goStep(n) {
  if (n < 0 || n >= GUIDE_STEPS.length) return;
  guideIdx = n;
  renderStep();
}

function renderStep() {
  const step = GUIDE_STEPS[guideIdx];
  document.getElementById('guide-step-label').textContent =
    'STEP ' + (guideIdx + 1) + ' / ' + GUIDE_STEPS.length;
  document.getElementById('guide-title').textContent = step.title;
  document.getElementById('guide-body').innerHTML = step.body;

  document.getElementById('guide-prev').disabled = guideIdx === 0;
  const isLast = guideIdx === GUIDE_STEPS.length - 1;
  document.getElementById('guide-next').classList.toggle('hidden', isLast);
  document.getElementById('guide-finish').classList.toggle('hidden', !isLast);

  if (typeof step.apply === 'function') {
    try { step.apply(); } catch (e) { /* ignore */ }
  }
  if (typeof step.subAction === 'function') {
    try { step.subAction(); } catch (e) { /* ignore */ }
  }
}

function applyPresetByName(name) {
  const p = PRESETS[name];
  if (!p) return;
  f = p.f;
  k = p.k;
  setSlider('slider-feed', f);
  setSlider('slider-kill', k);
  document.getElementById('val-feed').textContent = f.toFixed(4);
  document.getElementById('val-kill').textContent = k.toFixed(4);
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.preset === name);
  });
  setCaption(p.caption);
  resetGrid();
}

function setSlider(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

window.addEventListener('DOMContentLoaded', init);
