# 온라인 공유 순위표 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 냥이 합치기 게임에 Supabase 기반 온라인 공유 순위표(top 10)를 추가하고, 게임오버 시 top 10에 들면 이름을 입력해 등록할 수 있게 한다.

**Architecture:** 정적 사이트(`index.html` + `game.js` + `style.css`)에 서버 코드 없이 `@supabase/supabase-js` 클라이언트 SDK를 CDN으로 불러와 브라우저에서 직접 Supabase Postgres에 접근한다. Supabase 연동 로직은 새 파일 `leaderboard.js`에 분리하고, `game.js`는 UI 렌더링과 게임 흐름 연결만 담당한다.

**Tech Stack:** 순수 HTML/CSS/JS (빌드 도구 없음), Matter.js(기존), `@supabase/supabase-js@2` (CDN, 신규), Supabase Postgres + RLS.

## Global Constraints

- 이 프로젝트에는 npm/빌드 도구/자동화 테스트 프레임워크가 없다. 모든 "테스트"는 브라우저에서 수동으로 확인한다.
- 기존 코드 스타일을 따른다: IIFE `(() => { "use strict"; ... })()` 패턴, `const X = document.getElementById(...)` 형태의 DOM 참조, 클래스 `hidden`으로 표시/숨김 토글.
- 모든 사용자 노출 문구는 한국어로 작성한다 (기존 UI와 동일한 톤).
- Supabase anon key는 공개용 키이므로 소스에 하드코딩해도 안전하다 — 접근 제어는 RLS 정책으로 한다. 서버 측 점수 검증(안티치트)은 이번 범위에서 명시적으로 제외한다 (스펙 문서 참고).
- 이름은 최대 12자, 비어있으면 "익명"으로 대체한다.
- Supabase Project URL/anon key는 Task 6까지 플레이스홀더 상수로 둔다. 실제 값은 사용자가 Supabase 프로젝트 생성 후 전달한다.

---

### Task 1: Supabase 스키마 SQL 스크립트

**Files:**
- Create: `docs/superpowers/specs/2026-07-14-leaderboard-schema.sql`

**Interfaces:**
- Produces: `leaderboard` 테이블 (컬럼 `id`, `name`, `score`, `created_at`) — Task 2의 `leaderboard.js`가 이 테이블 이름(`leaderboard`)과 컬럼명을 그대로 사용한다.

이 태스크는 코드 구현이 아니라, 사용자가 Supabase SQL Editor에 붙여넣어 실행할 스크립트를 작성하는 태스크다. 자동 테스트 없음 — 사용자가 Supabase 대시보드에서 직접 실행하고 결과를 확인한다.

- [ ] **Step 1: SQL 스크립트 작성**

```sql
create table if not exists leaderboard (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 12),
  score integer not null check (score >= 0),
  created_at timestamptz not null default now()
);

create index if not exists leaderboard_score_desc_idx on leaderboard (score desc);

alter table leaderboard enable row level security;

create policy "Allow public read" on leaderboard
  for select
  using (true);

create policy "Allow public insert" on leaderboard
  for insert
  with check (char_length(name) between 1 and 12 and score >= 0);
```

- [ ] **Step 2: 파일로 저장**

위 SQL을 `docs/superpowers/specs/2026-07-14-leaderboard-schema.sql`에 저장한다.

- [ ] **Step 3: 사용자에게 실행 안내**

사용자에게 다음을 요청한다: Supabase 프로젝트의 SQL Editor에 이 파일 내용을 붙여넣고 실행한 뒤, Settings > API에서 Project URL과 anon public key를 전달해달라고 요청한다. (이 값들은 Task 6에서 반영한다. 값이 오기 전까지 Task 2~5는 플레이스홀더로 진행 가능하다.)

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/specs/2026-07-14-leaderboard-schema.sql
git commit -m "Add Supabase schema SQL for leaderboard table"
```

---

### Task 2: `leaderboard.js` 데이터 계층

**Files:**
- Create: `leaderboard.js`

**Interfaces:**
- Consumes: 전역 `window.supabase.createClient(url, anonKey)` (CDN으로 로드되는 `@supabase/supabase-js` UMD 빌드, Task 3에서 스크립트 태그 추가)
- Produces: 전역 `window.Leaderboard` 객체:
  - `async fetchTopScores(limit = 10) => Array<{ name: string, score: number }>` (score 내림차순, 실패 시 throw)
  - `async submitScore(name: string, score: number) => void` (실패 시 throw)
  - `async getRankForScore(score: number) => { qualifies: boolean, rank: number|null, top: Array<{name:string, score:number}> }`

- [ ] **Step 1: `leaderboard.js` 작성**

```js
(() => {
  "use strict";

  const SUPABASE_URL = "YOUR_SUPABASE_URL"; // TODO: Task 6에서 실제 Supabase Project URL로 교체
  const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"; // TODO: Task 6에서 실제 anon public key로 교체
  const TABLE_NAME = "leaderboard";
  const TOP_N = 10;

  let client = null;
  function getClient() {
    if (client) return client;
    if (!window.supabase || SUPABASE_URL.startsWith("YOUR_")) return null;
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return client;
  }

  async function fetchTopScores(limit = TOP_N) {
    const supabase = getClient();
    if (!supabase) throw new Error("Supabase가 아직 설정되지 않았습니다.");
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select("name, score")
      .order("score", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  async function submitScore(name, score) {
    const supabase = getClient();
    if (!supabase) throw new Error("Supabase가 아직 설정되지 않았습니다.");
    const trimmed = String(name).trim().slice(0, 12) || "익명";
    const { error } = await supabase.from(TABLE_NAME).insert({ name: trimmed, score });
    if (error) throw error;
  }

  async function getRankForScore(score) {
    const top = await fetchTopScores(TOP_N);
    if (top.length < TOP_N) {
      let insertAt = top.findIndex((row) => score > row.score);
      if (insertAt === -1) insertAt = top.length;
      return { qualifies: true, rank: insertAt + 1, top };
    }
    const insertAt = top.findIndex((row) => score > row.score);
    if (insertAt === -1) return { qualifies: false, rank: null, top };
    return { qualifies: true, rank: insertAt + 1, top };
  }

  window.Leaderboard = { fetchTopScores, submitScore, getRankForScore };
})();
```

- [ ] **Step 2: 수동 확인 (플레이스홀더 상태에서 에러 처리 확인)**

로컬 서버를 띄운다 (PowerShell, 프로젝트 루트에서):

```powershell
python -m http.server 8080
```

브라우저에서 `http://localhost:8080/index.html` 을 열고 개발자도구 콘솔에서 다음을 실행한다:

```js
window.Leaderboard.fetchTopScores().catch(e => console.log("ERR:", e.message));
```

Expected: `ERR: Supabase가 아직 설정되지 않았습니다.` 가 출력됨 (아직 `index.html`에 `leaderboard.js`를 로드하는 태그가 없으므로, 이 확인은 Task 3 완료 후 다시 수행한다 — 지금은 `leaderboard.js` 문법 오류가 없는지만 `node --check leaderboard.js`로 확인한다).

```powershell
node --check leaderboard.js
```

Expected: 에러 없이 종료 (exit code 0).

- [ ] **Step 3: 커밋**

```bash
git add leaderboard.js
git commit -m "Add Supabase-backed leaderboard data layer"
```

---

### Task 3: UI 마크업 및 스타일 (`index.html`, `style.css`)

**Files:**
- Modify: `index.html`
- Modify: `style.css`

**Interfaces:**
- Consumes: 없음 (마크업/스타일만, Task 4/5에서 이 id들에 이벤트를 붙인다)
- Produces: 다음 DOM id들 — Task 4/5가 그대로 참조한다:
  - `leaderboard-btn`, `leaderboard-modal`, `leaderboard-list`, `leaderboard-status`, `leaderboard-close-btn`
  - `rank-entry`, `rank-entry-message`, `rank-name-input`, `rank-submit-btn`
  - `rank-result`, `rank-result-status`, `rank-leaderboard-list`

- [ ] **Step 1: `index.html`에 Supabase SDK + `leaderboard.js` 스크립트 태그 추가**

`index.html`의 다음 부분을 찾는다:

```html
  <script src="lib/matter.min.js"></script>
  <script src="game.js"></script>
</body>
```

다음으로 교체한다:

```html
  <script src="lib/matter.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <script src="leaderboard.js"></script>
  <script src="game.js"></script>
</body>
```

- [ ] **Step 2: 상단바에 순위표 버튼 추가**

다음 부분을 찾는다:

```html
      <div class="scores">
        <div class="score-box">
          <span class="label">SCORE</span>
          <span id="score">0</span>
        </div>
        <div class="score-box">
          <span class="label">BEST</span>
          <span id="best">0</span>
        </div>
      </div>
    </header>
```

다음으로 교체한다:

```html
      <div class="scores">
        <div class="score-box">
          <span class="label">SCORE</span>
          <span id="score">0</span>
        </div>
        <div class="score-box">
          <span class="label">BEST</span>
          <span id="best">0</span>
        </div>
      </div>
      <button id="leaderboard-btn" class="leaderboard-btn">🏆 순위표</button>
    </header>
```

- [ ] **Step 3: 게임오버 모달 확장 + 순위표 모달 추가**

다음 부분을 찾는다:

```html
  <div id="game-over-modal" class="hidden">
    <div class="modal-card">
      <h2>게임 오버!</h2>
      <p>최종 점수</p>
      <p id="final-score">0</p>
      <p id="final-combo-line">최고 콤보 <span id="final-combo">0</span></p>
      <button id="restart-btn">다시하기</button>
    </div>
  </div>
```

다음으로 교체한다:

```html
  <div id="game-over-modal" class="hidden">
    <div class="modal-card">
      <h2>게임 오버!</h2>
      <p>최종 점수</p>
      <p id="final-score">0</p>
      <p id="final-combo-line">최고 콤보 <span id="final-combo">0</span></p>

      <div id="rank-entry" class="hidden">
        <p id="rank-entry-message"></p>
        <input id="rank-name-input" type="text" maxlength="12" placeholder="이름을 입력하세요" />
        <button id="rank-submit-btn">등록</button>
      </div>

      <div id="rank-result" class="hidden">
        <p id="rank-result-status"></p>
        <ol id="rank-leaderboard-list" class="leaderboard-list"></ol>
      </div>

      <button id="restart-btn">다시하기</button>
    </div>
  </div>

  <div id="leaderboard-modal" class="hidden">
    <div class="modal-card">
      <h2>🏆 순위표</h2>
      <p id="leaderboard-status" class="hidden"></p>
      <ol id="leaderboard-list" class="leaderboard-list"></ol>
      <button id="leaderboard-close-btn">닫기</button>
    </div>
  </div>
```

- [ ] **Step 4: `style.css`에서 모달 오버레이 규칙에 `#leaderboard-modal` 포함**

다음 부분을 찾는다:

```css
#game-over-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

#game-over-modal.hidden {
  display: none;
}
```

다음으로 교체한다:

```css
#game-over-modal,
#leaderboard-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

#game-over-modal.hidden,
#leaderboard-modal.hidden {
  display: none;
}
```

- [ ] **Step 5: `style.css` 끝에 새 UI 스타일 추가**

`style.css` 파일 맨 끝(`#restart-btn:hover { ... }` 블록 다음)에 아래 내용을 추가한다:

```css

.leaderboard-btn {
  background: #ffffffaa;
  border: none;
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--accent-dark);
  cursor: pointer;
  white-space: nowrap;
}

.leaderboard-btn:hover {
  background: #ffffffdd;
}

.leaderboard-list {
  list-style: none;
  width: 260px;
  max-height: 260px;
  overflow-y: auto;
  margin: 12px 0;
  text-align: left;
}

.leaderboard-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 0.9rem;
}

.leaderboard-list li:nth-child(odd) {
  background: #ffffff88;
}

.leaderboard-list li.highlight {
  background: var(--accent);
  color: white;
  font-weight: 800;
}

.leaderboard-list .rank {
  width: 28px;
  font-weight: 800;
  color: var(--accent-dark);
}

.leaderboard-list li.highlight .rank {
  color: white;
}

.leaderboard-list .name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leaderboard-list .score {
  font-weight: 700;
}

#rank-entry,
#rank-result {
  margin: 10px 0 18px;
}

#rank-entry.hidden,
#rank-result.hidden {
  display: none;
}

#rank-entry-message,
#rank-result-status {
  font-size: 0.9rem;
  margin-bottom: 8px;
  color: var(--accent-dark);
  font-weight: 700;
}

#rank-name-input {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 0.9rem;
  margin-right: 6px;
  width: 140px;
}

#rank-submit-btn,
#leaderboard-close-btn {
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 10px;
  padding: 6px 16px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}

#rank-submit-btn:hover,
#leaderboard-close-btn:hover {
  background: var(--accent-dark);
}

#leaderboard-status {
  font-size: 0.85rem;
  color: var(--accent-dark);
}

#leaderboard-status.hidden {
  display: none;
}
```

- [ ] **Step 6: 수동 확인**

`python -m http.server 8080` 실행 후 `http://localhost:8080/index.html`을 연다. 확인 항목:
- 상단바에 "🏆 순위표" 버튼이 보인다.
- 개발자도구 콘솔에서 `document.getElementById('leaderboard-modal').classList.remove('hidden')` 실행 시 순위표 모달 카드가 중앙에 정상 스타일로 뜬다.
- 콘솔에서 `document.getElementById('rank-entry').classList.remove('hidden')` 실행 시 게임오버 모달을 먼저 연 상태(`document.getElementById('game-over-modal').classList.remove('hidden')`)에서 이름 입력창과 등록 버튼이 보인다.
- 콘솔 에러가 없는지 확인한다 (아직 버튼 클릭 핸들러는 없으므로 클릭해도 반응 없는 것은 정상).

- [ ] **Step 7: 커밋**

```bash
git add index.html style.css
git commit -m "Add leaderboard UI markup and styles"
```

---

### Task 4: `game.js` — 순위표 보기 기능 연결

**Files:**
- Modify: `game.js`

**Interfaces:**
- Consumes: `window.Leaderboard.fetchTopScores()` (Task 2), DOM id들 (Task 3)
- Produces: `renderLeaderboardRows(listEl, rows, highlightName, highlightScore)` — Task 5가 재사용한다.

- [ ] **Step 1: DOM 참조 추가**

`game.js`에서 다음 부분을 찾는다:

```js
  const comboBadgeEl = document.getElementById("combo-badge");
  const comboCountEl = document.getElementById("combo-count");
  const comboReactionEl = document.getElementById("combo-reaction");
  const comboBarFillEl = document.getElementById("combo-bar-fill");

  const BEST_KEY = "catMergeBest";
```

다음으로 교체한다:

```js
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
```

- [ ] **Step 2: 순위표 렌더링/모달 함수 추가**

`game.js`에서 다음 부분을 찾는다 (게임오버 섹션 시작 직전):

```js
  // ---------- Game over ----------
  function checkGameOver(dt) {
```

다음으로 교체한다:

```js
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

  // ---------- Game over ----------
  function checkGameOver(dt) {
```

- [ ] **Step 3: 수동 확인**

`node --check game.js`로 문법 오류가 없는지 확인한다:

```powershell
node --check game.js
```

Expected: 에러 없이 종료.

브라우저에서 `http://localhost:8080/index.html`을 새로고침하고 "🏆 순위표" 버튼을 클릭한다.

Expected: 모달이 열리고, 콘솔에 네트워크 에러가 나더라도 (아직 Task 6에서 실제 키를 넣기 전이므로) 모달 안에 "순위표를 불러올 수 없습니다." 메시지가 표시된다. 닫기 버튼을 누르면 모달이 닫힌다.

- [ ] **Step 4: 커밋**

```bash
git add game.js
git commit -m "Wire up leaderboard view modal in game.js"
```

---

### Task 5: `game.js` — 게임오버 랭킹 등록 흐름

**Files:**
- Modify: `game.js`

**Interfaces:**
- Consumes: `window.Leaderboard.getRankForScore(score)`, `window.Leaderboard.submitScore(name, score)`, `window.Leaderboard.fetchTopScores()` (Task 2), `renderLeaderboardRows` (Task 4)
- Produces: 없음 (최종 사용자 흐름)

- [ ] **Step 1: 랭킹 등록 함수 추가**

`game.js`에서 Task 4의 Step 2에서 추가한 `leaderboardCloseBtn.addEventListener(...)` 블록 바로 다음, `// ---------- Game over ----------` 주석 바로 앞에 아래 함수들을 추가한다. 찾을 부분:

```js
  leaderboardBtn.addEventListener("click", openLeaderboardModal);
  leaderboardCloseBtn.addEventListener("click", () => {
    leaderboardModal.classList.add("hidden");
  });

  // ---------- Game over ----------
```

다음으로 교체한다:

```js
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
```

- [ ] **Step 2: `triggerGameOver()`에서 랭킹 흐름 호출**

다음 부분을 찾는다:

```js
  function triggerGameOver() {
    running = false;
    finalScoreEl.textContent = score;
    finalComboEl.textContent = maxCombo;
    gameOverModal.classList.remove("hidden");
  }
```

다음으로 교체한다:

```js
  function triggerGameOver() {
    running = false;
    finalScoreEl.textContent = score;
    finalComboEl.textContent = maxCombo;
    gameOverModal.classList.remove("hidden");
    handleGameOverRanking(score);
  }
```

- [ ] **Step 3: `resetGame()`에서 랭킹 UI 초기화**

다음 부분을 찾는다:

```js
    pendingTierIndex = randomSpawnTier();
    updateNextPreview();
    gameOverModal.classList.add("hidden");

    combo = 0;
```

다음으로 교체한다:

```js
    pendingTierIndex = randomSpawnTier();
    updateNextPreview();
    gameOverModal.classList.add("hidden");
    rankEntryEl.classList.add("hidden");
    rankResultEl.classList.add("hidden");
    rankNameInput.value = "";

    combo = 0;
```

- [ ] **Step 4: 수동 확인**

```powershell
node --check game.js
```

Expected: 에러 없이 종료.

브라우저에서 `http://localhost:8080/index.html`을 새로고침하고 게임을 플레이해 일부러 게임오버를 낸다 (고양이를 위험선 위로 쌓이게 방치).

Expected: 게임오버 모달이 뜬 직후 (아직 Task 6 이전, Supabase 미설정 상태) 이름 입력 폼 대신 "순위표를 불러올 수 없습니다." 메시지가 담긴 결과 영역이 표시된다. "다시하기"를 누르면 모달이 닫히고 결과/입력 영역도 모두 숨겨진다.

- [ ] **Step 5: 커밋**

```bash
git add game.js
git commit -m "Wire up game-over leaderboard ranking flow"
```

---

### Task 6: Supabase 자격증명 반영 및 end-to-end 검증

**Files:**
- Modify: `leaderboard.js`

**Interfaces:**
- Consumes: 사용자가 Task 1에서 전달한 실제 Supabase Project URL / anon key
- Produces: 없음 (최종 통합 검증)

- [ ] **Step 1: 실제 Supabase 자격증명 반영**

사용자로부터 전달받은 값으로 `leaderboard.js` 상단을 수정한다:

```js
  const SUPABASE_URL = "YOUR_SUPABASE_URL"; // TODO: Task 6에서 실제 Supabase Project URL로 교체
  const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"; // TODO: Task 6에서 실제 anon public key로 교체
```

을 실제 값(예: `https://xxxxx.supabase.co`, `eyJ...` 형태의 anon key)으로 교체한다. **주의:** 이 값들이 담긴 커밋 메시지나 채팅에 다른 비밀키(service_role key 등)가 섞여 들어가지 않도록, anon public key인지 재확인한다.

- [ ] **Step 2: end-to-end 수동 검증**

```powershell
python -m http.server 8080
```

`http://localhost:8080/index.html`을 열고:
1. "🏆 순위표" 버튼 클릭 → 처음에는 빈 목록(또는 기존 데이터)이 에러 없이 뜨는지 확인.
2. 게임을 플레이해 일부러 게임오버를 낸다 → 순위표가 10개 미만이면 이름 입력 폼이 뜬다. 이름을 입력하고 "등록" 클릭.
3. 등록 후 결과 화면에 방금 입력한 이름/점수가 강조 표시되어 순위표에 나타나는지 확인.
4. "🏆 순위표" 버튼을 다시 눌러 방금 등록한 점수가 전체 순위표에도 반영되어 있는지 확인.
5. 같은 과정을 다른 브라우저(또는 시크릿 창)에서도 실행해, 두 브라우저에서 같은 순위표가 공유되는지 확인 (온라인 공유 요구사항 검증).
6. 10위 밖에 드는 낮은 점수로 한 번 더 게임오버를 내서, 이름 입력 없이 순위표만 보여주는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add leaderboard.js
git commit -m "Configure Supabase credentials for leaderboard"
```
