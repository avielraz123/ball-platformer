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
  //   t    1 column of ground with a Triple Shot weapon pickup
  //   m    1 column of ground with a Bomb Launcher weapon pickup
  //   BV   boss (V = 1 King Blob, 2 Spike Lord) - beat it to clear the level
  //   S    player start (on ground)
  //   F    goal flag (on ground)
  const LEVELS = [
    {
      name: "First Roll",
      layout: "g3 S g2 t1 g2 w1 g4 p2 g3 e1 g4 s1 g4 w2 g4 p3 g3 r1 g4 F g5",
    },
    {
      name: "Spike Valley",
      layout: "g2 S g2 t1 g1 s3 g3 e1 g3 w2 g2 s2 g3 p3 g3 d2 g3 w1 w2 p3 g3 p2 o2.2 p2 g3 e1 g2 s1 g1 s1 g3 r1 g3 F g5",
    },
    {
      name: "BOSS: King Blob",
      layout: "g2 S g2 m1 g17 B1 g2",
    },
    {
      name: "Rolling Thunder",
      layout: "g2 S g2 t1 g1 r1 g4 w2 s2 g3 p4 g2 e1 g3 s3 g2 d3 g2 p2 o1.1 p2 g2 W2 g1 s1 w2 g3 r1 g3 F g5",
    },
    {
      name: "The Gauntlet",
      layout: "g2 S g2 m1 g1 e1 g3 p3 g2 s2 g1 s2 g3 d2 g3 p2 o2.2 p1 o2.2 p3 g2 r1 g3 w2 g3 e1 g2 s3 g3 d3 g2 W2 g3 F g5",
    },
    {
      name: "BOSS: Spike Lord",
      layout: "g2 S g2 m1 g2 t1 g14 B2 g2",
    },
  ];

  // Ball skins. c = [highlight, main, shadow] gradient colors.
  const SKINS = [
    { name: "Classic Red", c: ["#ff8a8a", "#e63946", "#9d0208"] },
    { name: "Ocean Blue", c: ["#8ad8ff", "#2f80ed", "#0b3d91"] },
    { name: "Lime", c: ["#d4ff8a", "#5cc93b", "#1e6b12"] },
    { name: "Gold", c: ["#fff3b0", "#f5b700", "#8a5a00"], shine: true },
    { name: "Soccer", c: ["#ffffff", "#f2f2f2", "#b8b8b8"], pattern: "soccer" },
    { name: "Watermelon", c: ["#a8f08a", "#2e9e3e", "#145c1f"], pattern: "stripes" },
    { name: "Ninja", c: ["#5a5a6e", "#2b2b3a", "#0e0e16"], extra: "headband" },
    { name: "Rainbow", rainbow: true },
  ];

  function loadSkin() {
    try {
      const i = parseInt(localStorage.getItem("ballRunnerSkin"), 10);
      return i >= 0 && i < SKINS.length ? i : 0;
    } catch {
      return 0;
    }
  }

  function setSkin(i) {
    skinIndex = (i + SKINS.length) % SKINS.length;
    try {
      localStorage.setItem("ballRunnerSkin", String(skinIndex));
    } catch {
      // storage unavailable - skin just won't be remembered
    }
  }

  function buildLevel(def) {
    const cols = [];
    const spawns = [];
    const pickups = [];
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
        case "t":
        case "m":
          pickups.push({ weapon: type === "t" ? "triple" : "bomb", col: cols.length });
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
      pickups,
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
  let doubleJump = true; // toggled with D
  let skinIndex = loadSkin(); // changed with S (or arrows on the title screen)
  let shots = [];
  let items = [];
  let popups = [];
  let fireCooldown = 0;

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
      airJumps: 0,
      squash: 0,
      weapon: "blaster",
      ammo: Infinity,
      recoil: 0,
    };
  }

  function spawnEnemy(s) {
    const x = s.col * TILE + TILE / 2;
    switch (s.type) {
      case "slime":
        return { type: "slime", x, y: GROUND_ROW * TILE - 11, hw: 15, hh: 11, vx: -1.2, hp: 1, alive: true };
      case "roller":
        return { type: "roller", x, y: GROUND_ROW * TILE - 16, r: 16, vx: 0, vy: 0, angle: 0, active: false, hp: 3, alive: true };
      case "drone":
        return { type: "drone", x, y: (GROUND_ROW - s.height) * TILE + TILE / 2, r: 13, active: false, hp: 2, alive: true, t: Math.random() * 6 };
      case "boss": {
        const big = s.variant === 2;
        return {
          type: "boss",
          variant: s.variant,
          name: big ? "SPIKE LORD" : "KING BLOB",
          x, y: GROUND_ROW * TILE - 36,
          hw: 42, hh: 36,
          vx: 0, vy: 0,
          // A stomp deals 10 damage, a bolt 1, a bomb 4
          hp: big ? 50 : 30,
          maxHp: big ? 50 : 30,
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
    shots = [];
    popups = [];
    fireCooldown = 0;
    items = level.pickups.map((it) => ({
      weapon: it.weapon,
      x: it.col * TILE + TILE / 2,
      y: (GROUND_ROW - 1) * TILE + 8,
      t: Math.random() * 6,
      alive: true,
    }));
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

    const k = e.key.toLowerCase();
    if (k === "d" && !e.repeat) doubleJump = !doubleJump;
    if (k === "s" && !e.repeat) {
      setSkin(skinIndex + 1);
      if (state === "play") {
        popups = popups.filter((pp) => !pp.skin);
        popup(SKINS[skinIndex].name, player.x, player.y - 34, "#ffffff");
        popups[popups.length - 1].skin = true;
      }
    }

    if (state === "title" && !e.repeat) {
      if (e.key === "ArrowLeft") setSkin(skinIndex - 1);
      if (e.key === "ArrowRight") setSkin(skinIndex + 1);
    }
    if (state === "title" || state === "win") {
      if (!e.repeat && (e.key === "Enter" || isJump)) startGame();
      return;
    }
    if (isJump && !e.repeat) jumpBuffer = BUFFER_FRAMES;
    if (k === "r" && state === "play") die();
    if (k === "n" && !e.repeat) skipLevel(1);
    if (k === "b" && !e.repeat) skipLevel(-1);
  });

  // Skip forward/back a level. Skipping past the last level ends the game.
  function skipLevel(step) {
    const next = levelIndex + step;
    if (next < 0) return;
    if (next >= LEVELS.length) {
      state = "win";
      stateTimer = 0;
      return;
    }
    loadLevel(next);
    state = "play";
  }

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

    if (p.onGround) p.airJumps = doubleJump ? 1 : 0;

    if (jumpBuffer > 0 && p.coyote > 0) {
      p.vy = JUMP_V;
      p.coyote = 0;
      jumpBuffer = 0;
      p.onGround = false;
      p.squash = -0.25;
      puff(p.x, p.y + R, 6, "#ffffff");
    } else if (jumpBuffer > 0 && p.airJumps > 0) {
      // Double jump in mid-air
      p.vy = JUMP_V * 0.9;
      p.airJumps--;
      jumpBuffer = 0;
      p.squash = -0.25;
      ring(p.x, p.y + R);
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
      puff(p.x, p.y + R, 5, "#ffffff");
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
    player.airJumps = doubleJump ? 1 : 0;
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
        const rage = (e.maxHp - e.hp) / 10;
        e.vy = e.variant === 2 ? -13 : -12;
        e.vx = (Math.sign(p.x - e.x) || 1) * (3 + rage * 0.6);
        e.timer = (e.variant === 2 ? 70 : 90) - rage * 8;
      }
    }
    e.vy = Math.min(MAX_FALL, e.vy + GRAVITY);
    e.onGround = moveBody(e, e.hw, e.hh).onGround;

    if (e.onGround && !wasOnGround) {
      shake = 12;
      puff(e.x - e.hw, e.y + e.hh, 8, "#ffffff");
      puff(e.x + e.hw, e.y + e.hh, 8, "#ffffff");
      if (e.variant === 2) {
        // Spike Lord launches spiked wheels toward the ball when it lands
        const dir = Math.sign(p.x - e.x) || 1;
        enemies.push({
          type: "roller",
          x: e.x + dir * (e.hw + 20), y: e.y + e.hh - 16, r: 16,
          vx: dir * 3, vy: -4, angle: 0, active: true, hp: 3, alive: true, temp: true, life: 300,
        });
      }
    }

    if (!circleHitsRect(p.x, p.y, R, e.x - e.hw, e.y - e.hh, e.hw * 2, e.hh * 2)) return;
    const stomp = p.vy > 0 && p.y < e.y - e.hh + 8;
    if (stomp && e.invuln === 0) {
      e.invuln = 60;
      shake = 16;
      player.vy = -12;
      player.airJumps = doubleJump ? 1 : 0;
      splat(p.x, p.y + R, e.variant === 2 ? "#ff4d6d" : "#b388ff");
      damage(e, 10);
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
      if (e.flash > 0) e.flash--;
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
      if (state === "play") updateWeapons();
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

    for (const pp of popups) {
      pp.y -= 0.6;
      pp.life--;
    }
    popups = popups.filter((pp) => pp.life > 0);
  }

  // ---------- Weapons ----------
  const WEAPONS = {
    blaster: { name: "Blaster", ammo: Infinity, cooldown: 14, color: "#ffd23f" },
    triple: { name: "Triple Shot", ammo: 20, cooldown: 16, color: "#33b5ff" },
    bomb: { name: "Bomb Launcher", ammo: 8, cooldown: 30, color: "#ff7b00" },
  };

  function fire() {
    const p = player;
    const w = WEAPONS[p.weapon];
    const dir = p.facing;
    const x = p.x + dir * (R + 6);
    const y = p.y + 4;
    if (p.weapon === "bomb") {
      shots.push({ kind: "bomb", x, y, vx: dir * 6 + p.vx * 0.5, vy: -7, r: 7, life: 150 });
    } else {
      const spread = p.weapon === "triple" ? [-2, 0, 2] : [0];
      for (const vy of spread) {
        shots.push({ kind: "bolt", x, y, vx: dir * 10, vy, r: 5, dmg: 1, life: 70, color: w.color });
      }
    }
    fireCooldown = w.cooldown;
    p.recoil = 5;
    if (p.ammo !== Infinity && --p.ammo <= 0) {
      p.weapon = "blaster";
      p.ammo = Infinity;
      popup("Out of ammo!", p.x, p.y - 34, "#ff8c8c");
    }
  }

  function enemyHit(e, x, y, r) {
    if (e.type === "slime" || e.type === "boss") {
      return circleHitsRect(x, y, r, e.x - e.hw, e.y - e.hh, e.hw * 2, e.hh * 2);
    }
    return circlesTouch(x, y, r, e.x, e.y, e.r);
  }

  function damage(e, amount) {
    if (!e.alive) return;
    e.hp -= amount;
    e.flash = 6;
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    e.alive = false;
    if (e.type === "boss") {
      burst(e.x, e.y, 60);
      shake = 16;
      levelDone(e.x, e.y);
    } else {
      const color = e.type === "slime" ? "#7bed9f" : e.type === "drone" ? "#c9a8ff" : "#b8b8d0";
      splat(e.x, e.y, color);
    }
  }

  function explode(x, y) {
    shake = Math.max(shake, 8);
    burst(x, y, 24);
    for (const e of enemies) {
      if (e.alive && enemyHit(e, x, y, 70)) damage(e, 4);
    }
  }

  function updateWeapons() {
    const p = player;
    if (fireCooldown > 0) fireCooldown--;
    if (p.recoil > 0) p.recoil--;
    if ((keys["x"] || keys["X"] || keys["f"] || keys["F"]) && fireCooldown === 0) fire();

    for (const sh of shots) {
      sh.x += sh.vx;
      sh.y += sh.vy;
      if (sh.kind === "bomb") sh.vy += 0.35;
      sh.life--;
      let hit = sh.life <= 0 || sh.y > ROWS * TILE || isSolid(tileAt(Math.floor(sh.x / TILE), Math.floor(sh.y / TILE)));
      if (!hit) {
        for (const e of enemies) {
          if (e.alive && enemyHit(e, sh.x, sh.y, sh.r)) {
            if (sh.kind === "bolt") damage(e, sh.dmg);
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        sh.dead = true;
        if (sh.kind === "bomb") explode(sh.x, sh.y);
        else puff(sh.x, sh.y, 4, sh.color);
      }
    }
    shots = shots.filter((sh) => !sh.dead);

    // Weapon pickups
    for (const it of items) {
      it.t += 0.08;
      if (!circlesTouch(p.x, p.y, R, it.x, it.y, 15)) continue;
      const w = WEAPONS[it.weapon];
      it.alive = false;
      p.weapon = it.weapon;
      p.ammo = w.ammo;
      fireCooldown = 0;
      popup(w.name + "!", it.x, it.y - 26, w.color);
      puff(it.x, it.y, 10, w.color);
    }
    items = items.filter((it) => it.alive);
  }

  function popup(str, x, y, color) {
    popups.push({ text: str, x, y, color, life: 60 });
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

  function ring(x, y) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      particles.push({
        x, y,
        vx: Math.cos(a) * 3,
        vy: Math.sin(a) * 1.2,
        g: 0,
        life: 18,
        max: 18,
        size: 4,
        color: "#7fffd4",
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

  // ---------- Background (animated daylight) ----------
  const bokeh = Array.from({ length: 30 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 1.5 + Math.random() * 3,
    s: 0.15 + Math.random() * 0.4,
    par: 0.05 + Math.random() * 0.3,
    ph: Math.random() * Math.PI * 2,
  }));

  const MOUNTAINS = [
    { par: 0.1, base: 330, amp: 70, f1: 0.004, f2: 0.011, seed: 1, top: "#a9c8e8", bot: "#d4e6f6" },
    { par: 0.25, base: 380, amp: 55, f1: 0.006, f2: 0.017, seed: 4, top: "#7dbf93", bot: "#a9dcb6" },
    { par: 0.45, base: 425, amp: 35, f1: 0.009, f2: 0.023, seed: 9, top: "#4fa86a", bot: "#74c788" },
  ];

  function drawBackground() {
    const t = frame / 60;
    const hs = Math.sin(t * 0.08) * 6;

    // Bright, gently shifting daytime sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `hsl(${205 + hs}, 85%, 58%)`);
    sky.addColorStop(0.55, `hsl(${198 + hs}, 85%, 77%)`);
    sky.addColorStop(1, `hsl(${45 + hs}, 95%, 88%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Sun with slowly turning rays
    const sx = W * 0.8 - camX * 0.03;
    const sy = 90;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(t * 0.1);
    ctx.fillStyle = "rgba(255, 248, 200, 0.22)";
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-18, 260);
      ctx.lineTo(18, 260);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    const pulse = 1 + Math.sin(t * 1.5) * 0.05;
    const halo = ctx.createRadialGradient(sx, sy, 30, sx, sy, 140 * pulse);
    halo.addColorStop(0, "rgba(255, 250, 210, 0.8)");
    halo.addColorStop(1, "rgba(255, 250, 210, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(sx - 160, sy - 160, 320, 320);
    const core = ctx.createRadialGradient(sx - 10, sy - 10, 5, sx, sy, 44);
    core.addColorStop(0, "#fffbe0");
    core.addColorStop(1, "#ffd84d");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(sx, sy, 44, 0, Math.PI * 2);
    ctx.fill();

    // Soft light ribbons drifting across the sky
    for (let i = 0; i < 2; i++) {
      const baseY = 150 + i * 55;
      const grad = ctx.createLinearGradient(0, baseY - 30, 0, baseY + 80);
      grad.addColorStop(0, "rgba(255, 255, 255, 0)");
      grad.addColorStop(0.45, "rgba(255, 255, 255, 0.22)");
      grad.addColorStop(1, "rgba(255, 255, 255, 0)");
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
        ctx.lineTo(x, baseY + 70 + Math.sin(wx * 0.005 + t * 0.5 + i * 2.3) * 20);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Drifting clouds
    for (let i = 0; i < 6; i++) {
      const span = W + 400;
      const speed = 10 + (i % 3) * 6;
      const par = 0.08 + (i % 3) * 0.04;
      const x = ((((i * 230 + t * speed - camX * par) % span) + span) % span) - 200;
      cloud(x, 50 + ((i * 53) % 140), 0.7 + (i % 3) * 0.25);
    }

    // Layered parallax hills
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

    // Floating sparkles
    for (const b of bokeh) {
      const x = (((b.x - camX * b.par) % W) + W) % W;
      const a = 0.4 + Math.sin(t * 2 + b.ph) * 0.25;
      ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function cloud(x, y, sc) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, 22 * sc, 0, Math.PI * 2);
    ctx.arc(x + 26 * sc, y - 12 * sc, 28 * sc, 0, Math.PI * 2);
    ctx.arc(x + 58 * sc, y, 22 * sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x, y, 58 * sc, 22 * sc);
  }

  // ---------- Tiles ----------
  function drawTiles() {
    const c0 = Math.max(0, Math.floor(camX / TILE));
    const c1 = Math.min(level.width - 1, Math.ceil((camX + W) / TILE));

    // Darken pits so they read as holes against the bright background
    for (let c = c0; c <= c1; c++) {
      if (level.grid[ROWS - 1][c] !== " ") continue;
      const x = Math.round(c * TILE - camX);
      const g = ctx.createLinearGradient(0, GROUND_ROW * TILE, 0, ROWS * TILE);
      g.addColorStop(0, "#6b4a2e");
      g.addColorStop(1, "#1e120a");
      ctx.fillStyle = g;
      ctx.fillRect(x, GROUND_ROW * TILE, TILE + 1, (ROWS - GROUND_ROW) * TILE);
    }
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
    ctx.fillStyle = "#9a6a3c";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#86592f";
    ctx.fillRect(x + 6, y + 18, 6, 6);
    ctx.fillRect(x + 24, y + 28, 6, 6);
    if (top) {
      ctx.fillStyle = "#4cc65a";
      ctx.fillRect(x, y, TILE, 10);
      ctx.fillStyle = "#9df29b";
      ctx.fillRect(x, y, TILE, 3);
    }
  }

  function drawWall(x, y) {
    ctx.fillStyle = "#9aa3b5";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = "#727c90";
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
    ctx.fillStyle = "#e9963e";
    ctx.fillRect(x, y, TILE, 14);
    ctx.fillStyle = "#b86b1f";
    ctx.fillRect(x, y + 10, TILE, 4);
    ctx.fillStyle = "#ffd29a";
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
      ctx.fillStyle = "#6f7b90";
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

    drawBallBody(p.angle, R, SKINS[skinIndex], p.facing);

    // Eyes stay upright and look where the ball is going
    const lookX = Math.max(-1, Math.min(1, p.vx / 3 || p.facing * 0.5));
    const lookY = Math.max(-1, Math.min(1, p.vy / 8));
    const blink = (frame + 90) % 180 < 7;
    drawEyes(p.facing * 2, -3, 5, lookX, lookY, blink, false);
    drawGun(p.facing);

    ctx.restore();
  }

  function polygon(x, y, rad, n) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      else ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Draws a ball skin centered at the current origin (eyes are drawn separately).
  function drawBallBody(angle, r, skin, facing) {
    const hue = (frame * 3) % 360;
    const c = skin.rainbow
      ? [`hsl(${hue}, 100%, 80%)`, `hsl(${(hue + 60) % 360}, 90%, 55%)`, `hsl(${(hue + 120) % 360}, 80%, 38%)`]
      : skin.c;

    ctx.save();
    ctx.rotate(angle);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.15, 0, 0, r);
    g.addColorStop(0, c[0]);
    g.addColorStop(0.5, c[1]);
    g.addColorStop(1, c[2]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.clip();
    if (skin.pattern === "soccer") {
      ctx.fillStyle = "#1a1a2e";
      polygon(0, 0, r * 0.32, 5);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        polygon(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, r * 0.3, 5);
      }
    } else if (skin.pattern === "stripes") {
      ctx.strokeStyle = "#145c1f";
      ctx.lineWidth = r * 0.16;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.42 - r * 0.12, -r);
        ctx.quadraticCurveTo(i * r * 0.42 + r * 0.12, 0, i * r * 0.42 - r * 0.12, r);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Small highlight that rolls with the ball
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.78, 2.2, 2.9);
    ctx.stroke();
    ctx.restore();

    if (skin.extra === "headband") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#e63946";
      ctx.fillRect(-r, -r * 0.45, r * 2, r * 0.55);
      ctx.restore();
      const wave = Math.sin(frame * 0.3) * r * 0.15;
      ctx.fillStyle = "#e63946";
      ctx.beginPath();
      ctx.moveTo(-facing * r * 0.9, -r * 0.3);
      ctx.lineTo(-facing * r * 1.6, -r * 0.5 + wave);
      ctx.lineTo(-facing * r * 1.5, wave);
      ctx.closePath();
      ctx.fill();
    }
    if (skin.shine) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + Math.sin(frame * 0.15) * 0.4})`;
      polygon(r * 0.45, -r * 0.5, r * 0.18, 4);
    }
  }

  // Gun held at the side of the ball, in the ball's local coordinates
  function drawGun(facing) {
    const w = WEAPONS[player.weapon];
    const kick = player.recoil * 0.8;
    ctx.save();
    ctx.scale(facing, 1);
    ctx.fillStyle = "#2b2d42";
    ctx.fillRect(R - 7 - kick, 4, 15, 6);
    ctx.fillRect(R - 7 - kick, 8, 5, 6);
    ctx.fillStyle = w.color;
    ctx.fillRect(R + 5 - kick, 4, 4, 6);
    ctx.restore();
  }

  function drawWeaponIcon(type, x, y) {
    const w = WEAPONS[type];
    if (type === "bomb") {
      ctx.fillStyle = "#222";
      ctx.beginPath();
      ctx.arc(x, y + 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = frame % 10 < 5 ? "#ffd23f" : "#ff7b00";
      ctx.beginPath();
      ctx.arc(x + 5, y - 7, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const dots = type === "triple" ? [[-5, -6], [3, 0], [-5, 6]] : [[0, 0]];
      ctx.fillStyle = w.color;
      for (const [dx, dy] of dots) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawItems() {
    for (const it of items) {
      const x = it.x - camX;
      const y = it.y + Math.sin(it.t) * 4;
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.strokeStyle = WEAPONS[it.weapon].color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(x - 15, y - 15, 30, 30, 8);
      ctx.fill();
      ctx.stroke();
      drawWeaponIcon(it.weapon, x, y);
    }
  }

  function drawShots() {
    for (const sh of shots) {
      const x = sh.x - camX;
      if (sh.kind === "bomb") {
        ctx.fillStyle = "#222";
        ctx.beginPath();
        ctx.arc(x, sh.y, sh.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = frame % 6 < 3 ? "#ffd23f" : "#ff7b00";
        ctx.beginPath();
        ctx.arc(x + 3, sh.y - sh.r - 2, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = sh.color;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.ellipse(x - Math.sign(sh.vx) * 8, sh.y, 10, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, sh.y, sh.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x, sh.y, sh.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPopups() {
    for (const pp of popups) {
      ctx.globalAlpha = Math.min(1, pp.life / 20);
      text(pp.text, pp.x - camX, pp.y, 18, pp.color);
    }
    ctx.globalAlpha = 1;
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
      ctx.globalAlpha = e.flash > 0 ? 0.4 : 1;
      if (e.type === "slime") drawSlime(e);
      else if (e.type === "roller") drawRoller(e);
      else if (e.type === "drone") drawDrone(e);
      else if (e.type === "boss") drawBoss(e);
    }
    ctx.globalAlpha = 1;
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
    panel(W - 262, 58, 250, 30);
    text(`Double jump: ${doubleJump ? "ON" : "OFF"} (D)`, W - 250, 73, 14, doubleJump ? "#7fffd4" : "#aaaaaa", "left");
    text("N skip ▸", W - 24, 73, 14, "#e8ecff", "right");
    panel(W - 262, 12, 250, 40);
    text(`Time ${formatTime(time)}`, W - 250, 32, 18, "#ffd23f", "left");
    text(`Deaths ${deaths}`, W - 24, 32, 18, "#ff8c8c", "right");

    const w = WEAPONS[player.weapon];
    panel(12, H - 52, 290, 40);
    drawWeaponIcon(player.weapon, 34, H - 32);
    text(`${w.name}  ${player.ammo === Infinity ? "∞" : player.ammo}`, 54, H - 32, 17, "#ffffff", "left");
    text("X / F fire", 290, H - 32, 13, "#e8ecff", "right");

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
    text("BALL RUNNER", W / 2, 80, 56, "#ff4d6d");
    text("Roll, jump, shoot and reach the flag in all 6 levels!", W / 2, 130, 20, "#ffffff");
    text("← → move    ↑ / Space jump (again in the air = double jump)    X / F shoot", W / 2, 170, 16, "#e8ecff");
    text("R restart   N skip level   B previous level   D double jump on/off   S change skin", W / 2, 194, 15, "#e8ecff");
    text("Grab weapons · stomp or shoot enemies · dodge spikes, pits, wheels and mines · bosses on 3 and 6", W / 2, 222, 15, "#e8ecff");

    // Skin picker
    const skin = SKINS[skinIndex];
    ctx.save();
    ctx.translate(W / 2, 295);
    drawBallBody(frame * 0.03, 30, skin, 1);
    drawEyes(2, -6, 9, Math.sin(frame * 0.03), 0, (frame + 90) % 180 < 7, false);
    ctx.restore();
    text("◀", W / 2 - 90, 295, 32, "#ffffff");
    text("▶", W / 2 + 90, 295, 32, "#ffffff");
    text(`Skin: ${skin.name} (${skinIndex + 1}/${SKINS.length})`, W / 2, 352, 22, "#ffd23f");
    text("← → or S to change", W / 2, 378, 15, "#e8ecff");

    if (Math.floor(frame / 30) % 2 === 0) {
      text("Press Space or Enter to start", W / 2, 432, 26, "#ffd23f");
    }
  }

  function render() {
    if (state === "title") return drawTitle();

    drawBackground();

    ctx.save();
    if (shake > 0.5) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawTiles();
    drawItems();
    drawEnemies();
    drawPlayer();
    drawShots();
    drawParticles();
    drawPopups();
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
