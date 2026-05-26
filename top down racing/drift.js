// 240SX — A Drift Study (Circuit Edition)
// Top-down closed circuit, Micro Machines style. Drift physics + lap timing.

(function () {
  'use strict';

  // ─── DOM refs ────────────────────────────────────────────────────────────
  const canvas    = document.getElementById('world');
  const ctx       = canvas.getContext('2d');
  const splash    = document.getElementById('splash');
  const chrome    = document.getElementById('chrome');
  const elSpeed   = document.getElementById('hud-speed');
  const elAngle   = document.getElementById('hud-angle');
  const elLapTime = document.getElementById('hud-laptime');
  const elLapLbl  = document.getElementById('hud-laplabel');
  const elBest    = document.getElementById('hud-best');
  const elLast    = document.getElementById('hud-last');
  const elCombo   = document.getElementById('hud-combo');
  const elDriftB  = document.getElementById('hud-drift-block');
  const elCap     = document.getElementById('caption');
  const elTick    = document.getElementById('compass-tick');
  const elCircuit = document.getElementById('hud-circuit');

  // ─── viewport ────────────────────────────────────────────────────────────
  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width  = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ─── road tile (warm-black asphalt with speckle) ─────────────────────────
  const roadTile = document.createElement('canvas');
  roadTile.width = roadTile.height = 256;
  (function buildTile() {
    const rtx = roadTile.getContext('2d');
    rtx.fillStyle = '#0b0b0d';
    rtx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 480; i++) {
      rtx.fillStyle = 'rgba(255,255,255,' + Math.random() * 0.04 + ')';
      rtx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
    for (let i = 0; i < 90; i++) {
      rtx.fillStyle = 'rgba(255, 200, 150,' + Math.random() * 0.035 + ')';
      rtx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
    for (let i = 0; i < 30; i++) {
      const s = 2 + Math.random() * 3;
      rtx.fillStyle = 'rgba(180, 195, 220,' + Math.random() * 0.015 + ')';
      rtx.fillRect(Math.random() * 256, Math.random() * 256, s, s);
    }
  })();
  const roadPattern = ctx.createPattern(roadTile, 'repeat');

  // off-track grass/dirt tile (deep moss + scatter)
  const grassTile = document.createElement('canvas');
  grassTile.width = grassTile.height = 256;
  (function buildGrass() {
    const g = grassTile.getContext('2d');
    g.fillStyle = '#11140e';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = 'rgba(40, 60, 30,' + Math.random() * 0.5 + ')';
      g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
    for (let i = 0; i < 220; i++) {
      g.fillStyle = 'rgba(120, 130, 80,' + Math.random() * 0.08 + ')';
      g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
    // little leafy clumps
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * 0.18;
      g.fillStyle = 'rgba(70, 90, 50,' + a + ')';
      g.beginPath();
      g.arc(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 6, 0, Math.PI * 2);
      g.fill();
    }
  })();
  const grassPattern = ctx.createPattern(grassTile, 'repeat');

  // ─── TRACK ───────────────────────────────────────────────────────────────
  // Closed Catmull-Rom spline through control points → dense sample array.
  const CTRL = [
    [   0, -520],
    [ 460, -540],
    [ 740, -320],
    [ 600,  -60],
    [ 840,  180],
    [ 720,  500],
    [ 320,  640],
    [ -80,  560],
    [-340,  720],
    [-660,  500],
    [-740,  120],
    [-500, -100],
    [-720, -360],
    [-380, -500],
  ];
  const TRACK_WIDTH = 110;        // drivable width
  const TRACK_HALF  = TRACK_WIDTH / 2;
  const CURB_W      = 12;         // curb stripe thickness

  // Catmull-Rom (closed)
  function catmullClosed(points, samplesPerSegment) {
    const n = points.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      for (let s = 0; s < samplesPerSegment; s++) {
        const t = s / samplesPerSegment;
        const t2 = t * t, t3 = t2 * t;
        const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
                         (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                         (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
                         (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                         (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        out.push([x, y]);
      }
    }
    return out;
  }
  const SAMPLES = catmullClosed(CTRL, 36); // dense centerline
  const N = SAMPLES.length;

  // arc-length parameterization
  const ARC = new Float32Array(N);
  let trackLength = 0;
  for (let i = 0; i < N; i++) {
    const a = SAMPLES[i];
    const b = SAMPLES[(i + 1) % N];
    ARC[i] = trackLength;
    trackLength += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  // tangents + normals at each sample (right-handed normal)
  const TAN = new Float32Array(N * 2);
  const NRM = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const a = SAMPLES[(i - 1 + N) % N];
    const b = SAMPLES[(i + 1) % N];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    TAN[i * 2] = tx; TAN[i * 2 + 1] = ty;
    NRM[i * 2] = -ty; NRM[i * 2 + 1] = tx;
  }

  // Pre-build Path2D for the centerline (used to stroke road + curbs)
  const trackPath = new Path2D();
  trackPath.moveTo(SAMPLES[0][0], SAMPLES[0][1]);
  for (let i = 1; i < N; i++) trackPath.lineTo(SAMPLES[i][0], SAMPLES[i][1]);
  trackPath.closePath();

  // Bounding box (for the off-track fill bounds — not strictly needed since we fill viewport)
  // …skipped intentionally.

  // ─── closest-sample query (spatial grid) ─────────────────────────────────
  // Build a coarse 2D grid bucketing sample indices for O(1)-ish nearest lookup.
  const GRID = 64;
  let GMIN_X = Infinity, GMIN_Y = Infinity, GMAX_X = -Infinity, GMAX_Y = -Infinity;
  for (let i = 0; i < N; i++) {
    const s = SAMPLES[i];
    if (s[0] < GMIN_X) GMIN_X = s[0];
    if (s[1] < GMIN_Y) GMIN_Y = s[1];
    if (s[0] > GMAX_X) GMAX_X = s[0];
    if (s[1] > GMAX_Y) GMAX_Y = s[1];
  }
  GMIN_X -= 200; GMIN_Y -= 200; GMAX_X += 200; GMAX_Y += 200;
  const GCOLS = Math.ceil((GMAX_X - GMIN_X) / GRID);
  const GROWS = Math.ceil((GMAX_Y - GMIN_Y) / GRID);
  const buckets = new Array(GCOLS * GROWS);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];
  for (let i = 0; i < N; i++) {
    const s = SAMPLES[i];
    const cx = Math.floor((s[0] - GMIN_X) / GRID);
    const cy = Math.floor((s[1] - GMIN_Y) / GRID);
    // stamp into 3x3 neighborhood so any query within ~GRID returns this sample
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx, gy = cy + dy;
        if (gx >= 0 && gx < GCOLS && gy >= 0 && gy < GROWS) {
          buckets[gy * GCOLS + gx].push(i);
        }
      }
    }
  }
  function nearestSample(x, y) {
    const cx = Math.floor((x - GMIN_X) / GRID);
    const cy = Math.floor((y - GMIN_Y) / GRID);
    if (cx < 0 || cx >= GCOLS || cy < 0 || cy >= GROWS) {
      // fall back to brute force (shouldn't happen often)
      let bd = Infinity, bi = 0;
      for (let i = 0; i < N; i++) {
        const dx = SAMPLES[i][0] - x, dy = SAMPLES[i][1] - y;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = i; }
      }
      return { i: bi, d: Math.sqrt(bd) };
    }
    const bucket = buckets[cy * GCOLS + cx];
    let bd = Infinity, bi = 0;
    for (let k = 0; k < bucket.length; k++) {
      const i = bucket[k];
      const dx = SAMPLES[i][0] - x, dy = SAMPLES[i][1] - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
    return { i: bi, d: Math.sqrt(bd) };
  }

  // ─── checkpoints + start/finish ──────────────────────────────────────────
  // Start/finish at sample 0. Checkpoints at 25%, 50%, 75%.
  const NUM_CP = 4; // 0=finish, 1=q1, 2=q2, 3=q3
  const CP_INDEX = [];
  for (let k = 0; k < NUM_CP; k++) {
    CP_INDEX.push(Math.floor((k / NUM_CP) * N));
  }
  function checkpointSegment(idx) {
    const s = SAMPLES[idx];
    const nx = NRM[idx * 2], ny = NRM[idx * 2 + 1];
    const half = TRACK_HALF + 4;
    return {
      ax: s[0] - nx * half, ay: s[1] - ny * half,
      bx: s[0] + nx * half, by: s[1] + ny * half,
      tx: TAN[idx * 2],     ty: TAN[idx * 2 + 1],
    };
  }
  const CP_SEGS = CP_INDEX.map(checkpointSegment);

  function segSegCross(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
    // returns t for segment 1→2 if they intersect, otherwise -1
    const s1x = p2x - p1x, s1y = p2y - p1y;
    const s2x = p4x - p3x, s2y = p4y - p3y;
    const denom = (-s2x * s1y + s1x * s2y);
    if (Math.abs(denom) < 1e-6) return -1;
    const s = (-s1y * (p1x - p3x) + s1x * (p1y - p3y)) / denom;
    const t = ( s2x * (p1y - p3y) - s2y * (p1x - p3x)) / denom;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) return t;
    return -1;
  }

  // ─── state ───────────────────────────────────────────────────────────────
  const startSample = SAMPLES[0];
  const startTan = [TAN[0], TAN[1]];
  const car = {
    x: startSample[0] - NRM[0] * 18, // slight offset off-line
    y: startSample[1] - NRM[1] * 18,
    heading: Math.atan2(startTan[1], startTan[0]),
    vx: 0, vy: 0,
    steerVis: 0,
    prevX: 0, prevY: 0,
  };
  car.prevX = car.x; car.prevY = car.y;

  const smoke = [];
  const skids = [];

  // lap state
  let lapStartT = 0;
  let lapTime = 0;
  let lapNum = 0;             // increments on first valid finish line cross
  let nextCP = 1;             // checkpoint index expected next (after start, go to 1, 2, 3, then finish)
  let lastLap = null;
  let bestLap = parseFloat(localStorage.getItem('s240sx_bestlap') || 'NaN');
  let started = false;
  let raceStarted = false;    // becomes true the first time you cross the start line going forward
  let lastDriftAt = -10;
  let combo = 1;
  let comboTimer = 0;

  if (!isNaN(bestLap)) elBest.textContent = fmtTime(bestLap);

  function fmtTime(s) {
    if (s == null || isNaN(s)) return '—:—';
    const m = Math.floor(s / 60);
    const rest = s - m * 60;
    const ss = Math.floor(rest);
    const cs = Math.floor((rest - ss) * 100);
    return m + ':' + String(ss).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
  }

  function showCaption(text, ms) {
    elCap.textContent = text;
    elCap.classList.add('show');
    clearTimeout(showCaption._t);
    showCaption._t = setTimeout(function () {
      elCap.classList.remove('show');
    }, ms);
  }

  // circuit length display
  (function () {
    const km = (trackLength / 3600).toFixed(2); // arbitrary scale that reads ~1.4km
    elCircuit.textContent = 'Tochigi Circuit · ' + km + ' km · No. 01';
  })();

  // ─── input ───────────────────────────────────────────────────────────────
  const keys = Object.create(null);
  function start() {
    if (started) return;
    started = true;
    splash.classList.add('gone');
    chrome.classList.add('live');
    showCaption('— cross the line to start —', 2200);
  }
  function resetCar() {
    car.x = startSample[0] - NRM[0] * 18;
    car.y = startSample[1] - NRM[1] * 18;
    car.prevX = car.x; car.prevY = car.y;
    car.heading = Math.atan2(startTan[1], startTan[0]);
    car.vx = 0; car.vy = 0;
    car.steerVis = 0;
    smoke.length = 0;
    skids.length = 0;
    lapTime = 0;
    lapNum = 0;
    nextCP = 1;
    raceStarted = false;
    combo = 1; comboTimer = 0;
    showCaption('— reset —', 900);
  }
  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    keys[e.code] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].indexOf(e.code) >= 0) e.preventDefault();
    if (!started) start();
    if (e.code === 'KeyR') resetCar();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  splash.addEventListener('click', start);

  // ─── virtual joystick (touch) ────────────────────────────────────────────
  const touch = { left: false, right: false, throttle: false, brake: false };
  const jstick = { active: false, id: null, startX: 0, startY: 0, currX: 0, currY: 0 };
  let touchHandbrake = false;
  const J_STEER_DEAD = 18;  // px horizontal dead zone
  const J_BRAKE_DEAD = 28;  // px downward drag before braking kicks in

  function syncJoystick() {
    if (!jstick.active) {
      touch.left = touch.right = touch.throttle = touch.brake = false;
      return;
    }
    const dx = jstick.currX - jstick.startX;
    const dy = jstick.currY - jstick.startY;
    touch.left     = dx < -J_STEER_DEAD;
    touch.right    = dx >  J_STEER_DEAD;
    touch.brake    = dy >  J_BRAKE_DEAD;
    touch.throttle = !touch.brake;
  }

  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (!started) start();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (!jstick.active) {
        jstick.active = true; jstick.id = t.identifier;
        jstick.startX = jstick.currX = t.clientX;
        jstick.startY = jstick.currY = t.clientY;
      }
    }
    touchHandbrake = jstick.active && e.touches.length >= 2;
    syncJoystick();
  }, { passive: false });

  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === jstick.id) { jstick.currX = t.clientX; jstick.currY = t.clientY; }
    }
    syncJoystick();
  }, { passive: false });

  canvas.addEventListener('touchend', function (e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === jstick.id) { jstick.active = false; jstick.id = null; }
    }
    touchHandbrake = jstick.active && e.touches.length >= 2;
    syncJoystick();
  }, { passive: false });

  canvas.addEventListener('touchcancel', function (e) {
    e.preventDefault();
    jstick.active = false; jstick.id = null; touchHandbrake = false;
    syncJoystick();
  }, { passive: false });

  // ─── helpers ─────────────────────────────────────────────────────────────
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y,     x + w, y + h, r);
    c.arcTo(x + w, y + h, x,     y + h, r);
    c.arcTo(x,     y + h, x,     y,     r);
    c.arcTo(x,     y,     x + w, y,     r);
    c.closePath();
  }

  // ─── pre-render track to an offscreen canvas ────────────────────────────
  // (drawing 500+ samples + curbs every frame is wasteful; bake once.)
  const trackBmp = document.createElement('canvas');
  const PAD = 200;
  const tW = Math.ceil(GMAX_X - GMIN_X);
  const tH = Math.ceil(GMAX_Y - GMIN_Y);
  trackBmp.width  = tW;
  trackBmp.height = tH;
  const tctx = trackBmp.getContext('2d');
  (function bakeTrack() {
    // shift origin so world (GMIN_X, GMIN_Y) maps to (0,0)
    tctx.translate(-GMIN_X, -GMIN_Y);

    // grass background (we don't fill the whole bitmap — main loop will tile grass too,
    // but baking it here gives nice edge transitions around the track shoulder)
    tctx.fillStyle = grassPattern;
    tctx.fillRect(GMIN_X, GMIN_Y, tW, tH);

    // soft shadow under track for depth
    tctx.save();
    tctx.shadowColor = 'rgba(0,0,0,0.55)';
    tctx.shadowBlur = 22;
    tctx.shadowOffsetY = 6;
    tctx.lineWidth = TRACK_WIDTH;
    tctx.lineCap = 'round';
    tctx.lineJoin = 'round';
    tctx.strokeStyle = 'rgba(0,0,0,0)';
    tctx.stroke(trackPath);
    tctx.restore();

    // shoulder (slightly lighter dirt around track edge)
    tctx.lineWidth = TRACK_WIDTH + 22;
    tctx.lineCap = 'round';
    tctx.lineJoin = 'round';
    tctx.strokeStyle = '#1a1d14';
    tctx.stroke(trackPath);

    // asphalt
    tctx.lineWidth = TRACK_WIDTH;
    tctx.strokeStyle = roadPattern;
    tctx.stroke(trackPath);

    // inner asphalt darkening at edges (vignette feel)
    tctx.lineWidth = TRACK_WIDTH - 6;
    tctx.strokeStyle = 'rgba(255,255,255,0.012)';
    tctx.stroke(trackPath);

    // ── curbs: alternating ember/cream stripes on both edges ──
    // build short quads along the normals
    const stripeLen = 22;
    let acc = 0;
    let toggle = 0;
    for (let i = 0; i < N; i++) {
      const a = SAMPLES[i];
      const b = SAMPLES[(i + 1) % N];
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      acc += segLen;
      if (acc >= stripeLen) {
        acc = 0;
        toggle = 1 - toggle;
      }
      // detect curvature — only paint curbs where the track curves enough
      const i0 = (i - 6 + N) % N, i2 = (i + 6) % N;
      const t1x = TAN[i0 * 2],     t1y = TAN[i0 * 2 + 1];
      const t2x = TAN[i2 * 2],     t2y = TAN[i2 * 2 + 1];
      const curv = 1 - (t1x * t2x + t1y * t2y); // 0..2
      if (curv < 0.04) continue;

      const nx = NRM[i * 2], ny = NRM[i * 2 + 1];
      const col = toggle ? '#e6896b' : '#efe6d4';
      const half = TRACK_HALF;
      // outer curb (side of normal)
      tctx.fillStyle = col;
      tctx.beginPath();
      tctx.moveTo(a[0] + nx * half,           a[1] + ny * half);
      tctx.lineTo(a[0] + nx * (half + CURB_W),a[1] + ny * (half + CURB_W));
      tctx.lineTo(b[0] + nx * (half + CURB_W),b[1] + ny * (half + CURB_W));
      tctx.lineTo(b[0] + nx * half,           b[1] + ny * half);
      tctx.closePath();
      tctx.fill();
      // inner curb (opposite normal)
      tctx.fillStyle = toggle ? '#efe6d4' : '#e6896b';
      tctx.beginPath();
      tctx.moveTo(a[0] - nx * half,            a[1] - ny * half);
      tctx.lineTo(a[0] - nx * (half + CURB_W), a[1] - ny * (half + CURB_W));
      tctx.lineTo(b[0] - nx * (half + CURB_W), b[1] - ny * (half + CURB_W));
      tctx.lineTo(b[0] - nx * half,            b[1] - ny * half);
      tctx.closePath();
      tctx.fill();
    }

    // center dashed line (faint)
    tctx.setLineDash([16, 22]);
    tctx.lineWidth = 1.2;
    tctx.strokeStyle = 'rgba(169, 138, 74, 0.18)';
    tctx.stroke(trackPath);
    tctx.setLineDash([]);

    // start/finish line — checkered band
    (function drawStartLine() {
      const s = SAMPLES[0];
      const nx = NRM[0], ny = NRM[1];
      const tx = TAN[0], ty = TAN[1];
      const half = TRACK_HALF;
      const bandW = 14;
      // base white slab
      tctx.save();
      tctx.translate(s[0], s[1]);
      tctx.rotate(Math.atan2(ty, tx));
      // checker
      const rows = 4, cols = Math.ceil((half * 2) / (bandW / 2));
      const cellW = bandW / rows;
      const cellH = (half * 2) / cols;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          tctx.fillStyle = ((r + c) % 2) ? '#efe6d4' : '#16161a';
          tctx.fillRect(-bandW / 2 + r * cellW, -half + c * cellH, cellW, cellH);
        }
      }
      // "START" wordmark just past the line
      tctx.fillStyle = 'rgba(239,230,212,0.18)';
      tctx.font = '600 18px JetBrains Mono, monospace';
      tctx.textAlign = 'center';
      tctx.textBaseline = 'middle';
      tctx.fillText('START · FINISH', 36, 0);
      tctx.restore();
    })();
  })();

  // ─── car render ──────────────────────────────────────────────────────────
  function drawCar(c) {
    c.save();
    c.translate(car.x, car.y);
    c.rotate(car.heading);

    const L = 44, w = 19;

    c.save();
    c.globalAlpha = 0.55;
    c.fillStyle = '#000';
    c.beginPath();
    c.ellipse(0, 0, L * 0.6, w * 0.85, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    const drawWheel = function (wx, wy, steer) {
      c.save();
      c.translate(wx, wy);
      c.rotate(steer);
      c.fillStyle = '#0a0a0b';
      c.fillRect(-3.6, -2.4, 7.2, 4.8);
      c.fillStyle = '#c8c2b3';
      c.fillRect(-2.3, -1.6, 4.6, 3.2);
      c.fillStyle = '#1a1a1c';
      c.fillRect(-1.0, -0.7, 2.0, 1.4);
      c.restore();
    };
    drawWheel(-L * 0.32,  w / 2 + 0.5, 0);
    drawWheel(-L * 0.32, -w / 2 - 0.5, 0);
    drawWheel( L * 0.32,  w / 2 + 0.5, car.steerVis);
    drawWheel( L * 0.32, -w / 2 - 0.5, car.steerVis);

    c.fillStyle = '#0c0c0e';
    roundRect(c, -L / 2, -w / 2, L, w, 4);
    c.fill();
    c.strokeStyle = 'rgba(245, 230, 210, 0.16)';
    c.lineWidth = 0.8;
    c.stroke();

    const grad = c.createLinearGradient(0, -w / 2, 0, w / 2);
    grad.addColorStop(0,    'rgba(255, 240, 220, 0.10)');
    grad.addColorStop(0.5,  'rgba(255, 240, 220, 0.00)');
    grad.addColorStop(1,    'rgba(255, 240, 220, 0.04)');
    c.fillStyle = grad;
    roundRect(c, -L / 2 + 1, -w / 2 + 1, L - 2, w - 2, 3);
    c.fill();

    c.fillStyle = 'rgba(20, 22, 28, 0.85)';
    roundRect(c, -L * 0.28, -w / 2 + 2.4, L * 0.5, w - 4.8, 2.4);
    c.fill();
    c.strokeStyle = 'rgba(245, 230, 210, 0.08)';
    c.lineWidth = 0.5;
    c.stroke();

    c.fillStyle = 'rgba(20, 22, 28, 0.7)';
    roundRect(c, -L * 0.46, -w / 2 + 3, L * 0.16, w - 6, 1.6);
    c.fill();

    c.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    c.lineWidth = 0.5;
    c.beginPath();
    c.moveTo(L * 0.22, -w / 2 + 1.5);
    c.lineTo(L * 0.22,  w / 2 - 1.5);
    c.stroke();

    c.fillStyle = 'rgba(40, 36, 32, 0.9)';
    c.fillRect(L * 0.42, -w / 2 + 2.5, 2.4, 3.5);
    c.fillRect(L * 0.42,  w / 2 - 6.0, 2.4, 3.5);
    c.fillStyle = 'rgba(255, 220, 170, 0.5)';
    c.fillRect(L * 0.46, -w / 2 + 3.0, 1.0, 2.5);
    c.fillRect(L * 0.46,  w / 2 - 5.5, 1.0, 2.5);

    c.fillStyle = 'rgba(230, 80, 60, 0.85)';
    c.fillRect(-L / 2 + 0.6, -w / 2 + 2.5, 1.6, 3.0);
    c.fillRect(-L / 2 + 0.6,  w / 2 - 5.5, 1.6, 3.0);
    if ((keys.ArrowDown || keys.KeyS || touch.brake)) {
      c.fillStyle = 'rgba(255, 70, 50, 0.55)';
      c.beginPath();
      c.ellipse(-L / 2 - 4, 0, 14, w * 0.7, 0, 0, Math.PI * 2);
      c.fill();
    }

    const fwdSpeed = car.vx * Math.cos(car.heading) + car.vy * Math.sin(car.heading);
    if (Math.abs(fwdSpeed) > 5) {
      c.globalCompositeOperation = 'screen';
      const beam = c.createRadialGradient(L * 0.6, 0, 0, L * 0.6, 0, 90);
      beam.addColorStop(0,    'rgba(255, 220, 170, 0.22)');
      beam.addColorStop(0.6,  'rgba(255, 200, 150, 0.06)');
      beam.addColorStop(1,    'rgba(255, 200, 150, 0.00)');
      c.fillStyle = beam;
      c.beginPath();
      c.moveTo(L * 0.5, -w * 0.45);
      c.lineTo(L * 0.5 + 110, -w * 1.4);
      c.lineTo(L * 0.5 + 110,  w * 1.4);
      c.lineTo(L * 0.5,  w * 0.45);
      c.closePath();
      c.fill();
      c.globalCompositeOperation = 'source-over';
    }
    c.restore();
  }

  // ─── minimap ─────────────────────────────────────────────────────────────
  const miniBmp = document.createElement('canvas');
  miniBmp.width = 220; miniBmp.height = 160;
  (function bakeMini() {
    const m = miniBmp.getContext('2d');
    const pad = 12;
    const sx = (miniBmp.width  - pad * 2) / (GMAX_X - GMIN_X);
    const sy = (miniBmp.height - pad * 2) / (GMAX_Y - GMIN_Y);
    const sc = Math.min(sx, sy);
    const ox = (miniBmp.width  - (GMAX_X - GMIN_X) * sc) / 2;
    const oy = (miniBmp.height - (GMAX_Y - GMIN_Y) * sc) / 2;
    m.translate(ox - GMIN_X * sc, oy - GMIN_Y * sc);
    m.scale(sc, sc);
    m.lineWidth = TRACK_WIDTH;
    m.lineCap = 'round'; m.lineJoin = 'round';
    m.strokeStyle = 'rgba(239,230,212,0.10)';
    m.stroke(trackPath);
    m.lineWidth = TRACK_WIDTH - 22;
    m.strokeStyle = 'rgba(239,230,212,0.32)';
    m.stroke(trackPath);
    // store transform for plotting car
    miniBmp._sc = sc;
    miniBmp._ox = ox - GMIN_X * sc;
    miniBmp._oy = oy - GMIN_Y * sc;
  })();

  // ─── physics + frame loop ────────────────────────────────────────────────
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;

    // input
    const up    = keys.ArrowUp    || keys.KeyW || touch.throttle ? 1 : 0;
    const down  = keys.ArrowDown  || keys.KeyS || touch.brake    ? 1 : 0;
    const left  = keys.ArrowLeft  || keys.KeyA || touch.left     ? 1 : 0;
    const right = keys.ArrowRight || keys.KeyD || touch.right    ? 1 : 0;
    const handb = keys.Space || touchHandbrake ? 1 : 0;
    const steerInput = right - left;

    // velocity decomposition
    const fx = Math.cos(car.heading), fy = Math.sin(car.heading);
    const rx = -fy, ry = fx;
    let fSpeed = car.vx * fx + car.vy * fy;
    let rSpeed = car.vx * rx + car.vy * ry;
    const speed = Math.hypot(car.vx, car.vy);

    // ── on/off track?
    const near = nearestSample(car.x, car.y);
    const onTrack = near.d < TRACK_HALF + 2;
    const onCurb  = near.d >= TRACK_HALF - 2 && near.d < TRACK_HALF + CURB_W + 2;

    // physics constants — softened off-track
    const accel = onTrack ? 280 : 100;
    const brake = 380;
    const topSpd = onTrack ? 440 : 200;

    if (up) fSpeed += accel * dt;
    if (down) {
      if (fSpeed > 0) fSpeed = Math.max(0, fSpeed - brake * dt);
      else fSpeed -= accel * 0.6 * dt;
    }
    // engine drag + off-track drag
    const drag = onTrack ? 0.6 : 0.18;
    if (!up && !down) fSpeed *= Math.pow(drag, dt);
    else if (!onTrack) fSpeed *= Math.pow(0.55, dt);
    fSpeed = Math.max(-140, Math.min(topSpd, fSpeed));

    // steering
    const speedFactor = Math.min(1, Math.abs(fSpeed) / 60);
    const dir = fSpeed >= 0 ? 1 : -1;
    const turnRate = 2.6 * speedFactor * dir;
    car.heading += steerInput * turnRate * dt;
    const targetSteer = steerInput * 0.55;
    car.steerVis += (targetSteer - car.steerVis) * Math.min(1, dt * 14);

    // lateral grip
    const baseGrip = onTrack ? 0.18 : 0.05;
    const driftGrip = 0.58;
    const gripPerSec = handb ? driftGrip : baseGrip;
    const pushFactor = Math.min(1, (Math.abs(fSpeed) / 280) * Math.abs(steerInput));
    const effGrip = gripPerSec + pushFactor * 0.25;
    rSpeed *= Math.pow(effGrip, dt);

    car.vx = fx * fSpeed + rx * rSpeed;
    car.vy = fy * fSpeed + ry * rSpeed;

    // integrate
    car.prevX = car.x; car.prevY = car.y;
    car.x += car.vx * dt;
    car.y += car.vy * dt;

    // ── checkpoint detection
    for (let k = 0; k < NUM_CP; k++) {
      const seg = CP_SEGS[k];
      const t = segSegCross(car.prevX, car.prevY, car.x, car.y, seg.ax, seg.ay, seg.bx, seg.by);
      if (t < 0) continue;
      // forward direction check (must cross going roughly along the track tangent)
      const dot = (car.x - car.prevX) * seg.tx + (car.y - car.prevY) * seg.ty;
      if (dot <= 0) continue;
      if (k === 0) {
        if (!raceStarted) {
          raceStarted = true;
          lapStartT = now;
          lapNum = 1;
          nextCP = 1;
          showCaption('— go —', 1100);
        } else if (nextCP === 0) {
          // completed all checkpoints
          const t = (now - lapStartT) / 1000;
          lastLap = t;
          if (isNaN(bestLap) || t < bestLap) {
            bestLap = t;
            try { localStorage.setItem('s240sx_bestlap', String(bestLap)); } catch (e) {}
            showCaption('— personal best · ' + fmtTime(t) + ' —', 2400);
          } else {
            showCaption('— lap ' + lapNum + ' · ' + fmtTime(t) + ' —', 1800);
          }
          lapNum++;
          lapStartT = now;
          nextCP = 1;
        }
        // else: crossed start without completing the lap (cut), ignore
      } else if (k === nextCP) {
        nextCP = (nextCP + 1) % NUM_CP;
      }
    }

    if (raceStarted) lapTime = (now - lapStartT) / 1000;

    // drift detection
    let drift = 0;
    if (speed > 5) {
      const vAng = Math.atan2(car.vy, car.vx);
      drift = car.heading - vAng;
      while (drift >  Math.PI) drift -= Math.PI * 2;
      while (drift < -Math.PI) drift += Math.PI * 2;
    }
    const driftDeg = Math.abs(drift * 180 / Math.PI);
    const isDrifting = driftDeg > 10 && speed > 50 && fSpeed > 0;

    if (isDrifting) {
      const carL = 44, carW = 19;
      const baseX = car.x - fx * carL * 0.32;
      const baseY = car.y - fy * carL * 0.32;
      const rears = [
        [baseX + rx * (carW / 2 + 0.5), baseY + ry * (carW / 2 + 0.5)],
        [baseX - rx * (carW / 2 + 0.5), baseY - ry * (carW / 2 + 0.5)],
      ];
      const emit = Math.max(1, Math.floor(driftDeg / 12));
      for (let w = 0; w < 2; w++) {
        const px = rears[w][0], py = rears[w][1];
        for (let i = 0; i < emit; i++) {
          smoke.push({
            x: px + (Math.random() - 0.5) * 2,
            y: py + (Math.random() - 0.5) * 2,
            vx: -fx * (10 + Math.random() * 20) + (Math.random() - 0.5) * 40 - rx * rSpeed * 0.1,
            vy: -fy * (10 + Math.random() * 20) + (Math.random() - 0.5) * 40 - ry * rSpeed * 0.1,
            life: 1, ttl: 1.4 + Math.random() * 0.8,
            size: 4 + Math.random() * 7,
            warm: Math.random() < 0.18,
          });
        }
        skids.push({ x: px, y: py, life: 1 });
      }
      comboTimer = 1.2;
      combo = Math.min(8, combo + dt * 0.55);

      if (driftDeg > 45 && now - lastDriftAt > 6000 && combo > 2.2) {
        const lines = ['— full lock —','— ura door —','— manji —','— kansei —','— tsuiso —'];
        showCaption(lines[Math.floor(Math.random() * lines.length)], 1400);
        lastDriftAt = now;
      }
    } else {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = Math.max(1, combo - dt * 1.8);
    }

    // age smoke
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vx *= Math.pow(0.5, dt); s.vy *= Math.pow(0.5, dt);
      s.size += dt * 26;
      s.life -= dt / s.ttl;
      if (s.life <= 0) smoke.splice(i, 1);
    }
    if (smoke.length > 700) smoke.splice(0, smoke.length - 700);
    for (let i = skids.length - 1; i >= 0; i--) {
      skids[i].life -= dt * 0.045;
      if (skids[i].life <= 0) skids.splice(i, 1);
    }
    if (skids.length > 2400) skids.splice(0, skids.length - 2400);

    // ─── RENDER ───────────────────────────────────────────────────────────
    ctx.save();
    ctx.fillStyle = '#08080a';
    ctx.fillRect(0, 0, W, H);

    // camera centered on car
    ctx.translate(W / 2 - car.x, H / 2 - car.y);

    // tile grass outside the baked track bitmap, fills the viewport
    ctx.fillStyle = grassPattern;
    ctx.fillRect(car.x - W, car.y - H, W * 2, H * 2);

    // baked track (positioned at GMIN_X, GMIN_Y in world)
    ctx.drawImage(trackBmp, GMIN_X, GMIN_Y);

    // skids on top of asphalt
    for (let i = 0; i < skids.length; i++) {
      const sk = skids[i];
      ctx.fillStyle = 'rgba(0, 0, 0, ' + (0.55 * sk.life) + ')';
      ctx.fillRect(sk.x - 1.3, sk.y - 1.3, 2.6, 2.6);
    }

    // smoke
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < smoke.length; i++) {
      const s = smoke[i];
      const a = Math.max(0, s.life);
      if (s.warm) ctx.fillStyle = 'rgba(230, 137, 107, ' + (a * 0.22) + ')';
      else        ctx.fillStyle = 'rgba(220, 215, 205, ' + (a * 0.32) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    drawCar(ctx);

    ctx.restore();

    // ── joystick visual (touch only)
    if (jstick.active) {
      const jx = jstick.startX, jy = jstick.startY;
      const dx = jstick.currX - jx, dy = jstick.currY - jy;
      const maxR = 52;
      const clampR = Math.min(Math.hypot(dx, dy), maxR);
      const ang = Math.atan2(dy, dx);
      const kx = jx + Math.cos(ang) * clampR;
      const ky = jy + Math.sin(ang) * clampR;
      ctx.save();
      ctx.strokeStyle = 'rgba(239,230,212,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(jx, jy, maxR, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(239,230,212,0.07)';
      ctx.beginPath();
      ctx.moveTo(jx - maxR, jy); ctx.lineTo(jx + maxR, jy);
      ctx.moveTo(jx, jy - maxR); ctx.lineTo(jx, jy + maxR);
      ctx.stroke();
      ctx.fillStyle = touchHandbrake ? 'rgba(230,137,107,0.5)' : 'rgba(239,230,212,0.28)';
      ctx.beginPath(); ctx.arc(kx, ky, 20, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // ── minimap overlay (drawn in screen space)
    const mmX = W - miniBmp.width - 28;
    const mmY = 96;
    ctx.save();
    // backing
    ctx.fillStyle = 'rgba(8,8,10,0.55)';
    ctx.fillRect(mmX - 8, mmY - 8, miniBmp.width + 16, miniBmp.height + 16);
    ctx.strokeStyle = 'rgba(239,230,212,0.10)';
    ctx.strokeRect(mmX - 8 + 0.5, mmY - 8 + 0.5, miniBmp.width + 16, miniBmp.height + 16);
    ctx.drawImage(miniBmp, mmX, mmY);
    // car dot
    const cdx = mmX + miniBmp._ox + car.x * miniBmp._sc;
    const cdy = mmY + miniBmp._oy + car.y * miniBmp._sc;
    ctx.fillStyle = '#e6896b';
    ctx.beginPath();
    ctx.arc(cdx, cdy, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // ── HUD text ────────────────────────────────────────────────────────
    const mph = Math.round(speed * 0.42);
    const speedStr = String(mph).padStart(3, '0');
    if (elSpeed.textContent !== speedStr) {
      elSpeed.textContent = speedStr;
      if (mph > 90) elSpeed.classList.add('hot'); else elSpeed.classList.remove('hot');
    }
    const angleTxt = String(Math.round(driftDeg)).padStart(2, '0');
    if (elAngle.textContent !== angleTxt) elAngle.textContent = angleTxt;
    elLapTime.textContent = raceStarted ? fmtTime(lapTime) : '0:00.00';
    elLapLbl.textContent = raceStarted ? ('Lap ' + lapNum + ' · Time') : 'Cross to start';
    elLast.textContent = fmtTime(lastLap);
    elBest.textContent = fmtTime(bestLap);
    elCombo.textContent = '×' + combo.toFixed(1);
    if (combo > 1.4) elCombo.classList.add('on'); else elCombo.classList.remove('on');
    if (isDrifting) elDriftB.classList.add('on'); else elDriftB.classList.remove('on');

    // compass: heading vs north
    let h = car.heading + Math.PI / 2;
    while (h >  Math.PI) h -= Math.PI * 2;
    while (h < -Math.PI) h += Math.PI * 2;
    elTick.style.left = (50 + (h / Math.PI) * 50) + '%';

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
})();
