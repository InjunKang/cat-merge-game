(() => {
  "use strict";

  const { Engine, Bodies, Composite, Events, Body } = Matter;

  // ---------- Tier definitions (small -> big) ----------
  const TIERS = [
    { name: "아깽이", emoji: "🐾", radius: 16, color: "#ffd6e8", score: 1 },
    { name: "냥이", emoji: "🐱", radius: 22, color: "#ffc2d1", score: 3 },
    { name: "고양이", emoji: "🐈", radius: 29, color: "#ffb3c6", score: 6 },
    { name: "검은고양이", emoji: "🐈‍⬛", radius: 37, color: "#e0aaff", score: 10 },
    { name: "개구쟁이냥", emoji: "😹", radius: 46, color: "#bde0fe", score: 15 },
    { name: "하트눈냥", emoji: "😻", radius: 56, color: "#a2d2ff", score: 21 },
    { name: "까칠냥", emoji: "😾", radius: 67, color: "#ffe5a0", score: 28 },
    { name: "호랑이", emoji: "🐯", radius: 79, color: "#ffca7a", score: 36 },
    { name: "백호", emoji: "🐅", radius: 92, color: "#d8f3dc", score: 45 },
    { name: "사자왕", emoji: "🦁", radius: 106, color: "#ffdd7a", score: 55 },
    { name: "냥신", emoji: "👑", radius: 122, color: "#fff1a8", score: 66 },
  ];
  const SPAWNABLE_MAX_INDEX = 4; // only the first 5 tiers can be dropped by the player
  const MAX_TIER = TIERS.length - 1;
  const DANGER_Y = 92; // logical px from top - line of death
  const DANGER_HOLD_MS = 1200;
  const SPAWN_GRACE_MS = 700;
  const DROP_COOLDOWN_MS = 420;
  const COMBO_WINDOW_MS = 1500; // time allowed between merges to keep the combo alive

  // ---------- DOM ----------
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const nextPreviewEl = document.getElementById("next-preview");
  const tierbarEl = document.getElementById("tierbar");
  const gameOverModal = document.getElementById("game-over-modal");
  const finalScoreEl = document.getElementById("final-score");
  const finalComboEl = document.getElementById("final-combo");
  const restartBtn = document.getElementById("restart-btn");
  const comboBadgeEl = document.getElementById("combo-badge");
  const comboCountEl = document.getElementById("combo-count");
  const comboReactionEl = document.getElementById("combo-reaction");
  const comboBarFillEl = document.getElementById("combo-bar-fill");

  const leaderboardBtn = document.getElementById("leaderboard-btn");
  const leaderboardModal = document.getElementById("leaderboard-modal");
  const leaderboardListEl = document.getElementById("leaderboard-list");
  const leaderboardStatusEl = document.getElementById("leaderboard-status");
  const leaderboardCloseBtn = document.getElementById("leaderboard-close-btn");
  const rankEntryEl = document.getElementById("rank-entry");
  const rankEntryMessageEl = document.getElementById("rank-entry-message");
  const rankNameInput = document.getElementById("rank-name-input");
  const rankSubmitBtn = document.getElementById("rank-submit-btn");
  const rankResultEl = document.getElementById("rank-result");
  const rankResultStatusEl = document.getElementById("rank-result-status");
  const rankLeaderboardListEl = document.getElementById("rank-leaderboard-list");

  const BEST_KEY = "catMergeBest";

  // ---------- Physics engine ----------
  const engine = Engine.create();
  engine.gravity.y = 1.15;
  const world = engine.world;

  let WIDTH = 0;
  let HEIGHT = 0;
  let DPR = Math.max(1, window.devicePixelRatio || 1);

  let wallLeft, wallRight, wallFloor;

  function buildWalls(w, h) {
    const t = 40; // thickness
    if (wallLeft) Composite.remove(world, [wallLeft, wallRight, wallFloor]);
    wallLeft = Bodies.rectangle(-t / 2, h / 2, t, h * 2, { isStatic: true, friction: 0.2 });
    wallRight = Bodies.rectangle(w + t / 2, h / 2, t, h * 2, { isStatic: true, friction: 0.2 });
    wallFloor = Bodies.rectangle(w / 2, h + t / 2, w * 2, t, { isStatic: true, friction: 0.6 });
    Composite.add(world, [wallLeft, wallRight, wallFloor]);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const newW = rect.width;
    const newH = rect.height;
    if (newW <= 0 || newH <= 0) return;

    DPR = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(newW * DPR);
    canvas.height = Math.round(newH * DPR);

    if (WIDTH > 0 && HEIGHT > 0 && (Math.abs(newW - WIDTH) > 1 || Math.abs(newH - HEIGHT) > 1)) {
      const sx = newW / WIDTH;
      const sy = newH / HEIGHT;
      Composite.allBodies(world).forEach((b) => {
        if (b.isStatic) return;
        Body.setPosition(b, { x: b.position.x * sx, y: b.position.y * sy });
      });
    }

    WIDTH = newW;
    HEIGHT = newH;
    buildWalls(WIDTH, HEIGHT);
  }

  window.addEventListener("resize", resize);

  // ---------- Game state ----------
  let score = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  bestEl.textContent = best;

  let pendingTierIndex = randomSpawnTier();
  let pendingX = 0;
  let dropLocked = false;
  let dangerTimer = 0;
  let running = true;
  let lastTime = performance.now();
  const pendingMerges = [];

  let combo = 0;
  let comboTimer = 0;
  let maxCombo = 0;
  const scorePopups = [];
  const shake = { time: 0, duration: 0, mag: 0 };

  function randomSpawnTier() {
    return Math.floor(Math.random() * (SPAWNABLE_MAX_INDEX + 1));
  }

  function updateNextPreview() {
    nextPreviewEl.textContent = TIERS[pendingTierIndex].emoji;
  }

  function buildTierbar() {
    tierbarEl.innerHTML = "";
    TIERS.forEach((t, i) => {
      const span = document.createElement("span");
      span.className = "tier-chip";
      span.textContent = t.emoji;
      span.title = t.name;
      tierbarEl.appendChild(span);
      if (i < TIERS.length - 1) {
        const arrow = document.createElement("span");
        arrow.className = "tier-chip arrow";
        arrow.textContent = "→";
        tierbarEl.appendChild(arrow);
      }
    });
  }

  function clampPendingX() {
    const r = TIERS[pendingTierIndex].radius;
    pendingX = Math.min(Math.max(pendingX, r + 4), WIDTH - r - 4);
  }

  function spawnCat(tierIndex, x, y) {
    const tier = TIERS[tierIndex];
    const body = Bodies.circle(x, y, tier.radius, {
      restitution: 0.15,
      friction: 0.4,
      frictionAir: 0.001,
      density: 0.0015,
    });
    body.tierIndex = tierIndex;
    body.merged = false;
    body.spawnTime = performance.now();
    Composite.add(world, body);
    return body;
  }

  function dropPending() {
    if (dropLocked || !running) return;
    clampPendingX();
    spawnCat(pendingTierIndex, pendingX, TIERS[pendingTierIndex].radius + 6);
    dropLocked = true;
    setTimeout(() => {
      dropLocked = false;
    }, DROP_COOLDOWN_MS);
    pendingTierIndex = randomSpawnTier();
    updateNextPreview();
  }

  // ---------- Input ----------
  function pointerXFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return clientX - rect.left;
  }

  canvas.addEventListener("pointermove", (e) => {
    pendingX = pointerXFromEvent(e);
    clampPendingX();
  });

  canvas.addEventListener("pointerdown", (e) => {
    pendingX = pointerXFromEvent(e);
    clampPendingX();
    dropPending();
  });

  restartBtn.addEventListener("click", resetGame);

  // ---------- Merge handling ----------
  Events.on(engine, "collisionStart", (event) => {
    event.pairs.forEach((pair) => {
      const { bodyA, bodyB } = pair;
      if (
        bodyA.tierIndex === undefined ||
        bodyB.tierIndex === undefined ||
        bodyA.merged ||
        bodyB.merged
      )
        return;
      if (bodyA.tierIndex !== bodyB.tierIndex) return;
      bodyA.merged = true;
      bodyB.merged = true;
      pendingMerges.push({ a: bodyA, b: bodyB });
    });
  });

  function processMerges() {
    if (pendingMerges.length === 0) return;
    const batch = pendingMerges.splice(0, pendingMerges.length);
    batch.forEach(({ a, b }) => {
      if (!Composite.get(world, a.id, "body") || !Composite.get(world, b.id, "body")) return;
      const mx = (a.position.x + b.position.x) / 2;
      const my = (a.position.y + b.position.y) / 2;
      const tierIndex = a.tierIndex;
      Composite.remove(world, [a, b]);

      if (tierIndex >= MAX_TIER) {
        registerMerge(mx, my, TIERS[MAX_TIER].score * 2, tierIndex);
        return;
      }
      const nextTier = tierIndex + 1;
      const newBody = spawnCat(nextTier, mx, my);
      Body.setVelocity(newBody, { x: 0, y: -1 });
      registerMerge(mx, my, TIERS[nextTier].score, tierIndex);
    });
  }

  function addScore(v) {
    score += v;
    scoreEl.textContent = score;
    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem(BEST_KEY, String(best));
    }
  }

  // ---------- Combo / score juice ----------
  function comboMultiplier(c) {
    if (c <= 1) return 1;
    return Math.min(1 + (c - 1) * 0.5, 5);
  }

  function reactionText(c) {
    if (c >= 9) return "냥신강림!!";
    if (c >= 6) return "쩐다냥!";
    if (c >= 4) return "대박!";
    if (c >= 3) return "좋아!";
    return "나이스!";
  }

  function registerMerge(x, y, baseScore, tierIndex) {
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    comboTimer = COMBO_WINDOW_MS;
    const mult = comboMultiplier(combo);
    const gained = Math.round(baseScore * mult);
    addScore(gained);
    spawnScorePopup(x, y, gained, mult);
    triggerShake(Math.min(1.5 + tierIndex * 0.9 + (combo - 1) * 0.4, 16), 160 + Math.min(combo * 10, 140));
    updateComboUI();
  }

  function updateComboUI() {
    if (combo >= 2) {
      comboBadgeEl.classList.remove("hidden");
      comboCountEl.textContent = `COMBO x${combo}`;
      comboReactionEl.textContent = reactionText(combo);
      comboBadgeEl.classList.remove("pulse");
      void comboBadgeEl.offsetWidth; // restart animation
      comboBadgeEl.classList.add("pulse");
    } else {
      comboBadgeEl.classList.add("hidden");
    }
  }

  function spawnScorePopup(x, y, gained, mult) {
    scorePopups.push({
      x,
      y,
      text: mult > 1 ? `+${gained} x${mult.toFixed(1)}` : `+${gained}`,
      life: 900,
      maxLife: 900,
      color: mult >= 3 ? "#ff6fa5" : mult >= 1.5 ? "#e26d92" : "#5b4636",
      fontSize: 14 + Math.min(mult * 4, 20),
    });
  }

  function triggerShake(mag, duration) {
    shake.mag = mag;
    shake.duration = duration;
    shake.time = duration;
  }

  // ---------- Leaderboard ----------
  function renderLeaderboardRows(listEl, rows, highlightName, highlightScore) {
    listEl.innerHTML = "";
    rows.forEach((row, i) => {
      const li = document.createElement("li");
      if (row.name === highlightName && row.score === highlightScore) {
        li.classList.add("highlight");
      }
      const rankSpan = document.createElement("span");
      rankSpan.className = "rank";
      rankSpan.textContent = `${i + 1}`;
      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = row.name;
      const scoreSpan = document.createElement("span");
      scoreSpan.className = "score";
      scoreSpan.textContent = row.score;
      li.append(rankSpan, nameSpan, scoreSpan);
      listEl.appendChild(li);
    });
  }

  async function openLeaderboardModal() {
    leaderboardModal.classList.remove("hidden");
    leaderboardListEl.innerHTML = "";
    leaderboardStatusEl.classList.add("hidden");
    try {
      const rows = await window.Leaderboard.fetchTopScores();
      renderLeaderboardRows(leaderboardListEl, rows);
    } catch (err) {
      leaderboardStatusEl.textContent = "순위표를 불러올 수 없습니다.";
      leaderboardStatusEl.classList.remove("hidden");
    }
  }

  leaderboardBtn.addEventListener("click", openLeaderboardModal);
  leaderboardCloseBtn.addEventListener("click", () => {
    leaderboardModal.classList.add("hidden");
  });

  async function handleGameOverRanking(finalScore) {
    rankEntryEl.classList.add("hidden");
    rankResultEl.classList.add("hidden");
    rankNameInput.value = "";
    try {
      const { qualifies, rank, top } = await window.Leaderboard.getRankForScore(finalScore);
      if (qualifies) {
        rankEntryEl.classList.remove("hidden");
        rankEntryMessageEl.textContent = `축하합니다! ${rank}위에 등록할 수 있어요!`;
        rankSubmitBtn.onclick = () => submitRankEntry(finalScore);
      } else {
        showRankResult(top, null, null, "아쉽지만 10위 안에 들지 못했어요. 순위표를 확인해보세요!");
      }
    } catch (err) {
      showRankResult([], null, null, "순위표를 불러올 수 없습니다.");
    }
  }

  async function submitRankEntry(finalScore) {
    const name = rankNameInput.value.trim().slice(0, 12) || "익명";
    rankSubmitBtn.disabled = true;
    try {
      await window.Leaderboard.submitScore(name, finalScore);
      const top = await window.Leaderboard.fetchTopScores();
      showRankResult(top, name, finalScore, "등록 완료!");
    } catch (err) {
      rankEntryMessageEl.textContent = "등록에 실패했습니다. 다시 시도해주세요.";
    } finally {
      rankSubmitBtn.disabled = false;
    }
  }

  function showRankResult(rows, highlightName, highlightScore, statusText) {
    rankEntryEl.classList.add("hidden");
    rankResultEl.classList.remove("hidden");
    rankResultStatusEl.textContent = statusText;
    renderLeaderboardRows(rankLeaderboardListEl, rows, highlightName, highlightScore);
  }

  // ---------- Game over ----------
  function checkGameOver(dt) {
    const now = performance.now();
    let danger = false;
    Composite.allBodies(world).forEach((b) => {
      if (b.isStatic || b.tierIndex === undefined) return;
      if (now - b.spawnTime < SPAWN_GRACE_MS) return;
      const speed = Math.hypot(b.velocity.x, b.velocity.y);
      if (speed > 1.2) return;
      if (b.position.y - b.circleRadius < DANGER_Y) danger = true;
    });

    if (danger) {
      dangerTimer += dt;
      if (dangerTimer >= DANGER_HOLD_MS) {
        triggerGameOver();
      }
    } else {
      dangerTimer = 0;
    }
  }

  function triggerGameOver() {
    running = false;
    finalScoreEl.textContent = score;
    finalComboEl.textContent = maxCombo;
    gameOverModal.classList.remove("hidden");
    handleGameOverRanking(score);
  }

  function resetGame() {
    Composite.allBodies(world).forEach((b) => {
      if (!b.isStatic) Composite.remove(world, b);
    });
    score = 0;
    scoreEl.textContent = "0";
    dangerTimer = 0;
    pendingMerges.length = 0;
    pendingTierIndex = randomSpawnTier();
    updateNextPreview();
    gameOverModal.classList.add("hidden");
    rankEntryEl.classList.add("hidden");
    rankResultEl.classList.add("hidden");
    rankNameInput.value = "";

    combo = 0;
    comboTimer = 0;
    maxCombo = 0;
    scorePopups.length = 0;
    shake.time = 0;
    shake.duration = 0;
    shake.mag = 0;
    comboBarFillEl.style.width = "0%";
    updateComboUI();

    running = true;
    lastTime = performance.now();
  }

  // ---------- Rendering ----------
  function drawDangerLine() {
    ctx.save();
    ctx.strokeStyle = "rgba(226, 109, 146, 0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, DANGER_Y);
    ctx.lineTo(WIDTH, DANGER_Y);
    ctx.stroke();
    ctx.restore();
  }

  function drawCat(body) {
    const tier = TIERS[body.tierIndex];
    const { x, y } = body.position;
    const r = tier.radius;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(body.angle);

    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, tier.color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.stroke();

    ctx.rotate(-body.angle);
    ctx.font = `${Math.round(r * 1.15)}px "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tier.emoji, 0, r * 0.05);
    ctx.restore();
  }

  function drawPendingGhost() {
    if (!running) return;
    const tier = TIERS[pendingTierIndex];
    const y = tier.radius + 6;
    ctx.save();
    ctx.globalAlpha = dropLocked ? 0.35 : 0.85;
    ctx.strokeStyle = "rgba(226, 109, 146, 0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pendingX, y + tier.radius);
    ctx.lineTo(pendingX, HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.translate(pendingX, y);
    ctx.beginPath();
    ctx.arc(0, 0, tier.radius, 0, Math.PI * 2);
    ctx.fillStyle = tier.color;
    ctx.fill();
    ctx.font = `${Math.round(tier.radius * 1.15)}px "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tier.emoji, 0, tier.radius * 0.05);
    ctx.restore();
  }

  function drawScorePopups() {
    scorePopups.forEach((p) => {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.font = `800 ${Math.round(p.fontSize)}px "Segoe UI", "Malgun Gothic", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    });
  }

  function render() {
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    let sx = 0;
    let sy = 0;
    if (shake.time > 0) {
      const p = shake.time / shake.duration;
      const amt = shake.mag * p;
      sx = (Math.random() * 2 - 1) * amt;
      sy = (Math.random() * 2 - 1) * amt;
    }
    ctx.translate(sx, sy);

    drawDangerLine();
    Composite.allBodies(world).forEach((b) => {
      if (!b.isStatic && b.tierIndex !== undefined) drawCat(b);
    });
    drawPendingGhost();
    drawScorePopups();

    ctx.restore();
  }

  // ---------- Main loop ----------
  function loop(now) {
    const dt = Math.min(50, now - lastTime);
    lastTime = now;

    if (running) {
      Engine.update(engine, dt);
      processMerges();
      checkGameOver(dt);

      if (combo > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0) {
          combo = 0;
          comboTimer = 0;
          updateComboUI();
        }
        comboBarFillEl.style.width = `${Math.max(0, (comboTimer / COMBO_WINDOW_MS) * 100)}%`;
      }

      if (shake.time > 0) shake.time = Math.max(0, shake.time - dt);

      for (let i = scorePopups.length - 1; i >= 0; i--) {
        const p = scorePopups[i];
        p.life -= dt;
        p.y -= dt * 0.05;
        if (p.life <= 0) scorePopups.splice(i, 1);
      }
    }
    render();
    requestAnimationFrame(loop);
  }

  // ---------- Init ----------
  function init() {
    buildTierbar();
    updateNextPreview();
    resize();
    pendingX = WIDTH / 2;
    requestAnimationFrame(loop);
  }

  init();
})();
