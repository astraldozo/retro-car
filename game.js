/* <=5 comments total */

const canvas = document.getElementById("game"),
  ctx = canvas.getContext("2d");
const W = canvas.width,
  H = canvas.height;

// player/world
const player = {
  baseW: 36,
  baseH: 56,
  w: 36,
  h: 56,
  x: (W - 36) / 2,
  y: H - 160,
  color: "#ff3b3b",
  speed: 4,
  tilt: 0, // derajat miring
};
let enemies = [],
  fuels = [],
  buffsOnRoad = [],
  keys = {};
let fuel = 100,
  scoreTotal = 0,
  distance = 0;
let running = false,
  gameOver = false,
  spawnTimer = 0,
  fuelTimer = 0,
  buffSpawnTimer = 0,
  roadOffset = 0;

// lanes & spawn config
const LANE_COUNT = 5,
  ROAD_LEFT = 40,
  ROAD_WIDTH = W - 80,
  LANE_WIDTH = ROAD_WIDTH / LANE_COUNT;
const PLAYER_MIN_X = ROAD_LEFT + 6,
  PLAYER_MAX_X = ROAD_LEFT + ROAD_WIDTH - player.w - 6;
const LANES = 5,
  MAX_PER_LANE = 3,
  MAX_ENEMIES = 15,
  MIN_SPAWN_GAP = 80,
  LANE_SPAWN_INTERVAL = 4000,
  GLOBAL_SPAWN_INTERVAL = 800;
let laneSpawnCooldown = new Array(LANES).fill(0),
  globalSpawnCooldown = 0;

// scoring components
let score_distance = 0,
  score_fuelused = 0,
  score_fuelpick = 0,
  score_buffpick = 0;
let fuelUsed = 0,
  fuelPickupsCollected = 0,
  buffPickupsCollected = 0;

// passive skill (chosen once at start)
let passive = null; // example: {id:'speed_boost', label:'+10% speed', apply:fn}

// buff definitions (temporary)
const allBuffs = [
  {
    id: "nitro",
    name: "Lincah",
    desc: "+50% Kelincahan (10s)",
    dur: 10000,
    icon: "⚡",
  },
  {
    id: "fuel_saver",
    name: "Hemat Bensin",
    desc: "-50% fuel use (12s)",
    dur: 12000,
    icon: "⛽",
  },
  {
    id: "ghost",
    name: "Mode Hantu",
    desc: "Mengabaikan Tabrakan (6s)",
    dur: 6000,
    icon: "👻",
  },
  {
    id: "double_fuel",
    name: "Bensin x2",
    desc: "Ambil Bensin di x2 (12s)",
    dur: 12000,
    icon: "🔋",
  },
  {
    id: "shield",
    name: "Perisai",
    desc: "Menahan 1 Tabrakan ",
    dur: 0,
    icon: "🛡️",
  },
];
let activeBuffs = [];

// passive choices
const passiveChoices = [
  {
    id: "speed_boost",
    name: "+10% Kelincahan",
    apply: () => {
      player.speed *= 1.1;
    },
  },
  {
    id: "fuel_efficient",
    name: "-20% Penggunaan Bensin",
    apply: () => {
      passiveFuelMultiplier *= 0.8;
    },
  },
  {
    id: "start_shield",
    name: "Perisai di awal",
    apply: () => {
      permanentShield.count = Math.max(permanentShield.count || 0, 1);
    },
  },
  {
    id: "extra_fuel_value",
    name: "+20% Bensin yang didapat",
    apply: () => {
      fuelPickupMultiplier *= 1.2;
    },
  },
  {
    id: "distance_bonus",
    name: "+10% Skor jarak",
    apply: () => {
      distanceScoreMultiplier *= 1.1;
    },
  },
];
let permanentShield = { count: 0 };
let passiveFuelMultiplier = 1.0;
let fuelPickupMultiplier = 1.0;
let distanceScoreMultiplier = 1.0;
let lastShieldConsumedTime = -Infinity;
let lastGlobalLaneChange = 0;

// input
window.addEventListener("keydown", (e) => (keys[e.key] = true));
window.addEventListener("keyup", (e) => (keys[e.key] = false));
canvas.addEventListener("touchstart", handleTouch);
canvas.addEventListener("touchmove", handleTouch);
function handleTouch(e) {
  e.preventDefault();
  const t = e.touches[0];
  if (!t) return;
  const rect = canvas.getBoundingClientRect();
  const x = (t.clientX - rect.left) * (canvas.width / rect.width);
  keys["touch"] = x < W / 2 ? "left" : "right";
}
canvas.addEventListener("touchend", () => (keys["touch"] = false));

// helpers
function rand(a, b) {
  return Math.random() * (b - a) + a;
}
function rectColl(a, b) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

// initial passive selection overlay
const buffOverlay = document.getElementById("buffOverlay");
const buffBoard = document.getElementById("buffBoard");
function showPassiveChoices() {
  buffBoard.innerHTML = "";
  const choices = passiveChoices.slice(0, 3); // show 3 random choices
  // shuffle then pick 3
  for (let i = 0; i < 2; i++) {
    const idx = Math.floor(rand(0, passiveChoices.length));
    const p = passiveChoices.splice(idx, 1)[0];
    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `<div class="name">${p.name}</div><div class="desc">Passive effect. Permanen sampai akhir run.</div>`;
    c.addEventListener("click", () => {
      pickPassive(c, p);
    });
    buffBoard.appendChild(c);
    setTimeout(() => c.classList.add("show"), 80 * i);
  }
  buffOverlay.style.display = "flex";
  buffOverlay.dataset.mode = "passive";
  running = false;
}
function pickPassive(cardEl, p) {
  cardEl.classList.add("picked");
  setTimeout(() => {
    passive = p;
    // apply passive effect
    if (passive && passive.apply) passive.apply();
    buffOverlay.style.display = "none";
    running = true;
  }, 300);
}

// spawn enemy with improved logic
function spawnEnemy() {
  if (enemies.length >= MAX_ENEMIES) return;
  if (performance.now() < globalSpawnCooldown) return;

  let available = [];
  for (let i = 0; i < LANES; i++) {
    const laneEnemies = enemies.filter((e) => e.lane === i);
    if (laneEnemies.length >= MAX_PER_LANE) continue;
    if (performance.now() < laneSpawnCooldown[i]) continue;
    if (!laneEnemies.length) {
      available.push(i);
      continue;
    }
    const last = laneEnemies.reduce((a, b) => (a.y > b.y ? a : b));
    if (last.y > MIN_SPAWN_GAP) available.push(i);
  }
  if (available.length === 0) return;
  const lane = available[Math.floor(Math.random() * available.length)];
  const x = Math.round(ROAD_LEFT + LANE_WIDTH * lane + (LANE_WIDTH - 36) / 2);
  const baseSpeed = rand(1.5, 2.2);
  enemies.push({
    x,
    y: -56,
    w: 36,
    h: 56,
    baseSpeed,
    speed: baseSpeed,
    lane,
    tilt: 0,
    laneChanging: false,
  });
  laneSpawnCooldown[lane] = performance.now() + LANE_SPAWN_INTERVAL;
  globalSpawnCooldown = performance.now() + GLOBAL_SPAWN_INTERVAL;
}

// spawn fuel and buff pickups
function spawnFuel() {
  if (fuels.length >= 6) return;
  const w = 30,
    h = 28;
  const lane = Math.floor(rand(0, LANE_COUNT));
  const x = Math.round(ROAD_LEFT + LANE_WIDTH * lane + (LANE_WIDTH - w) / 2);
  fuels.push({ x, y: -h, w, h, speed: 2.2 });
}
function spawnBuffPickup() {
  if (buffsOnRoad.length >= 3) return;
  const idx = Math.floor(rand(0, allBuffs.length));
  const buff = allBuffs[idx];
  const w = 28,
    h = 28;
  const lane = Math.floor(rand(0, LANE_COUNT));
  const x = Math.round(ROAD_LEFT + LANE_WIDTH * lane + (LANE_WIDTH - w) / 2);
  buffsOnRoad.push({
    x,
    y: -h,
    w,
    h,
    speed: 2,
    buffId: buff.id,
    icon: buff.icon,
    dur: buff.dur,
  });
}

// activate temporary buff from pickup
function activateTempBuffById(id) {
  const b = allBuffs.find((x) => x.id === id);
  if (!b) return;
  const now = performance.now();
  if (b.id === "shield") {
    // shield as one-time or stack
    activeBuffs.push({
      id: "shield",
      expires: null,
      buff: b,
      data: { count: 1 },
    });
    return;
  }
  activeBuffs.push({ id: b.id, expires: now + b.dur, buff: b, data: {} });
}

// buff housekeeping
function applyBuffHousekeeping() {
  const now = performance.now();
  for (let i = activeBuffs.length - 1; i >= 0; i--) {
    const b = activeBuffs[i];
    if (b.expires && b.expires <= now) {
      if (b.id === "shrink") {
        player.w = player.baseW;
        player.h = player.baseH;
      }
      activeBuffs.splice(i, 1);
    }
  }
}
function isBuffActive(id) {
  return (
    activeBuffs.some((b) => b.id === id) ||
    (id === "shield" && permanentShield.count > 0)
  );
}

// scoring helpers
function recomputeScore() {
  score_distance = Math.floor(distance * distanceScoreMultiplier);
  score_fuelused = Math.floor(fuelUsed); // 1 point per fuel unit used
  score_fuelpick = fuelPickupsCollected * 50;
  score_buffpick = buffPickupsCollected * 150;
  scoreTotal =
    score_distance + score_fuelused + score_fuelpick + score_buffpick;
  document.getElementById("score").innerText = Math.floor(scoreTotal);
  document.getElementById("score_dist").innerText = score_distance;
  document.getElementById("score_fuelused").innerText = score_fuelused;
  document.getElementById("score_fuelpick").innerText = score_fuelpick;
  document.getElementById("score_buffpick").innerText = score_buffpick;
}

// activate temporary buff effects per-frame (some are handled in checks)
function getBuffMultiplier(id) {
  if (id === "nitro") return 1.5;
  return 1;
}

// update active buffs UI
function updateActiveBuffsUI() {
  const container = document.getElementById("activeBuffsUI");
  container.innerHTML = "";
  const now = performance.now();
  // permanent shield show
  if (permanentShield.count > 0) {
    const el = document.createElement("div");
    el.className = "buff-slot";
    el.innerHTML = `<div class="buff-icon">🛡️</div><div class="buff-info"><div style="font-weight:700">Shield</div><div style="font-size:11px">perm</div></div>`;
    container.appendChild(el);
  }
  activeBuffs.forEach((b) => {
    const el = document.createElement("div");
    el.className = "buff-slot";
    const remaining = b.expires
      ? Math.max(0, Math.ceil((b.expires - now) / 1000)) + "s"
      : b.data.count
      ? "x" + b.data.count
      : "";
    el.innerHTML = `<div class="buff-icon">${
      b.buff.icon || "?"
    }</div><div class="buff-info"><div style="font-weight:700">${
      b.buff.name
    }</div><div style="font-size:11px">${remaining}</div></div>`;
    container.appendChild(el);
  });
}

// main update + draw
let last = performance.now();
function frame(now) {
  const dt = Math.max(8, now - last);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

function update(dt) {
  if (!running || gameOver) return;

  // input + clamp
  const moveSpeed = player.speed * (isBuffActive("nitro") ? 1.5 : 1);
  if (keys["ArrowLeft"] || keys["a"] || keys["A"] || keys["touch"] === "left") {
    player.x -= moveSpeed;
    player.tilt += (-15 - player.tilt) * 0.2; // smooth ke -15°
  } else if (
    keys["ArrowRight"] ||
    keys["d"] ||
    keys["D"] ||
    keys["touch"] === "right"
  ) {
    player.x += moveSpeed;
    player.tilt += (15 - player.tilt) * 0.2; // smooth ke +15°
  } else {
    player.tilt += (0 - player.tilt) * 0.2; // kembali ke 0°
  }
  //   const moveSpeed = player.speed * (isBuffActive("nitro") ? 1.5 : 1);
  //   if (keys["ArrowLeft"] || keys["a"] || keys["A"] || keys["touch"] === "left")
  //     player.x -= moveSpeed;
  //   if (keys["ArrowRight"] || keys["d"] || keys["D"] || keys["touch"] === "right")
  //     player.x += moveSpeed;
  if (player.x < PLAYER_MIN_X) player.x = PLAYER_MIN_X;
  if (player.x > PLAYER_MAX_X) player.x = PLAYER_MAX_X;

  // distance
  const forwardSpeed = 2.4;
  distance += forwardSpeed * dt * 0.01;
  document.getElementById("distance").innerText = Math.floor(distance);

  // fuel consumption (2x faster; passive modifies it too)
  let consumption = 0.05 * 2 * passiveFuelMultiplier; // doubled
  if (isBuffActive("fuel_saver")) consumption *= 0.5;
  if (isBuffActive("nitro")) consumption *= 1.12;
  fuel -= consumption;
  fuelUsed += Math.max(0, consumption * (dt / 16)); // approximate units consumed
  if (isBuffActive("fuel_regen")) fuel = Math.min(100, fuel + (0.02 * dt) / 16);
  if (fuel <= 0) {
    fuel = 0;
    running = false;
    showMessage("KEHABISAN BENSIN");
    restartBtn.style.display = "block";
  }

  // spawns (enemies, fuel, buff pickups)
  spawnTimer += dt;
  const baseInterval = 700 - Math.min(distance, 400);
  if (spawnTimer > baseInterval * 1.3) {
    spawnTimer = 0;
    spawnEnemy();
  }
  fuelTimer += dt;
  if (fuelTimer > 3500) {
    fuelTimer = 0;
    spawnFuel();
  }
  buffSpawnTimer += dt;
  if (buffSpawnTimer > 6500) {
    buffSpawnTimer = 0;
    spawnBuffPickup();
  }

  // move enemies
  for (const e of enemies) {
    // gerak vertikal
    e.y += e.speed * (isBuffActive("slowmo") ? 0.5 : 1);

    // gerak horizontal kalau lagi pindah lane
    if (e.laneChanging) {
      if (Math.abs(e.targetX - e.x) > 1) {
        e.tilt = e.tiltDir < 0 ? -15 : 15; // miring saat pindah
        e.x += Math.sign(e.targetX - e.x) * e.laneChangeSpeed;
      } else {
        console.log("x :" + e.x + "| tagetX :" + e.targetX);
        e.x = e.targetX;
        e.laneChanging = false;
      }
    } else {
      if (e.tilt != 0) {
        e.tilt += (0 - e.tilt) * 0.15; // smooth kembali
        if (Math.abs(e.tilt) < 0.1) e.tilt = 0; // snap ke nol
      }
    }
  }

  // filter enemy yang sudah lewat
  enemies = enemies.filter((e) => e.y < H + 120);

  // per-lane anti-collision speed follow
  const SAFE_DISTANCE = 36;
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const laneEnemies = enemies
      .filter((e) => e.lane === lane)
      .sort((a, b) => b.y - a.y);

    for (let i = 0; i < laneEnemies.length - 1; i++) {
      const front = laneEnemies[i],
        back = laneEnemies[i + 1];
      const gap = front.y - (back.y + back.h);
      if (gap < SAFE_DISTANCE) {
        const target = Math.min(front.speed, back.baseSpeed);
        back.speed += (target - back.speed) * 0.18;
        const desiredBackY = front.y - front.h - SAFE_DISTANCE;
        if (back.y > desiredBackY) back.y = desiredBackY;
      } else {
        back.speed += (back.baseSpeed - back.speed) * 0.02;
      }
    }
  }

  // lane change decision + cooldown
  for (const e of enemies) {
    if (!e.lastLaneChangeTime) e.lastLaneChangeTime = 0;
    const nowMs = performance.now();

    if (
      nowMs - e.lastLaneChangeTime < e.laneChangeCooldown ||
      nowMs - lastGlobalLaneChange < 3000 || // global cooldown
      Math.random() > 0.01
    )
      continue;

    const dir = Math.random() < 0.5 ? -1 : 1;
    const newLane = e.lane + dir;
    if (newLane < 0 || newLane >= LANE_COUNT) continue;

    // cek space di lane target
    const safeGap = 60;
    const hasSpace = !enemies.some(
      (o) => o.lane === newLane && Math.abs(o.y - e.y) < safeGap
    );
    if (!hasSpace) continue;

    // mulai pindah lane
    e.lane = newLane;
    e.targetX = Math.round(
      ROAD_LEFT + LANE_WIDTH * newLane + (LANE_WIDTH - e.w) / 2
    );
    e.laneChanging = true;
    e.laneChangeSpeed = 1.2;
    e.tiltDir = dir;

    // set cooldown
    e.laneChangeCooldown = rand(4000, 8000);
    e.lastLaneChangeTime = nowMs;
    lastGlobalLaneChange = nowMs;
  }

  // move fuels & buffs
  for (const f of fuels) f.y += f.speed;
  for (const b of buffsOnRoad) b.y += b.speed;
  fuels = fuels.filter((f) => f.y < H + 60);
  buffsOnRoad = buffsOnRoad.filter((b) => b.y < H + 60);

  // collisions: enemy
  const now = performance.now();
  const collidedIdxs = [];
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.y > player.y - 120 && e.y < player.y + 120 && rectColl(player, e))
      collidedIdxs.push(i);
  }
  if (collidedIdxs.length > 0) {
    if (isBuffActive("ghost")) {
      // ignore
    } else if (permanentShield.count > 0) {
      permanentShield.count--;
      enemies.splice(collidedIdxs[0], 1);
    } else {
      const shieldIdx = activeBuffs.findIndex((b) => b.id === "shield");
      if (
        shieldIdx >= 0 &&
        activeBuffs[shieldIdx].data.count > 0 &&
        now - lastShieldConsumedTime > 350
      ) {
        activeBuffs[shieldIdx].data.count--;
        if (activeBuffs[shieldIdx].data.count <= 0)
          activeBuffs.splice(shieldIdx, 1);
        enemies.splice(collidedIdxs[0], 1);
        lastShieldConsumedTime = now;
      } else {
        // gameOver = true;
        // running = false;
        // showMessage("GAME OVER");
        showGameOver();
      }
    }
  }

  // fuel pickups collision
  for (let i = fuels.length - 1; i >= 0; i--) {
    if (rectColl(player, fuels[i])) {
      const amount = Math.floor(
        (isBuffActive("double_fuel") ? 60 : 30) * fuelPickupMultiplier
      );
      fuel = Math.min(100, fuel + amount);
      fuels.splice(i, 1);
      fuelPickupsCollected++;
    }
  }

  // buff pickups collision
  for (let i = buffsOnRoad.length - 1; i >= 0; i--) {
    if (rectColl(player, buffsOnRoad[i])) {
      const id = buffsOnRoad[i].buffId;
      activateTempBuffById(id);
      buffsOnRoad.splice(i, 1);
      buffPickupsCollected++;
    }
  }

  applyBuffHousekeeping();
  updateActiveBuffsUI();
  recomputeScore();
  roadOffset += (200 * dt) / 1000;
  if (roadOffset > 40) roadOffset -= 40;
}

// drawing
function draw() {
  const t = performance.now();
  ctx.clearRect(0, 0, W, H);

  // road
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, 40, H);
  ctx.fillRect(W - 40, 0, 40, H);
  ctx.fillStyle = "#222";
  ctx.fillRect(40, 0, W - 80, H);
  ctx.save();
  ctx.translate(0, roadOffset);
  ctx.fillStyle = "#d9d9d9";
  for (let y = -60; y < H + 80; y += 40) ctx.fillRect(W / 2 - 6, y, 12, 22);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  for (let i = 1; i < LANE_COUNT; i++) {
    const lx = ROAD_LEFT + i * LANE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, H);
    ctx.stroke();
  }

  // draw fuels
  for (const f of fuels) drawFuelBox(f.x, f.y, f.w, f.h);
  // draw buffs on road
  for (const b of buffsOnRoad) drawBuffPickup(b.x, b.y, b.w, b.h, b.icon);

  // enemies
  for (const e of enemies) {
    drawCar(e.x, e.y, e.w, e.h, "#3b82f6", e.tilt || 0);
  }

  // player effects/trails
  ctx.save();
  if (isBuffActive("ghost")) {
    drawGhostTint();
    const flick = 0.65 + Math.sin(t / 120) / 6;
    ctx.globalAlpha = flick;
  }
  if (isBuffActive("nitro"))
    drawMotionTrail(player.x, player.y, player.w, player.h, t);
  drawCar(player.x, player.y, player.w, player.h, player.color, player.tilt);
  ctx.restore();

  if (isBuffActive("shield") || permanentShield.count > 0)
    drawShield(player.x, player.y, player.w, player.h, t);

  document.getElementById("score").innerText = Math.floor(scoreTotal);
  document.getElementById("distance").innerText = Math.floor(distance);
  const fill = document.getElementById("fuelFill");
  fill.style.width = Math.max(0, fuel) * 2 + "px";
  fill.style.background =
    fuel > 40 ? "#39b54a" : fuel > 15 ? "#f0a500" : "#ff3b3b";
}

function drawShield(x, y, w, h, t) {
  const cx = x + w / 2,
    cy = y + h / 2,
    r = Math.max(w, h) * 0.9 + Math.sin(t / 200) * 4;
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "#7fd1ff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCar(x, y, w, h, color, tilt = 0) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((tilt * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);

  ctx.fillStyle = "#000";
  ctx.fillRect(2, 2, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h - 10);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillRect(6, 8, w - 12, 12);
  ctx.fillStyle = "#111";
  ctx.fillRect(4, h - 8, 8, 6);
  ctx.fillRect(w - 12, h - 8, 8, 6);

  ctx.restore();
}
// function drawCar(x, y, w, h, color) {
//   ctx.fillStyle = "#000";
//   ctx.fillRect(x + 2, y + 2, w, h);
//   ctx.fillStyle = color;
//   ctx.fillRect(x, y, w, h - 10);
//   ctx.fillStyle = "rgba(255,255,255,0.6)";
//   ctx.fillRect(x + 6, y + 8, w - 12, 12);
//   ctx.fillStyle = "#111";
//   ctx.fillRect(x + 4, y + h - 8, 8, 6);
//   ctx.fillRect(x + w - 12, y + h - 8, 8, 6);
// }
function drawFuelBox(x, y, w, h) {
  ctx.fillStyle = "#b58300";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(x + 6, y + 6, w - 12, h - 12);
  ctx.fillStyle = "#b58300";
  ctx.fillRect(x + 9, y + 9, w - 18, h - 18);
}
function drawBuffPickup(x, y, w, h, icon) {
  ctx.fillStyle = "#114";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#fff";
  ctx.font = "16px sans-serif";
  ctx.fillText(icon, x + w / 2 - 6, y + h / 2 + 6);
}
function drawMotionTrail(x, y, w, h, t) {
  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let i = 1; i <= 3; i++) {
    ctx.fillRect(x - i * 6, y + i * 6, w, h - 10);
  }
  ctx.restore();
}
function drawStars(x, y, w, h, t) {
  ctx.save();
  ctx.globalAlpha = 0.9;
  const cx = x + w / 2,
    top = y - 12 - Math.abs(Math.sin(t / 150)) * 6;
  ctx.fillStyle = "#ffd700";
  ctx.fillRect(cx - 2, top, 4, 4);
  ctx.fillRect(cx + 8, top + 2, 3, 3);
  ctx.restore();
}

function drawGhostTint() {
  ctx.globalAlpha = 0.45;
}

// messages & start/reset
function showMessage(txt) {
  document.getElementById("message").textContent = txt;
}
function startGame() {
  // reset stats but keep passive
  enemies = [];
  fuels = [];
  buffsOnRoad = [];
  fuel = 100;
  scoreTotal = 0;
  distance = 0;
  spawnTimer = 0;
  fuelTimer = 0;
  buffSpawnTimer = 0;
  fuelUsed = 0;
  fuelPickupsCollected = 0;
  buffPickupsCollected = 0;
  score_distance = 0;
  score_fuelused = 0;
  score_fuelpick = 0;
  score_buffpick = 0;
  running = true;
  gameOver = false;
  last = performance.now();
  showMessage("");
}
window.addEventListener("click", () => {
  if (buffOverlay.style.display === "flex") return;
  if (!gameOver && running) return;
  // if passive not chosen, show selection
  if (!passive) {
    showPassiveChoices();
    return;
  }
  //   startGame();
});

const restartBtn = document.getElementById("restartBtn");

function showGameOver() {
  gameOver = true;
  running = false;
  document.getElementById("message").textContent = "GAME SELESAI";
  restartBtn.style.display = "block";
}

restartBtn.addEventListener("click", restartGame);

function restartGame() {
  enemies = [];
  fuels = [];
  buffsOnRoad = [];
  activeBuffs = [];
  fuel = 100;
  scoreTotal = 0;
  distance = 0;
  spawnTimer = 0;
  fuelTimer = 0;
  buffSpawnTimer = 0;
  fuelUsed = 0;
  fuelPickupsCollected = 0;
  buffPickupsCollected = 0;
  score_distance = 0;
  score_fuelused = 0;
  score_fuelpick = 0;
  score_buffpick = 0;
  running = true;
  gameOver = false;
  last = performance.now();
  lastShieldConsumedTime = -Infinity;
  document.getElementById("message").textContent = "";
  restartBtn.style.display = "none";
  player.x = (W - 36) / 2;
}

// show passive choices at initial load
showPassiveChoices();
requestAnimationFrame(frame);

// restart UI handlers
function resizeGame() {
  const wrap = document.querySelector(".wrap");
  const rect = wrap.getBoundingClientRect();
  const c = document.getElementById("game");
  c.style.width = rect.width + "px";
  c.style.height = rect.height + "px";
}
window.addEventListener("resize", resizeGame);
resizeGame();
