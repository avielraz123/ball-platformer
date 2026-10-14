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
  //   eN   N columns of ground, with a patrolling slime enemy
  //   rN   N columns of ground, with a spiked wheel that rolls toward the ball
  //   dH   1 column of ground, with a spike mine floating H tiles up that flies toward the ball
  //   BV   boss (V = 1 King Blob, 2 Spike Lord) - beat it to clear the level
  //   S    player start (on ground)
  //   F    goal flag (on ground)
  const LEVELS = [
    {
      name: "First Roll",
      layout: "g3 S g5 w1 g4 p2 g3 e1 g4 s1 g4 w2 g4 p3 g3 r1 g4 F g5",
    },
    {
      name: "Spike Valley",
      layout: "g2 S g4 s3 g3 e1 g3 w2 g2 s2 g3 p3 g3 d2 g3 w1 w2 p3 g3 p2 o2.2 p2 g3 e1 g2 s1 g1 s1 g3 r1 g3 F g5",
    },
    {
      name: "BOSS: King Blob",
      layout: "g2 S g20 B1 g2",
    },
    {
      name: "Rolling Thunder",
      layout: "g2 S g4 r1 g4 w2 s2 g3 p4 g2 e1 g3 s3 g2 d3 g2 p2 o1.1 p2 g2 W2 g1 s1 w2 g3 r1 g3 F g5",
    },
    {
      name: "The Gauntlet",
      layout: "g2 S g4 e1 g3 p3 g2 s2 g1 s2 g3 d2 g3 p2 o2.2 p1 o2.2 p3 g2 r1 g3 w2 g3 e1 g2 s3 g3 d3 g2 W2 g3 F g5",
    },
    {
      name: "BOSS: Spike Lord",
      layout: "g2 S g20 B2 g2",
    },
  ];

  function buildLevel(def) {
    const cols = [];
    const spawns = [];
    let start = 0;
    let flag = -1;
    let boss = false;
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
        case "e":
        case "r":
          spawns.push({ type: type === "e" ? "slime" : "roller", col: cols.length });
          for (let i = 0; i < n; i++) ground(column());
          break;
        case "d":
          spawns.push({ type: "drone", col: cols.length, height: n });
          ground(column());
          break;
        case "B":
          spawns.push({ type: "boss", col: cols.length, variant: n });
          boss = true;
          ground(column());
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
      spawns,
      boss,
      width: cols.length,
      startX: start * TILE + TILE / 2,
      startY: GROUND_ROW * TILE - R,
      flagX: flag >= 0 ? flag * TILE + TILE / 2 : Infinity,
    };
  }

  // ---------- State ----------
  const keys = {};
  let jumpBuffer = 0;

  let state = "title"; // title | play | dead | levelDone | win
  let levelIndex = 0;
  let level = null;
  let player = null;
  let enemies = [];
  let camX = 0;
  let deaths = 0;
  let time = 0;
  let stateTimer = 0;
  let levelTimer = 0;
  let particles = [];
  let frame = 0;
  let shake = 0;

  function newPlayer() {
    return {
      x: level.startX,
      y: level.startY,
      vx: 0,
      vy: 0,
      angle: 0,
      facing: 1,
      onGround: false,
      coyote: 0,
      squash: 0,
    };
  }

  function spawnEnemy(s) {
    const x = s.col * TILE + TILE / 2;
    switch (s.type) {
      case "slime":
        return { type: "slime", x, y: GROUND_ROW * TILE - 11, hw: 15, hh: 11, vx: -1.2, alive: true };
      case "roller":
        return { type: "roller", x, y: GROUND_ROW * TILE - 16, r: 16, vx: 0, vy: 0, angle: 0, active: false, alive: true };
      case "drone":
        return { type: "drone", x, y: (GROUND_ROW - s.height) * TILE + TILE / 2, r: 13, active: false, alive: true, t: Math.random() * 6 };
      case "boss": {
        const big = s.variant === 2;
        return {
          type: "boss",
          variant: s.variant,
          name: big ? "SPIKE LORD" : "KING BLOB",
          x, y: GROUND_ROW * TILE - 36,
          hw: 42, hh: 36,
          vx: 0, vy: 0,
          hp: big ? 5 : 3,
          maxHp: big ? 5 : 3,
          timer: 90,
          invuln: 0,
          onGround: true,
          alive: true,
        };
      }
    }
  }

  function loadLevel(i) {
    levelIndex = i;
    level = buildLevel(LEVELS[i]);
    player = newPlayer();
    enemies = level.spawns.map(spawnEnemy);
    camX = 0;
    particles = [];
    jumpBuffer = 0;
    levelTimer = 0;
    shake = 0;
  }

  function startGame() {
    deaths = 0;
    time = 0;
    // ?level=N in the URL jumps straight to level N (handy for demos)
    const n = parseInt(new URLSearchParams(location.search).get("level"), 10);
    loadLevel(n >= 1 && n <= LEVELS.length ? n - 1 : 0);
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

  function forEachTile(x, y, hw, hh, fn) {
    const c0 = Math.floor((x - hw) / TILE);
    const c1 = Math.floor((x + hw - 0.001) / TILE);
    const r0 = Math.floor((y - hh) / TILE);
    const r1 = Math.floor((y + hh - 0.001) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) fn(c, r, tileAt(c, r));
    }
  }

  // Moves a box-shaped body with tile collisions. Returns what it hit.
  function moveBody(b, hw, hh) {
    let hitX = false;
    let onGround = false;
    b.x += b.vx;
    forEachTile(b.x, b.y, hw, hh, (c, r, ch) => {
      if (!isSolid(ch)) return;
      if (b.vx > 0) b.x = c * TILE - hw;
      else if (b.vx < 0) b.x = (c + 1) * TILE + hw;
      b.vx = 0;
      hitX = true;
    });
    b.y += b.vy;
    forEachTile(b.x, b.y, hw, hh, (c, r, ch) => {
      if (!isSolid(ch)) return;
      if (b.vy > 0) {
        b.y = r * TILE - hh;
        onGround = true;
      } else if (b.vy < 0) {
        b.y = (r + 1) * TILE + hh;
      }
      b.vy = 0;
    });
    return { hitX, onGround };
  }

  function circleHitsRect(cx, cy, cr, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy < cr * cr;
  }

  function circlesTouch(x1, y1, r1, x2, y2, r2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy < (r1 + r2) * (r1 + r2);
  }

  // ---------- Update ----------
  function updatePlayer() {
    const p = player;
    const left = keys["ArrowLeft"];
    const right = keys["ArrowRight"];
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    if (dir !== 0) p.facing = dir;

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

    const wasOnGround = p.onGround;
    const fallSpeed = p.vy;
    p.onGround = moveBody(p, R, R).onGround;

    if (p.onGround && !wasOnGround && fallSpeed > 4) {
      p.squash = Math.min(0.35, fallSpeed / 30);
      puff(p.x, p.y + R, 5, "#d9c3ff");
    }
    p.squash *= 0.8;

    // Rolling
    p.angle += p.vx / R;

    // Hazards: spikes
    let hit = false;
    forEachTile(p.x, p.y, R, R, (c, r, ch) => {
      if (ch !== "^") return;
      if (circleHitsRect(p.x, p.y, R - 2, c * TILE + 9, r * TILE + 14, TILE - 18, TILE - 14)) hit = true;
    });
    if (hit) return die();

    // Hazards: pits
    if (p.y - R > ROWS * TILE) return die(true);

    // Goal
    if (p.x >= level.flagX - 4) {
      levelDone(level.flagX, GROUND_ROW * TILE - TILE * 2);
    }
  }

  function bounceOff() {
    const jumpHeld = keys["ArrowUp"] || keys[" "];
    player.vy = jumpHeld ? -11 : -8;
    player.squash = -0.25;
  }

  function updateSlime(e) {
    e.x += e.vx;
    const dir = Math.sign(e.vx);
    const aheadCol = Math.floor((e.x + dir * (e.hw + 2)) / TILE);
    const footRow = Math.floor(e.y / TILE);
    const front = tileAt(aheadCol, footRow);
    if (isSolid(front) || front === "^" || !isSolid(tileAt(aheadCol, footRow + 1))) e.vx = -e.vx;

    const p = player;
    if (!circleHitsRect(p.x, p.y, R, e.x - e.hw, e.y - e.hh, e.hw * 2, e.hh * 2)) return;
    if (p.vy > 0 && p.y < e.y - e.hh + 4) {
      e.alive = false;
      bounceOff();
      splat(e.x, e.y, "#7bed9f");
    } else {
      die();
    }
  }

  function updateRoller(e) {
    const p = player;
    const dist = Math.abs(p.x - e.x);
    if (!e.active && dist < 480) e.active = true;

    if (e.active) {
      const dir = Math.sign(p.x - e.x) || 1;
      e.vx += dir * 0.15;
      e.vx = Math.max(-3.2, Math.min(3.2, e.vx));
    }
    e.vy = Math.min(MAX_FALL, e.vy + GRAVITY);
    const res = moveBody(e, e.r, e.r);
    e.angle += e.vx / e.r;

    if (e.temp) {
      e.life--;
      if (res.hitX || e.life <= 0) {
        e.alive = false;
        puff(e.x, e.y, 10, "#b8b8d0");
        return;
      }
    }
    if (e.y - e.r > ROWS * TILE) {
      e.alive = false;
      return;
    }
    if (circlesTouch(p.x, p.y, R - 2, e.x, e.y, e.r - 2)) die();
  }

  function updateDrone(e) {
    const p = player;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 450) e.active = true;
    else if (dist > 800) e.active = false;

    e.t += 0.05;
    if (e.active && dist > 1) {
      e.x += (dx / dist) * 1.7;
      e.y += (dy / dist) * 1.7;
    }
    e.y += Math.sin(e.t * 2) * 0.4;
    if (circlesTouch(p.x, p.y, R - 2, e.x, e.y, e.r - 1)) die();
  }

  function updateBoss(e) {
    const p = player;
    const wasOnGround = e.onGround;
    if (e.invuln > 0) e.invuln--;

    if (e.onGround) {
      e.vx *= 0.8;
      e.timer--;
      if (e.timer <= 0) {
        const rage = e.maxHp - e.hp;
        e.vy = e.variant === 2 ? -13 : -12;
        e.vx = (Math.sign(p.x - e.x) || 1) * (3 + rage * 0.6);
        e.timer = (e.variant === 2 ? 70 : 90) - rage * 8;
      }
    }
    e.vy = Math.min(MAX_FALL, e.vy + GRAVITY);
    e.onGround = moveBody(e, e.hw, e.hh).onGround;

    if (e.onGround && !wasOnGround) {
      shake = 12;
      puff(e.x - e.hw, e.y + e.hh, 8, "#d9c3ff");
      puff(e.x + e.hw, e.y + e.hh, 8, "#d9c3ff");
      if (e.variant === 2) {
        // Spike Lord launches spiked wheels toward the ball when it lands
        const dir = Math.sign(p.x - e.x) || 1;
        enemies.push({
          type: "roller",
          x: e.x + dir * (e.hw + 20), y: e.y + e.hh - 16, r: 16,
          vx: dir * 3, vy: -4, angle: 0, active: true, alive: true, temp: true, life: 300,
        });
      }
    }

    if (!circleHitsRect(p.x, p.y, R, e.x - e.hw, e.y - e.hh, e.hw * 2, e.hh * 2)) return;
    const stomp = p.vy > 0 && p.y < e.y - e.hh + 8;
    if (stomp && e.invuln === 0) {
      e.hp--;
      e.invuln = 60;
      shake = 16;
      player.vy = -12;
      splat(p.x, p.y + R, e.variant === 2 ? "#ff4d6d" : "#b388ff");
      if (e.hp <= 0) {
        e.alive = false;
        burst(e.x, e.y, 60);
        levelDone(e.x, e.y);
      }
    } else if (e.invuln > 0) {
      // Freshly hit boss knocks the ball away instead of killing it
      player.vx = (Math.sign(p.x - e.x) || 1) * 6;
      player.vy = Math.min(player.vy, -6);
    } else {
      die();
    }
  }

  function updateEnemies() {
    for (const e of enemies) {
      if (!e.alive || state !== "play") continue;
      if (e.type === "slime") updateSlime(e);
      else if (e.type === "roller") updateRoller(e);
      else if (e.type === "drone") updateDrone(e);
      else if (e.type === "boss") updateBoss(e);
    }
    enemies = enemies.filter((e) => e.alive);
  }

  function levelDone(x, y) {
    if (state !== "play") return;
    state = "levelDone";
    stateTimer = 0;
    confetti(x, y);
  }

  function die(fell) {
    if (state !== "play") return;
    deaths++;
    state = "dead";
    stateTimer = 0;
    shake = 10;
    const y = fell ? ROWS * TILE - 10 : player.y;
    burst(player.x, y, 30);
  }

  function update() {
    frame++;
    if (state === "play" || state === "dead") time += 1 / 60;
    if (state !== "title") levelTimer++;

    if (state === "play") {
      updatePlayer();
      updateEnemies();
    } else if (state === "dead") {
      stateTimer++;
      if (stateTimer > 45) {
        loadLevel(levelIndex);
        state = "play";
      }
    } else if (state === "levelDone") {
      stateTimer++;
      // let the ball roll out a little
      player.vx *= 0.92;
      player.x += player.vx;
      player.angle += player.vx / R;
      if (stateTimer > 100) {
        if (levelIndex + 1 < LEVELS.length) {
          loadLevel(levelIndex + 1);
          state = "play";
        } else {
          state = "win";
          stateTimer = 0;
        }
      }
    } else if (state === "win") {
      stateTimer++;
      if (stateTimer % 20 === 0) confetti(camX + Math.random() * W, 0);
    }

    // Camera
    if (level) {
      const target = Math.max(0, Math.min(level.width * TILE - W, player.x - W * 0.4));
      camX += (target - camX) * 0.12;
    }
    shake *= 0.85;

    // Background bokeh drift
    for (const b of bokeh) {
      b.y -= b.s;
      if (b.y < -20) {
        b.y = H + 20;
        b.x = Math.random() * W;
      }
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

  function burst(x, y, n) {
    for (let i = 0; i < n; i++) {
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
        color: Math.random() < 0.5 ? "#ff3b3b" : "#ffd23f",
      });
    }
  }

  function splat(x, y, color) {
    for (let i = 0; i < 14; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 6,
        vy: -Math.random() * 4,
        g: 0.3,
        life: 30 + Math.random() * 15,
        max: 45,
        size: 3 + Math.random() * 4,
        color,
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

  // ---------- Background (animated sunset) ----------
  const bokeh = Array.from({ length: 36 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 2 + Math.random() * 6,
    s: 0.15 + Math.random() * 0.5,
    par: 0.05 + Math.random() * 0.3,
    ph: Math.random() * Math.PI * 2,
  }));

  const MOUNTAINS = [
    { par: 0.1, base: 330, amp: 70, f1: 0.004, f2: 0.011, seed: 1, top: "#5a3a8a", bot: "#3a2566" },
    { par: 0.25, base: 380, amp: 55, f1: 0.006, f2: 0.017, seed: 4, top: "#40296b", bot: "#28184a" },
    { par: 0.45, base: 425, amp: 35, f1: 0.009, f2: 0.023, seed: 9, top: "#2a1a4d", bot: "#180e30" },
  ];

  function drawBackground() {
    const t = frame / 60;
    const hs = Math.sin(t * 0.08) * 18;

    // Slowly shifting sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `hsl(${250 + hs}, 60%, 16%)`);
    sky.addColorStop(0.45, `hsl(${290 + hs}, 55%, 35%)`);
    sky.addColorStop(0.8, `hsl(${340 + hs}, 75%, 58%)`);
    sky.addColorStop(1, `hsl(${25 + hs}, 90%, 65%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Aurora ribbons
    for (let i = 0; i < 3; i++) {
      const baseY = 60 + i * 35;
      const grad = ctx.createLinearGradient(0, baseY - 30, 0, baseY + 80);
      const hue = 150 + i * 40 + hs;
      grad.addColorStop(0, `hsla(${hue}, 90%, 60%, 0)`);
      grad.addColorStop(0.4, `hsla(${hue}, 90%, 60%, 0.18)`);
      grad.addColorStop(1, `hsla(${hue}, 90%, 60%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 20) {
        const wx = x + camX * 0.05;
        const y = baseY + Math.sin(wx * 0.006 + t * 0.6 + i * 1.7) * 25 + Math.sin(wx * 0.013 - t * 0.4 + i) * 12;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let x = W; x >= 0; x -= 20) {
        const wx = x + camX * 0.05;
        const y = baseY + 70 + Math.sin(wx * 0.005 + t * 0.5 + i * 2.3) * 20;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Glowing sun with pulsing halo
    const sx = W * 0.68 - camX * 0.03;
    const sy = 300;
    const pulse = 1 + Math.sin(t * 1.5) * 0.05;
    const halo = ctx.createRadialGradient(sx, sy, 20, sx, sy, 220 * pulse);
    halo.addColorStop(0, "rgba(255, 200, 120, 0.55)");
    halo.addColorStop(1, "rgba(255, 80, 150, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(sx - 240, sy - 240, 480, 480);
    ctx.restore();

    const core = ctx.createLinearGradient(0, sy - 80, 0, sy + 80);
    core.addColorStop(0, "#fff3b0");
    core.addColorStop(1, "#ff5e8a");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(sx, sy, 80, 0, Math.PI * 2);
    ctx.fill();

    // Layered parallax mountains
    for (const m of MOUNTAINS) {
      const g = ctx.createLinearGradient(0, m.base - m.amp * 2, 0, H);
      g.addColorStop(0, m.top);
      g.addColorStop(1, m.bot);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) {
        const wx = x + camX * m.par;
        const y = m.base - Math.abs(Math.sin(wx * m.f1 + m.seed)) * m.amp - Math.sin(wx * m.f2 + m.seed * 2) * m.amp * 0.35;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }

    // Floating glowing particles
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const b of bokeh) {
      const x = (((b.x - camX * b.par) % W) + W) % W;
      const a = 0.25 + Math.sin(t * 2 + b.ph) * 0.2;
      ctx.fillStyle = `rgba(255, 210, 255, ${a})`;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- Tiles ----------
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
    ctx.fillStyle = "#3b2a4a";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#33243f";
    ctx.fillRect(x + 6, y + 18, 6, 6);
    ctx.fillRect(x + 24, y + 28, 6, 6);
    if (top) {
      ctx.fillStyle = "#1fc98e";
      ctx.fillRect(x, y, TILE, 10);
      ctx.fillStyle = "#7fffd4";
      ctx.fillRect(x, y, TILE, 3);
    }
  }

  function drawWall(x, y) {
    ctx.fillStyle = "#56607e";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = "#3c4460";
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
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x + 2, y + 2, TILE - 4, 3);
  }

  function drawPlatform(x, y) {
    ctx.fillStyle = "#7c5cff";
    ctx.fillRect(x, y, TILE, 14);
    ctx.fillStyle = "#5438c9";
    ctx.fillRect(x, y + 10, TILE, 4);
    ctx.fillStyle = "#c3b5ff";
    ctx.fillRect(x, y, TILE, 3);
  }

  function drawSpike(x, y) {
    const n = 2;
    const w = TILE / n;
    for (let i = 0; i < n; i++) {
      const sx = x + i * w;
      ctx.fillStyle = "#e3e8f0";
      ctx.beginPath();
      ctx.moveTo(sx + 2, y + TILE);
      ctx.lineTo(sx + w / 2, y + 10);
      ctx.lineTo(sx + w - 2, y + TILE);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#9aa5b8";
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
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.moveTo(poleX + 2, top + 4);
    ctx.quadraticCurveTo(poleX + 20, top + 4 + wave, poleX + 40, top + 16);
    ctx.quadraticCurveTo(poleX + 20, top + 28 - wave, poleX + 2, top + 30);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- Characters ----------
  function drawEyes(x, y, size, lookX, lookY, blink, angry) {
    const gap = size * 1.1;
    for (const side of [-1, 1]) {
      const ex = x + side * gap;
      if (blink) {
        ctx.strokeStyle = "#1a1a2e";
        ctx.lineWidth = Math.max(2, size * 0.35);
        ctx.beginPath();
        ctx.moveTo(ex - size, y);
        ctx.lineTo(ex + size, y);
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ex, y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a1a2e";
      ctx.beginPath();
      ctx.arc(ex + lookX * size * 0.4, y + lookY * size * 0.4, size * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ex + lookX * size * 0.4 - size * 0.18, y + lookY * size * 0.4 - size * 0.2, size * 0.16, 0, Math.PI * 2);
      ctx.fill();
      if (angry) {
        ctx.strokeStyle = "#1a1a2e";
        ctx.lineWidth = Math.max(2, size * 0.35);
        ctx.beginPath();
        ctx.moveTo(ex - side * size * 1.1, y - size * 1.5);
        ctx.lineTo(ex + side * size * 0.9, y - size * 0.9);
        ctx.stroke();
      }
    }
  }

  function drawPlayer() {
    if (state === "dead") return;
    const p = player;
    const x = p.x - camX;
    const sx = 1 + p.squash;
    const sy = 1 - p.squash;

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(x, p.y + R + 2, R * 0.9, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, p.y + R * (1 - sy));
    ctx.scale(sx, sy);

    // Glow
    ctx.fillStyle = "rgba(255, 60, 60, 0.18)";
    ctx.beginPath();
    ctx.arc(0, 0, R + 6, 0, Math.PI * 2);
    ctx.fill();

    // Red rolling body
    ctx.save();
    ctx.rotate(p.angle);
    const g = ctx.createRadialGradient(-4, -5, 2, 0, 0, R);
    g.addColorStop(0, "#ff8a8a");
    g.addColorStop(0.5, "#e63946");
    g.addColorStop(1, "#9d0208");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R - 3, 2.2, 2.9);
    ctx.stroke();
    ctx.restore();

    // Eyes stay upright and look where the ball is going
    const lookX = Math.max(-1, Math.min(1, p.vx / 3 || p.facing * 0.5));
    const lookY = Math.max(-1, Math.min(1, p.vy / 8));
    const blink = (frame + 90) % 180 < 7;
    drawEyes(p.facing * 3, -3, 4.2, lookX, lookY, blink, false);

    ctx.restore();
  }

  function drawSlime(e) {
    const x = e.x - camX;
    const bob = Math.sin(frame * 0.2 + e.x) * 2;
    const g = ctx.createLinearGradient(0, e.y - e.hh, 0, e.y + e.hh);
    g.addColorStop(0, "#9cffb8");
    g.addColorStop(1, "#21a35b");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - e.hw, e.y + e.hh);
    ctx.quadraticCurveTo(x - e.hw, e.y - e.hh - bob, x, e.y - e.hh - bob);
    ctx.quadraticCurveTo(x + e.hw, e.y - e.hh - bob, x + e.hw, e.y + e.hh);
    ctx.closePath();
    ctx.fill();
    drawEyes(x, e.y - 2, 3.5, Math.sign(e.vx), 0, false, true);
  }

  function drawSpikedCircle(x, y, r, angle, spikes, body, spikeColor) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = spikeColor;
    ctx.beginPath();
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const a1 = a - 0.25;
      const a2 = a + 0.25;
      ctx.moveTo(Math.cos(a1) * r * 0.8, Math.sin(a1) * r * 0.8);
      ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35);
      ctx.lineTo(Math.cos(a2) * r * 0.8, Math.sin(a2) * r * 0.8);
    }
    ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRoller(e) {
    const x = e.x - camX;
    drawSpikedCircle(x, e.y, e.r - 3, e.angle, 8, "#3d3d5c", "#d6d6e6");
    ctx.fillStyle = e.active ? "#ff3b3b" : "#7a7a99";
    ctx.beginPath();
    ctx.arc(x, e.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDrone(e) {
    const x = e.x - camX;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = e.active ? "rgba(255, 50, 90, 0.25)" : "rgba(160, 120, 255, 0.2)";
    ctx.beginPath();
    ctx.arc(x, e.y, e.r + 9 + Math.sin(e.t * 4) * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawSpikedCircle(x, e.y, e.r - 2, e.t, 6, "#4b2a7a", "#c9a8ff");
    // Eye that tracks the ball
    const a = Math.atan2(player.y - e.y, player.x - e.x);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, e.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = e.active ? "#ff1f4b" : "#2a1a4d";
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 2, e.y + Math.sin(a) * 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBoss(e) {
    if (e.invuln > 0 && Math.floor(e.invuln / 4) % 2 === 0) return; // hit flash
    const x = e.x - camX;
    const stretch = e.onGround ? 1 : 1 + Math.min(0.15, Math.abs(e.vy) / 60);
    const hw = e.hw / stretch;
    const hh = e.hh * stretch;
    const bottom = e.y + e.hh;
    const lord = e.variant === 2;

    // Spikes on Spike Lord's back
    if (lord) {
      ctx.fillStyle = "#d6d6e6";
      for (let i = -2; i <= 2; i++) {
        const bx = x + i * hw * 0.38;
        ctx.beginPath();
        ctx.moveTo(bx - 9, bottom - hh * 1.7);
        ctx.lineTo(bx, bottom - hh * 2 - 16 + Math.abs(i) * 6);
        ctx.lineTo(bx + 9, bottom - hh * 1.7);
        ctx.fill();
      }
    }

    const g = ctx.createLinearGradient(0, bottom - hh * 2, 0, bottom);
    g.addColorStop(0, lord ? "#ff4d6d" : "#c9a8ff");
    g.addColorStop(1, lord ? "#6a040f" : "#5e2bb8");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - hw, bottom);
    ctx.bezierCurveTo(x - hw - 6, bottom - hh * 2.1, x + hw + 6, bottom - hh * 2.1, x + hw, bottom);
    ctx.closePath();
    ctx.fill();

    // Crown
    const cy = bottom - hh * 1.62;
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.moveTo(x - 20, cy);
    ctx.lineTo(x - 20, cy - 16);
    ctx.lineTo(x - 10, cy - 7);
    ctx.lineTo(x, cy - 20);
    ctx.lineTo(x + 10, cy - 7);
    ctx.lineTo(x + 20, cy - 16);
    ctx.lineTo(x + 20, cy);
    ctx.closePath();
    ctx.fill();

    const look = Math.max(-1, Math.min(1, (player.x - e.x) / 100));
    drawEyes(x, bottom - hh * 1.05, 8, look, 0.3, false, true);

    // Mouth
    ctx.fillStyle = "#1a1a2e";
    ctx.beginPath();
    ctx.ellipse(x, bottom - hh * 0.45, 14, 6 + Math.abs(Math.sin(frame * 0.1)) * 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 9, bottom - hh * 0.45 - 5, 5, 5);
    ctx.fillRect(x + 4, bottom - hh * 0.45 - 5, 5, 5);
  }

  function drawEnemies() {
    for (const e of enemies) {
      if (e.x < camX - 120 || e.x > camX + W + 120) continue;
      if (e.type === "slime") drawSlime(e);
      else if (e.type === "roller") drawRoller(e);
      else if (e.type === "drone") drawDrone(e);
      else if (e.type === "boss") drawBoss(e);
    }
  }

  function drawParticles() {
    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - camX - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- HUD & screens ----------
  function formatTime(t) {
    return t.toFixed(1) + "s";
  }

  function text(str, x, y, size, color, align = "center") {
    ctx.font = `bold ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillText(str, x + 2, y + 3);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = "rgba(16, 12, 40, 0.55)";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
  }

  function drawHUD() {
    panel(12, 12, 360, 40);
    text(`Level ${levelIndex + 1}/${LEVELS.length}: ${level.name}`, 24, 32, 18, "#ffffff", "left");
    panel(W - 262, 12, 250, 40);
    text(`Time ${formatTime(time)}`, W - 250, 32, 18, "#ffd23f", "left");
    text(`Deaths ${deaths}`, W - 24, 32, 18, "#ff8c8c", "right");

    const boss = enemies.find((e) => e.type === "boss");
    if (boss) {
      const bw = 300;
      const bx = W / 2 - bw / 2;
      panel(bx - 10, 62, bw + 20, 44);
      text(boss.name, W / 2, 76, 14, "#ffffff");
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(bx, 88, bw, 10);
      ctx.fillStyle = boss.variant === 2 ? "#ff4d6d" : "#b388ff";
      ctx.fillRect(bx, 88, (bw * boss.hp) / boss.maxHp, 10);
    }

    // Level intro banner
    if (levelTimer < 100 && state === "play") {
      const a = Math.min(1, (100 - levelTimer) / 30);
      ctx.globalAlpha = a;
      text(level.name, W / 2, H / 2 - 60, 40, level.boss ? "#ff4d6d" : "#ffffff");
      if (level.boss) text("Jump on its head!", W / 2, H / 2 - 18, 22, "#ffd23f");
      ctx.globalAlpha = 1;
    }
  }

  function overlay(alpha) {
    ctx.fillStyle = `rgba(16, 12, 40, ${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTitle() {
    drawBackground();
    overlay(0.35);
    text("BALL RUNNER", W / 2, 120, 64, "#ff4d6d");
    text("Roll, jump and reach the flag in all 6 levels!", W / 2, 185, 22, "#ffffff");
    text("← → move     ↑ / Space jump     R restart level", W / 2, 230, 20, "#e8ecff");
    text("Stomp slimes · dodge spikes, pits, wheels and mines · bosses on levels 3 and 6", W / 2, 268, 18, "#e8ecff");
    if (Math.floor(frame / 30) % 2 === 0) {
      text("Press Space or Enter to start", W / 2, 340, 28, "#ffd23f");
    }
    // Bouncing demo ball with eyes
    const by = 430 - Math.abs(Math.sin(frame * 0.06)) * 50;
    ctx.fillStyle = "#e63946";
    ctx.beginPath();
    ctx.arc(W / 2, by, R + 4, 0, Math.PI * 2);
    ctx.fill();
    drawEyes(W / 2 + 3, by - 4, 5, Math.sin(frame * 0.03), 0, frame % 180 < 7, false);
  }

  function render() {
    if (state === "title") return drawTitle();

    drawBackground();

    ctx.save();
    if (shake > 0.5) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawTiles();
    drawEnemies();
    drawPlayer();
    drawParticles();
    ctx.restore();

    drawHUD();

    if (state === "dead") {
      text("Ouch!", W / 2, H / 2 - 20, 48, "#ff6b6b");
    } else if (state === "levelDone") {
      const last = levelIndex + 1 >= LEVELS.length;
      const msg = level.boss ? "Boss defeated!" : last ? "Final level cleared!" : "Level complete!";
      text(msg, W / 2, H / 2 - 40, 48, "#7fffd4");
    } else if (state === "win") {
      overlay(0.55);
      text("YOU WIN!", W / 2, 140, 72, "#ffd23f");
      text(`Time: ${formatTime(time)}`, W / 2, 230, 32, "#ffffff");
      text(`Deaths: ${deaths}`, W / 2, 275, 32, "#ff8c8c");
      if (Math.floor(frame / 30) % 2 === 0) {
        text("Press Space or Enter to play again", W / 2, 370, 26, "#ff4d6d");
      }
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
