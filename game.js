// Ball Runner - a tiny platformer. Pure HTML/CSS/JS, no dependencies.
(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const TILE = 40;
  const ROWS = 12;
  const GROUND_ROW = ROWS - 2; // top row of the ground

  // Physics (per 1/60s step)
  const R = 14;
  const GRAVITY = 0.6;
  const MAX_FALL = 14;
  const JUMP_V = -11.5;
  const ACCEL_GROUND = 0.6;
  const ACCEL_AIR = 0.4;
  const MAX_SPEED = 5.5;
  const FRICTION = 0.82;
  const COYOTE_FRAMES = 6;
  const BUFFER_FRAMES = 8;

  // Level language (space-separated tokens):
  //   gN   N columns of flat ground
  //   pN   pit, N columns wide
  //   wH   wall, 1 column, H tiles tall
  //   WH   wall, 2 columns, H tiles tall
  //   sN   N columns of spikes on the ground
  //   oN.H floating platform over a pit, N wide, H tiles above ground
  //   S    player start (on ground)
  //   F    goal flag (on ground)
  const LEVELS = [
    {
      name: "First Roll",
      layout: "g3 S g5 w1 g4 p2 g4 s1 g4 w2 g4 p3 g4 s2 g4 F g5",
    },
    {
      name: "Spike Valley",
      layout: "g2 S g4 s3 g3 w2 g2 s2 g3 p3 g3 w1 w2 p3 g3 p2 o2.2 p2 g3 s1 g1 s1 g3 F g5",
    },
    {
      name: "The Gauntlet",
      layout: "g2 S g4 w2 s2 g3 p4 g2 s3 g2 p2 o1.1 p2 g2 W2 g1 s1 w2 g3 p2 o2.2 p1 o2.2 p3 g2 s2 g1 s2 g3 F g5",
    },
  ];

  function buildLevel(def) {
    const cols = [];
    let start = 0;
    let flag = 0;
    const column = () => {
      const c = new Array(ROWS).fill(" ");
      cols.push(c);
      return c;
    };
    const ground = (c) => {
      for (let r = GROUND_ROW; r < ROWS; r++) c[r] = "#";
      return c;
    };

    for (const tok of def.layout.trim().split(/\s+/)) {
      const m = tok.match(/^([a-zA-Z])(\d*)(?:\.(\d+))?$/);
      if (!m) throw new Error("Bad level token: " + tok);
      const type = m[1];
      const n = m[2] ? parseInt(m[2], 10) : 1;
      const h = m[3] ? parseInt(m[3], 10) : 1;

      switch (type) {
        case "g":
          for (let i = 0; i < n; i++) ground(column());
          break;
        case "p":
          for (let i = 0; i < n; i++) column();
          break;
        case "w":
        case "W": {
          const width = type === "W" ? 2 : 1;
          for (let i = 0; i < width; i++) {
            const c = ground(column());
            for (let r = GROUND_ROW - n; r < GROUND_ROW; r++) c[r] = "W";
          }
          break;
        }
        case "s":
          for (let i = 0; i < n; i++) ground(column())[GROUND_ROW - 1] = "^";
          break;
        case "o":
          for (let i = 0; i < n; i++) column()[GROUND_ROW - h] = "=";
          break;
        case "S":
          start = cols.length;
          ground(column());
          break;
        case "F":
          flag = cols.length;
          ground(column())[GROUND_ROW - 1] = "F";
          break;
        default:
          throw new Error("Unknown level token: " + tok);
      }
    }

    // Convert columns into rows of characters: grid[row][col]
    const grid = [];
    for (let r = 0; r < ROWS; r++) grid.push(cols.map((c) => c[r]));
    return {
      name: def.name,
      grid,
      width: cols.length,
      startX: start * TILE + TILE / 2,
      startY: GROUND_ROW * TILE - R,
      flagX: flag * TILE + TILE / 2,
    };
  }

  // ---------- State ----------
  const keys = {};
  let jumpBuffer = 0;

  let state = "title"; // title | play | dead | levelDone | win
  let levelIndex = 0;
  let level = null;
  let player = null;
  let camX = 0;
  let deaths = 0;
  let time = 0;
  let stateTimer = 0;
  let particles = [];
  let frame = 0;

  function newPlayer() {
    return {
      x: level.startX,
      y: level.startY,
      vx: 0,
      vy: 0,
      angle: 0,
      onGround: false,
      coyote: 0,
      squash: 0,
    };
  }

  function loadLevel(i) {
    levelIndex = i;
    level = buildLevel(LEVELS[i]);
    player = newPlayer();
    camX = 0;
    particles = [];
    jumpBuffer = 0;
  }

  function startGame() {
    deaths = 0;
    time = 0;
    loadLevel(0);
    state = "play";
  }

  // ---------- Input ----------
  const GAME_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "];

  window.addEventListener("keydown", (e) => {
    if (GAME_KEYS.includes(e.key)) e.preventDefault();
    keys[e.key] = true;
    const isJump = e.key === "ArrowUp" || e.key === " ";

    if (state === "title" || state === "win") {
      if (!e.repeat && (e.key === "Enter" || isJump)) startGame();
      return;
    }
    if (isJump && !e.repeat) jumpBuffer = BUFFER_FRAMES;
    if ((e.key === "r" || e.key === "R") && state === "play") die();
  });

  window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
  });

  window.addEventListener("blur", () => {
    for (const k in keys) keys[k] = false;
  });

  // ---------- World helpers ----------
  function tileAt(c, r) {
    if (r < 0 || r >= ROWS) return " ";
    if (c < 0 || c >= level.width) return "W"; // invisible edge walls
    return level.grid[r][c];
  }

  function isSolid(ch) {
    return ch === "#" || ch === "W" || ch === "=";
  }

  function forEachOverlap(fn) {
    const c0 = Math.floor((player.x - R) / TILE);
    const c1 = Math.floor((player.x + R - 0.001) / TILE);
    const r0 = Math.floor((player.y - R) / TILE);
    const r1 = Math.floor((player.y + R - 0.001) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) fn(c, r, tileAt(c, r));
    }
  }

  function circleHitsRect(cx, cy, cr, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy < cr * cr;
  }

  // ---------- Update ----------
  function updatePlayer() {
    const p = player;
    const left = keys["ArrowLeft"];
    const right = keys["ArrowRight"];
    const dir = (right ? 1 : 0) - (left ? 1 : 0);

    // Horizontal movement
    const accel = p.onGround ? ACCEL_GROUND : ACCEL_AIR;
    if (dir !== 0) {
      p.vx += dir * accel;
      p.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, p.vx));
    } else if (p.onGround) {
      p.vx *= FRICTION;
      if (Math.abs(p.vx) < 0.05) p.vx = 0;
    } else {
      p.vx *= 0.98;
    }

    // Jumping (with coyote time + input buffer)
    if (jumpBuffer > 0) jumpBuffer--;
    if (p.onGround) p.coyote = COYOTE_FRAMES;
    else if (p.coyote > 0) p.coyote--;

    if (jumpBuffer > 0 && p.coyote > 0) {
      p.vy = JUMP_V;
      p.coyote = 0;
      jumpBuffer = 0;
      p.onGround = false;
      p.squash = -0.25;
      puff(p.x, p.y + R, 6, "#ffffff");
    }

    // Gravity, stronger when jump is released early (variable jump height)
    const jumpHeld = keys["ArrowUp"] || keys[" "];
    p.vy += p.vy < 0 && !jumpHeld ? GRAVITY * 2.2 : GRAVITY;
    if (p.vy > MAX_FALL) p.vy = MAX_FALL;

    // Move X, resolve
    p.x += p.vx;
    forEachOverlap((c, r, ch) => {
      if (!isSolid(ch)) return;
      if (p.vx > 0) p.x = c * TILE - R;
      else if (p.vx < 0) p.x = (c + 1) * TILE + R;
      p.vx = 0;
    });

    // Move Y, resolve
    const wasOnGround = p.onGround;
    const fallSpeed = p.vy;
    p.y += p.vy;
    p.onGround = false;
    forEachOverlap((c, r, ch) => {
      if (!isSolid(ch)) return;
      if (p.vy > 0) {
        p.y = r * TILE - R;
        p.onGround = true;
      } else if (p.vy < 0) {
        p.y = (r + 1) * TILE + R;
      }
      p.vy = 0;
    });

    if (p.onGround && !wasOnGround && fallSpeed > 4) {
      p.squash = Math.min(0.35, fallSpeed / 30);
      puff(p.x, p.y + R, 5, "#d9c3a0");
    }
    p.squash *= 0.8;

    // Rolling
    p.angle += p.vx / R;

    // Hazards: spikes
    let hit = false;
    forEachOverlap((c, r, ch) => {
      if (ch !== "^") return;
      if (circleHitsRect(p.x, p.y, R - 2, c * TILE + 9, r * TILE + 14, TILE - 18, TILE - 14)) hit = true;
    });
    if (hit) return die();

    // Hazards: pits
    if (p.y - R > ROWS * TILE) return die(true);

    // Goal
    if (p.x >= level.flagX - 4) {
      state = "levelDone";
      stateTimer = 0;
      confetti(level.flagX, GROUND_ROW * TILE - TILE * 2);
    }
  }

  function die(fell) {
    if (state !== "play") return;
    deaths++;
    state = "dead";
    stateTimer = 0;
    const y = fell ? ROWS * TILE - 10 : player.y;
    burst(player.x, y);
  }

  function update() {
    frame++;
    if (state === "play" || state === "dead") time += 1 / 60;

    if (state === "play") {
      updatePlayer();
    } else if (state === "dead") {
      stateTimer++;
      if (stateTimer > 45) {
        player = newPlayer();
        jumpBuffer = 0;
        state = "play";
      }
    } else if (state === "levelDone") {
      stateTimer++;
      // let the ball roll out a little
      player.vx *= 0.92;
      player.x += player.vx;
      player.angle += player.vx / R;
      if (stateTimer > 90) {
        if (levelIndex + 1 < LEVELS.length) {
          loadLevel(levelIndex + 1);
          state = "play";
        } else {
          state = "win";
          stateTimer = 0;
        }
      }
    }

    // Camera
    if (level) {
      const target = Math.max(0, Math.min(level.width * TILE - W, player.x - W * 0.4));
      camX += (target - camX) * 0.12;
    }

    // Particles
    for (const pt of particles) {
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vy += pt.g;
      pt.life--;
    }
    particles = particles.filter((pt) => pt.life > 0);
  }

  // ---------- Particles ----------
  function puff(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 3,
        vy: -Math.random() * 1.5,
        g: 0.05,
        life: 20 + Math.random() * 10,
        max: 30,
        size: 3 + Math.random() * 3,
        color,
      });
    }
  }

  function burst(x, y) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 5;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 2,
        g: 0.25,
        life: 40 + Math.random() * 20,
        max: 60,
        size: 3 + Math.random() * 4,
        color: Math.random() < 0.5 ? "#ff6b35" : "#ffd23f",
      });
    }
  }

  function confetti(x, y) {
    const colors = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93"];
    for (let i = 0; i < 60; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 8,
        vy: -Math.random() * 8 - 2,
        g: 0.2,
        life: 70 + Math.random() * 30,
        max: 100,
        size: 3 + Math.random() * 3,
        color: colors[i % colors.length],
      });
    }
  }

  // ---------- Drawing ----------
  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#5fb4ff");
    sky.addColorStop(1, "#c9ecff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Sun
    ctx.fillStyle = "rgba(255, 240, 160, 0.9)";
    ctx.beginPath();
    ctx.arc(W - 120, 80, 40, 0, Math.PI * 2);
    ctx.fill();

    // Clouds (slow parallax)
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 6; i++) {
      const span = W + 300;
      const x = ((i * 260 - camX * 0.15) % span + span) % span - 150;
      const y = 50 + (i % 3) * 45;
      cloud(x, y);
    }

    // Hills (medium parallax)
    ctx.fillStyle = "#8fd18b";
    for (let i = -1; i < 8; i++) {
      const span = 220;
      const x = i * span - ((camX * 0.35) % span);
      ctx.beginPath();
      ctx.ellipse(x, H - 40, 160, 120, 0, Math.PI, 0);
      ctx.fill();
    }
  }

  function cloud(x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.arc(x + 25, y - 10, 28, 0, Math.PI * 2);
    ctx.arc(x + 55, y, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTiles() {
    const c0 = Math.max(0, Math.floor(camX / TILE));
    const c1 = Math.min(level.width - 1, Math.ceil((camX + W) / TILE));
    for (let r = 0; r < ROWS; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = level.grid[r][c];
        const x = Math.round(c * TILE - camX);
        const y = r * TILE;
        if (ch === "#") drawGround(x, y, !isSolid(tileAt(c, r - 1)));
        else if (ch === "W") drawWall(x, y);
        else if (ch === "=") drawPlatform(x, y);
        else if (ch === "^") drawSpike(x, y);
        else if (ch === "F") drawFlag(x, y);
      }
    }
  }

  function drawGround(x, y, top) {
    ctx.fillStyle = "#8b5a2b";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#7a4e24";
    ctx.fillRect(x + 6, y + 18, 6, 6);
    ctx.fillRect(x + 24, y + 28, 6, 6);
    if (top) {
      ctx.fillStyle = "#4caf50";
      ctx.fillRect(x, y, TILE, 10);
      ctx.fillStyle = "#66cc6a";
      ctx.fillRect(x, y, TILE, 4);
    }
  }

  function drawWall(x, y) {
    ctx.fillStyle = "#6b7280";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = "#4b5563";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
    ctx.beginPath();
    ctx.moveTo(x, y + TILE / 2);
    ctx.lineTo(x + TILE, y + TILE / 2);
    ctx.moveTo(x + TILE / 2, y);
    ctx.lineTo(x + TILE / 2, y + TILE / 2);
    ctx.moveTo(x + TILE / 4, y + TILE / 2);
    ctx.lineTo(x + TILE / 4, y + TILE);
    ctx.moveTo(x + (TILE * 3) / 4, y + TILE / 2);
    ctx.lineTo(x + (TILE * 3) / 4, y + TILE);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(x + 2, y + 2, TILE - 4, 3);
  }

  function drawPlatform(x, y) {
    ctx.fillStyle = "#c58b4c";
    ctx.fillRect(x, y, TILE, 14);
    ctx.fillStyle = "#9c6a35";
    ctx.fillRect(x, y + 10, TILE, 4);
    ctx.fillStyle = "#e0a96d";
    ctx.fillRect(x, y, TILE, 3);
  }

  function drawSpike(x, y) {
    const n = 2;
    const w = TILE / n;
    for (let i = 0; i < n; i++) {
      const sx = x + i * w;
      ctx.fillStyle = "#cfd6df";
      ctx.beginPath();
      ctx.moveTo(sx + 2, y + TILE);
      ctx.lineTo(sx + w / 2, y + 10);
      ctx.lineTo(sx + w - 2, y + TILE);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#8a96a8";
      ctx.beginPath();
      ctx.moveTo(sx + w / 2, y + 10);
      ctx.lineTo(sx + w - 2, y + TILE);
      ctx.lineTo(sx + w / 2, y + TILE);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawFlag(x, y) {
    const poleX = x + TILE / 2;
    const top = y - TILE * 2;
    ctx.fillStyle = "#eeeeee";
    ctx.fillRect(poleX - 2, top, 4, TILE * 3);
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(poleX, top, 5, 0, Math.PI * 2);
    ctx.fill();
    const wave = Math.sin(frame * 0.15) * 4;
    ctx.fillStyle = "#e63946";
    ctx.beginPath();
    ctx.moveTo(poleX + 2, top + 4);
    ctx.quadraticCurveTo(poleX + 20, top + 4 + wave, poleX + 40, top + 16);
    ctx.quadraticCurveTo(poleX + 20, top + 28 - wave, poleX + 2, top + 30);
    ctx.closePath();
    ctx.fill();
  }

  function drawPlayer() {
    if (state === "dead") return;
    const p = player;
    const x = p.x - camX;
    const sx = 1 + p.squash;
    const sy = 1 - p.squash;

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.ellipse(x, p.y + R + 2, R * 0.9, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, p.y + R * (1 - sy));
    ctx.scale(sx, sy);
    ctx.rotate(p.angle);

    const g = ctx.createRadialGradient(-4, -5, 2, 0, 0, R);
    g.addColorStop(0, "#ffd08a");
    g.addColorStop(0.5, "#ff8c42");
    g.addColorStop(1, "#d9480f");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();

    // Stripe so you can see it roll
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, R - 4, -0.6, 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R - 4, Math.PI - 0.6, Math.PI + 0.6);
    ctx.stroke();

    ctx.restore();
  }

  function drawParticles() {
    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - camX - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }

  function formatTime(t) {
    return t.toFixed(1) + "s";
  }

  function text(str, x, y, size, color, align = "center") {
    ctx.font = `bold ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillText(str, x + 2, y + 3);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function drawHUD() {
    ctx.fillStyle = "rgba(16, 20, 42, 0.55)";
    ctx.fillRect(12, 12, 380, 40);
    text(`Level ${levelIndex + 1}/${LEVELS.length}: ${level.name}`, 24, 32, 18, "#ffffff", "left");
    ctx.fillStyle = "rgba(16, 20, 42, 0.55)";
    ctx.fillRect(W - 262, 12, 250, 40);
    text(`Time ${formatTime(time)}`, W - 250, 32, 18, "#ffd23f", "left");
    text(`Deaths ${deaths}`, W - 24, 32, 18, "#ff8c8c", "right");
  }

  function overlay(alpha) {
    ctx.fillStyle = `rgba(16, 20, 42, ${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTitle() {
    drawBackground();
    overlay(0.45);
    text("BALL RUNNER", W / 2, 140, 64, "#ffb347");
    text("Roll, jump, and reach the flag in all 3 levels!", W / 2, 210, 22, "#ffffff");
    text("← → move     ↑ / Space jump     R restart level", W / 2, 260, 20, "#e8ecff");
    text("Watch out for walls, spikes and pits", W / 2, 300, 20, "#e8ecff");
    if (Math.floor(frame / 30) % 2 === 0) {
      text("Press Space or Enter to start", W / 2, 380, 28, "#ffd23f");
    }
    // Bouncing demo ball
    const by = 440 - Math.abs(Math.sin(frame * 0.06)) * 60;
    ctx.fillStyle = "#ff8c42";
    ctx.beginPath();
    ctx.arc(W / 2, by, R, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    if (state === "title") return drawTitle();

    drawBackground();
    drawTiles();
    drawPlayer();
    drawParticles();
    drawHUD();

    if (state === "dead") {
      text("Ouch!", W / 2, H / 2 - 20, 48, "#ff6b6b");
    } else if (state === "levelDone") {
      const last = levelIndex + 1 >= LEVELS.length;
      text(last ? "Final level cleared!" : "Level complete!", W / 2, H / 2 - 40, 48, "#8ac926");
    } else if (state === "win") {
      overlay(0.6);
      text("YOU WIN!", W / 2, 140, 72, "#ffd23f");
      text(`Time: ${formatTime(time)}`, W / 2, 230, 32, "#ffffff");
      text(`Deaths: ${deaths}`, W / 2, 275, 32, "#ff8c8c");
      if (Math.floor(frame / 30) % 2 === 0) {
        text("Press Space or Enter to play again", W / 2, 370, 26, "#ffb347");
      }
      stateTimer++;
      if (stateTimer % 20 === 0) confetti(camX + Math.random() * W, 0);
    }
  }

  // ---------- Main loop (fixed 60Hz timestep) ----------
  const STEP = 1000 / 60;
  let last = performance.now();
  let acc = 0;

  function loop(now) {
    acc += Math.min(250, now - last);
    last = now;
    while (acc >= STEP) {
      update();
      acc -= STEP;
    }
    render();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
