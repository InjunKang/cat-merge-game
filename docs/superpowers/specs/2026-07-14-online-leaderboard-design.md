# 온라인 공유 순위표 (Leaderboard) 설계

## 목표
냥이 합치기 게임에 전 세계 플레이어가 공유하는 온라인 순위표를 추가한다.
- 언제든 top 10 순위(등수 + 이름 + 점수)를 볼 수 있다.
- 게임오버 시 자신의 최종 점수가 top 10에 들면 이름을 입력해 등록할 수 있다.

## 배경 / 제약
- 현재 프로젝트는 빌드 도구 없는 정적 사이트(`index.html` + `game.js` + `style.css`, `lib/matter.min.js`)이다.
- 서버 코드가 없으므로 백엔드로 **Supabase**(Postgres + 클라이언트 SDK)를 사용한다. 서버 코드를 직접 작성하지 않고, 브라우저에서 `@supabase/supabase-js` SDK로 DB에 직접 접근한다.
- Supabase 프로젝트는 아직 없음 — 사용자가 직접 생성 후 Project URL / anon key를 전달한다. 이 값들이 전달되기 전까지는 플레이스홀더로 두고 나머지 기능을 구현한다.
- **알려진 한계 (의도적으로 범위 제외):** 점수는 클라이언트(브라우저)가 직접 Supabase에 전송한다. 개발자도구로 임의의 점수를 등록하는 것을 막는 서버 측 검증은 이번 범위에 포함하지 않는다. 재미용 캐주얼 순위표로 취급한다.

## 데이터 모델 (Supabase / Postgres)

테이블 `leaderboard`:

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | `bigint generated always as identity` (PK) | |
| `name` | `text`, `not null`, 길이 1~12자 | 플레이어 이름 |
| `score` | `integer`, `not null`, `>= 0` | 최종 점수 |
| `created_at` | `timestamptz`, `default now()` | 등록 시각 |

인덱스: `score desc` 정렬 조회를 위해 `create index on leaderboard (score desc);`

RLS (Row Level Security):
- `select`: 모두 허용 (누구나 순위표 조회)
- `insert`: 모두 허용, 단 `name`이 1~12자이고 `score >= 0`인 경우만 (체크 제약 또는 RLS policy where 절로 처리)
- `update` / `delete`: 정책 없음 → 사실상 금지

## 클라이언트 아키텍처

### 새 모듈: `leaderboard.js`
Supabase 연동 로직을 `game.js`와 분리된 파일로 둔다 (관심사 분리, `game.js`는 이미 500줄에 근접).

- `initLeaderboard(url, anonKey)` — Supabase 클라이언트 생성
- `async fetchTopScores(limit = 10)` — 상위 N개 `{name, score}` 배열 반환
- `async submitScore(name, score)` — 새 행 insert
- `async getRankForScore(score)` — 현재 top 10 기준으로, 이 점수가 몇 위에 들어갈지 계산 (10위 안에 드는지 판단용). top 10개를 가져와 개수 < 10이면 무조건 등록 가능, 아니면 10위 점수와 비교.

`index.html`에 CDN으로 `@supabase/supabase-js` 스크립트 태그와 `leaderboard.js`를 `game.js` 이전에 로드.

Supabase URL/anon key는 `leaderboard.js` 상단에 상수로 하드코딩 (anon key는 공개용 키라 정적 사이트에 노출되어도 문제 없음 — RLS로 접근 제어).

### UI 변경

**상단바:** 기존 `.scores` 옆에 "🏆 순위표" 버튼 추가. 클릭 시 새 모달 `#leaderboard-modal`을 열어 `fetchTopScores()` 결과를 순위/이름/점수 리스트로 렌더링. 로딩 중/에러 상태도 간단히 표시.

**게임오버 모달 (`#game-over-modal`):**
1. 기존처럼 최종 점수/최고 콤보 표시.
2. `getRankForScore(finalScore)` 호출해 top 10 진입 여부 확인.
3. top 10 진입 시: 이름 입력 폼(텍스트 인풋 + 등록 버튼, maxlength=12) 표시. 등록 시 `submitScore()` 호출 후 폼을 순위표 뷰로 교체.
4. top 10 밖이면: 이름 입력 없이 바로 현재 top 10 순위표를 참고용으로 보여줌.
5. 두 경우 모두 순위표에는 등수, 이름, 점수를 나란히 표시. 방금 등록한 본인 항목은 강조 표시.

기존 `restart-btn` 동작은 변경하지 않는다.

## 에러 처리
- Supabase 요청 실패(네트워크 오류, 아직 미설정 등) 시 모달에 "순위표를 불러올 수 없습니다" 같은 간단한 메시지만 표시하고 게임 진행에는 영향 없음 (throw하지 않고 콘솔 경고 + UI 메시지로 처리).

## 테스트 / 검증
- 자동 테스트 프레임워크 없는 프로젝트이므로, 브라우저에서 수동으로 확인:
  - 순위표 버튼으로 top 10 조회 동작
  - 점수가 top 10 안/밖일 때 각각 이름 입력 폼 노출 여부
  - 이름 등록 후 목록 갱신 및 본인 항목 강조
  - Supabase 키 미설정/네트워크 실패 시 에러 메시지 노출 및 게임 정상 진행

## 미해결 / 후속 작업
- Supabase Project URL / anon key는 사용자가 전달 예정. 전달 전까지 플레이스홀더 상수로 두고, 전달되는 즉시 `leaderboard.js`에 반영.
- 실제 테이블/RLS 정책 SQL은 구현 계획 단계에서 사용자가 Supabase SQL Editor에 붙여넣을 수 있는 스크립트로 제공한다.
