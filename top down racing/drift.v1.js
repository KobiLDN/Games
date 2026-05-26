// 240SX — A Drift Study
// Top-down drift sim. Pure vanilla, canvas-based.

(function () {
  'use strict';

  // ─── DOM refs ────────────────────────────────────────────────────────────
  const canvas   = document.getElementById('world');
  const ctx      = canvas.getContext('2d');
  const splash   = document.getElementById('splash');
  const chrome   = document.getElementById('chrome');
  const elSpeed  = document.getElementById('hud-speed');
  const elAngle  = document.getElementById('hud-angle');
  const elScore  = document.getElementById('hud-score');
  const elBest   = document.getElementById('hud-best');
  const elCombo  = document.getElementById('hud-combo');
  const elDriftB = document.getElementById('hud-drift-block');
  const elCap    = document.getElementById('caption');
  const elTick   = document.getElementById('compass-tick');

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
    // gray speckle
    for (let i = 0; i < 480; i++) {
      const a = Math.random() * 0.04;
      rtx.fillStyle = 'rgba(255,255,255,' + a + ')';
      rtx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
    // warm flecks
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * 0.035;
      rtx.fillStyle = 'rgba(255, 200, 150,' + a + ')';
      rtx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
    // larger cool patches
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * 0.015;
      const s = 2 + Math.random() * 3;
      rtx.fillStyle = 'rgba(180, 195, 220,' + a + ')';
      rtx.fillRect(Math.random() * 256, Math.random() * 256, s, s);
    }
  })();
  const roadPattern = ctx.createPattern(roadTile, 'repeat');

  // ─── state ───────────────────────────────────────────────────────────────
  const car = {
    x: 0, y: 0,
    heading: -Math.PI / 2,   // points "up"
    vx: 0, vy: 0,
    steerVis: 0,             // visual front-wheel angle, smoothed
  };
  const smoke = [];   // ephemeral particles
  const skids = [];   // persistent black streaks on the road
  const cones = [];   // decorative cones scattered around for context

  // scatter some cones around as scale anchors
  (function seedCones() {
    for (let i = 0; i < 60; i++) {
      const r = 200 + Math.random() * 1200;
      const a = Math.random() * Math.PI * 2;
      cones.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
  })();

  // score + meta
  let score = 0;
  let bestScore = parseFloat(localStorage.getItem('s240sx_best') || '0');
  let combo = 1;
  let comboTimer = 0;
  let started = false;
  let lastDriftAt = -10;

  elBest.textContent = Math.floor(bestScore).toLocaleString();

  // ─── input ───────────────────────────────────────────────────────────────
  const keys = Object.create(null);
  function start() {
    if (started) return;
    started = true;
    splash.classList.add('gone');
    chrome.classList.add('live');
    // little welcome caption
    showCaption('— hajime —', 1800);
  }
  function reset() {
    car.x = 0; car.y = 0;
    car.heading = -Math.PI / 2;
    car.vx = 0; car.vy = 0;
    car.steerVis = 0;
    smoke.length = 0;
    skids.length = 0;
    score = 0;
    combo = 1;
    comboTimer = 0;
    showCaption('— reset —', 900);
  }
  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    keys[e.code] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].indexOf(e.code) >= 0) e.preventDefault();
    if (!started) start();
    if (e.code === 'KeyR') reset();
  });
  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
  });
  // splash click → also start
  splash.addEventListener('click', start);

  // ─── virtual joystick (touch) ────────────────────────────────────────────
  const touch = { left: false, right: false, throttle: false, brake: false };
  const jstick = { active: false, id: null, startX: 0, startY: 0, currX: 0, currY: 0 };
  let touchHandbrake = false;
  const J_STEER_DEAD = 18;
  const J_BRAKE_DEAD = 28;

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
  function showCaption(text, ms) {
    elCap.textContent = text;
    elCap.classList.add('show');
    clearTimeout(showCaption._t);
    showCaption._t = setTimeout(function () {
      elCap.classList.remove('show');
    }, ms);
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y,     x + w, y + h, r);
    c.arcTo(x + w, y + h, x,     y + h, r);
    c.arcTo(x,     y + h, x,     y,     r);
    c.arcTo(x,     y,     x + w, y,     r);
    c.closePath();
  }

  // ─── car render (top-down S13 silhouette) ────────────────────────────────
  function drawCar(c) {
    c.save();
    c.translate(car.x, car.y);
    c.rotate(car.heading);
    // heading=0 → car points along +X (forward = right of canvas in local space)

    const L = 44, w = 19;

    // chassis shadow under car
    c.save();
    c.globalAlpha = 0.55;
    c.fillStyle = '#000';
    c.beginPath();
    c.ellipse(0, 0, L * 0.6, w * 0.85, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // wheels (drawn first, behind body)
    const drawWheel = function (wx, wy, steer) {
      c.save();
      c.translate(wx, wy);
      c.rotate(steer);
      c.fillStyle = '#0a0a0b';
      c.fillRect(-3.6, -2.4, 7.2, 4.8);
      // silver rim hint
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

    // body
    c.fillStyle = '#0c0c0e';
    roundRect(c, -L / 2, -w / 2, L, w, 4);
    c.fill();

    // body edge highlight (warm rim light, top side only)
    c.strokeStyle = 'rgba(245, 230, 210, 0.16)';
    c.lineWidth = 0.8;
    c.stroke();

    // a subtle long highlight stripe running the spine of the car
    const grad = c.createLinearGradient(0, -w / 2, 0, w / 2);
    grad.addColorStop(0,    'rgba(255, 240, 220, 0.10)');
    grad.addColorStop(0.5,  'rgba(255, 240, 220, 0.00)');
    grad.addColorStop(1,    'rgba(255, 240, 220, 0.04)');
    c.fillStyle = grad;
    roundRect(c, -L / 2 + 1, -w / 2 + 1, L - 2, w - 2, 3);
    c.fill();

    // greenhouse / windows (slightly amber tint)
    c.fillStyle = 'rgba(20, 22, 28, 0.85)';
    roundRect(c, -L * 0.28, -w / 2 + 2.4, L * 0.5, w - 4.8, 2.4);
    c.fill();
    // window seam highlight
    c.strokeStyle = 'rgba(245, 230, 210, 0.08)';
    c.lineWidth = 0.5;
    c.stroke();

    // hatch glass (S13 hatch has rear glass)
    c.fillStyle = 'rgba(20, 22, 28, 0.7)';
    roundRect(c, -L * 0.46, -w / 2 + 3, L * 0.16, w - 6, 1.6);
    c.fill();

    // hood seam line
    c.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    c.lineWidth = 0.5;
    c.beginPath();
    c.moveTo(L * 0.22, -w / 2 + 1.5);
    c.lineTo(L * 0.22,  w / 2 - 1.5);
    c.stroke();

    // pop-up headlight slits (down position)
    c.fillStyle = 'rgba(40, 36, 32, 0.9)';
    c.fillRect(L * 0.42, -w / 2 + 2.5, 2.4, 3.5);
    c.fillRect(L * 0.42,  w / 2 - 6.0, 2.4, 3.5);

    // small headlight glow (key lights on)
    c.fillStyle = 'rgba(255, 220, 170, 0.5)';
    c.fillRect(L * 0.46, -w / 2 + 3.0, 1.0, 2.5);
    c.fillRect(L * 0.46,  w / 2 - 5.5, 1.0, 2.5);

    // taillight bars (warm red ember)
    c.fillStyle = 'rgba(230, 80, 60, 0.85)';
    c.fillRect(-L / 2 + 0.6, -w / 2 + 2.5, 1.6, 3.0);
    c.fillRect(-L / 2 + 0.6,  w / 2 - 5.5, 1.6, 3.0);
    // brake light glow when braking heavily
    if ((keys.ArrowDown || keys.KeyS || touch.brake)) {
      c.fillStyle = 'rgba(255, 70, 50, 0.55)';
      c.beginPath();
      c.ellipse(-L / 2 - 4, 0, 14, w * 0.7, 0, 0, Math.PI * 2);
      c.fill();
    }

    // headlight beam cones — short, only when moving forward
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

  // ─── physics loop ────────────────────────────────────────────────────────
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp big stutters

    // ─── input
    const up    = keys.ArrowUp    || keys.KeyW || touch.throttle ? 1 : 0;
    const down  = keys.ArrowDown  || keys.KeyS || touch.brake    ? 1 : 0;
    const left  = keys.ArrowLeft  || keys.KeyA || touch.left     ? 1 : 0;
    const right = keys.ArrowRight || keys.KeyD || touch.right    ? 1 : 0;
    const handb = keys.Space || touchHandbrake ? 1 : 0;
    const steerInput = right - left;

    // ─── decompose velocity into forward / lateral
    const fx = Math.cos(car.heading), fy = Math.sin(car.heading);
    const rx = -fy, ry = fx; // right perpendicular
    let fSpeed = car.vx * fx + car.vy * fy;
    let rSpeed = car.vx * rx + car.vy * ry;
    const speed = Math.hypot(car.vx, car.vy);

    // ─── throttle / brake / engine braking
    const accel = 260;            // px/s² forward accel
    const brake = 380;            // braking decel
    if (up) fSpeed += accel * dt;
    if (down) {
      if (fSpeed > 0) fSpeed = Math.max(0, fSpeed - brake * dt);
      else fSpeed -= accel * 0.6 * dt; // reverse
    }
    if (!up && !down) fSpeed *= Math.pow(0.6, dt); // engine drag (decay constant per sec)
    fSpeed = Math.max(-140, Math.min(420, fSpeed));

    // ─── steering: turn rate scales with speed (no turn at standstill)
    const speedFactor = Math.min(1, Math.abs(fSpeed) / 60);
    const dir = fSpeed >= 0 ? 1 : -1;
    const turnRate = 2.6 * speedFactor * dir;
    car.heading += steerInput * turnRate * dt;
    // smooth visual steering angle for front wheels
    const targetSteer = steerInput * 0.55;
    car.steerVis += (targetSteer - car.steerVis) * Math.min(1, dt * 14);

    // ─── lateral grip: handbrake drops grip, drift sustains
    // higher = more grip retained per second
    const baseGrip = 0.18; // lateral velocity retained per second normally
    const driftGrip = 0.58; // retained when handbrake
    const gripPerSec = handb ? driftGrip : baseGrip;
    // also lose grip a little when high speed + steering (push the car)
    const pushFactor = Math.min(1, (Math.abs(fSpeed) / 280) * Math.abs(steerInput));
    const effGrip = gripPerSec + pushFactor * 0.25;
    rSpeed *= Math.pow(effGrip, dt);

    // ─── recombine velocity
    car.vx = fx * fSpeed + rx * rSpeed;
    car.vy = fy * fSpeed + ry * rSpeed;

    // ─── integrate
    car.x += car.vx * dt;
    car.y += car.vy * dt;

    // ─── drift detection
    let drift = 0;
    if (speed > 5) {
      const vAng = Math.atan2(car.vy, car.vx);
      drift = car.heading - vAng;
      while (drift >  Math.PI) drift -= Math.PI * 2;
      while (drift < -Math.PI) drift += Math.PI * 2;
    }
    const driftDeg = Math.abs(drift * 180 / Math.PI);
    const isDrifting = driftDeg > 10 && speed > 50 && fSpeed > 0;

    // ─── tire smoke + skid marks at rear wheels when drifting
    if (isDrifting) {
      const carL = 44, carW = 19;
      const baseX = car.x - fx * carL * 0.32;
      const baseY = car.y - fy * carL * 0.32;
      const wheelsRears = [
        [baseX + rx * (carW / 2 + 0.5), baseY + ry * (carW / 2 + 0.5)],
        [baseX - rx * (carW / 2 + 0.5), baseY - ry * (carW / 2 + 0.5)],
      ];
      // emit a couple particles per wheel per frame
      const emit = Math.max(1, Math.floor(driftDeg / 12));
      for (let w = 0; w < 2; w++) {
        const px = wheelsRears[w][0], py = wheelsRears[w][1];
        for (let i = 0; i < emit; i++) {
          smoke.push({
            x: px + (Math.random() - 0.5) * 2,
            y: py + (Math.random() - 0.5) * 2,
            vx: -fx * (10 + Math.random() * 20) + (Math.random() - 0.5) * 40 - rx * rSpeed * 0.1,
            vy: -fy * (10 + Math.random() * 20) + (Math.random() - 0.5) * 40 - ry * rSpeed * 0.1,
            life: 1,
            ttl: 1.4 + Math.random() * 0.8,
            size: 4 + Math.random() * 7,
            warm: Math.random() < 0.18, // some particles tinted warm (ember kissed)
          });
        }
        skids.push({ x: px, y: py, life: 1 });
      }
      // score: angle (clamped) * speed * combo
      const angleScore = Math.min(driftDeg, 75);
      score += angleScore * (speed / 240) * combo * dt * 8;
      comboTimer = 1.2;
      combo = Math.min(8, combo + dt * 0.55);

      // editorial flourish: occasional caption while drifting big
      if (driftDeg > 45 && now - lastDriftAt > 6000 && combo > 2.2) {
        const lines = [
          '— full lock —',
          '— ura door —',
          '— manji —',
          '— kansei —',
          '— tsuiso —',
        ];
        showCaption(lines[Math.floor(Math.random() * lines.length)], 1400);
        lastDriftAt = now;
      }
    } else {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = Math.max(1, combo - dt * 1.8);
    }

    // ─── age smoke
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.pow(0.5, dt);
      s.vy *= Math.pow(0.5, dt);
      s.size += dt * 26;
      s.life -= dt / s.ttl;
      if (s.life <= 0) smoke.splice(i, 1);
    }
    if (smoke.length > 700) smoke.splice(0, smoke.length - 700);

    // ─── age skids (very slowly)
    for (let i = skids.length - 1; i >= 0; i--) {
      skids[i].life -= dt * 0.045;
      if (skids[i].life <= 0) skids.splice(i, 1);
    }
    if (skids.length > 2400) skids.splice(0, skids.length - 2400);

    // ─── best
    if (score > bestScore) {
      bestScore = score;
      try { localStorage.setItem('s240sx_best', String(bestScore)); } catch (e) {}
    }

    // ─── RENDER ───────────────────────────────────────────────────────────
    // background
    ctx.save();
    ctx.fillStyle = '#08080a';
    ctx.fillRect(0, 0, W, H);

    // camera: car centered
    ctx.translate(W / 2 - car.x, H / 2 - car.y);

    // asphalt — fill a bounding box that covers the visible region
    ctx.fillStyle = roadPattern;
    ctx.fillRect(car.x - W, car.y - H, W * 2, H * 2);

    // a few faint lane stripes far apart for sense of motion (not a road, just hints)
    ctx.strokeStyle = 'rgba(169, 138, 74, 0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([18, 22]);
    for (let lx = Math.floor((car.x - W) / 320) * 320; lx < car.x + W; lx += 320) {
      ctx.beginPath();
      ctx.moveTo(lx, car.y - H);
      ctx.lineTo(lx, car.y + H);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // cones — distant little markers for scale
    for (let i = 0; i < cones.length; i++) {
      const cn = cones[i];
      const dx = cn.x - car.x, dy = cn.y - car.y;
      if (dx*dx + dy*dy > (W * 0.8) * (W * 0.8)) continue;
      ctx.fillStyle = 'rgba(230, 137, 107, 0.55)';
      ctx.fillRect(cn.x - 1.5, cn.y - 1.5, 3, 3);
      ctx.fillStyle = 'rgba(230, 137, 107, 0.15)';
      ctx.fillRect(cn.x - 4, cn.y - 4, 8, 8);
    }

    // skid marks — drawn as dark streaks under everything
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
      if (s.warm) {
        ctx.fillStyle = 'rgba(230, 137, 107, ' + (a * 0.22) + ')';
      } else {
        ctx.fillStyle = 'rgba(220, 215, 205, ' + (a * 0.32) + ')';
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // the car itself
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

    // ─── HUD ──────────────────────────────────────────────────────────────
    const mph = Math.round(speed * 0.42);
    if (elSpeed.textContent !== String(mph).padStart(3, '0')) {
      elSpeed.textContent = String(mph).padStart(3, '0');
      if (mph > 90) elSpeed.classList.add('hot'); else elSpeed.classList.remove('hot');
    }
    const angleTxt = String(Math.round(driftDeg)).padStart(2, '0');
    if (elAngle.textContent !== angleTxt) elAngle.textContent = angleTxt;
    elScore.textContent = Math.floor(score).toLocaleString();
    elBest.textContent  = Math.floor(bestScore).toLocaleString();
    elCombo.textContent = '×' + combo.toFixed(1);
    if (combo > 1.4) elCombo.classList.add('on'); else elCombo.classList.remove('on');
    if (isDrifting) elDriftB.classList.add('on'); else elDriftB.classList.remove('on');

    // compass tick: angle of motion vs heading axis, mapped to a slider
    // show heading direction around the world (north reference) — normalize to -180..180
    let h = car.heading + Math.PI / 2; // make north = up = 0
    while (h >  Math.PI) h -= Math.PI * 2;
    while (h < -Math.PI) h += Math.PI * 2;
    const pct = 50 + (h / Math.PI) * 50; // -180→0%, 0→50%, 180→100%
    elTick.style.left = pct + '%';

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ─── disable browser context menu on long-press touch ────────────────────
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
})();
