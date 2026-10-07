# lmj451-sketchlens-frontend-ui-v6

진단 구조를 **DeepSeek(채점) → LLM(설명) 2단계**로 정한 버전. 파일 구조는 v5와 같음 (html / css / js 분리).

## 진단 흐름
1. **1단계 · DeepSeek (분류 · 채점)**
   모델: `deepseek-v4-flash-vision-exp` (DeepSeek에서 이미지를 받는 비전 모델, 실험 버전)
   이미지 + 고정 프롬프트(채점 기준표) → relevance(관련성·확신도·카테고리) + 세부 기준별 rating·observation
   → Django가 점수 공식으로 항목 점수 계산
2. **2단계 · LLM (진단 리포트 · 개선 문장)**
   1단계 채점 JSON + 고민 글·focus + 같은 카테고리 데이터셋 근거 → 항목별 개선 문장(advice)
   1단계 점수·판정은 바꾸지 않고 설명만 작성
- 1단계에서 **거절**되면 2단계는 호출하지 않음
- **재확인**이면 사용자가 "스케치가 맞아요"를 누른 뒤 2단계 호출

## v5 → v6 변경 사항
- 평가 항목을 수행계획서 루브릭 5개로 통일: 선 품질 · 비율 · 실루엣 · 균형 · 디테일
- 점수: 백분위(하위 n%) → 루브릭 점수 0~100
  - 항목 점수 = 유효한 세부 기준 점수 합계 ÷ (유효한 세부 기준 개수 × 2) × 100
  - 판단 불가(cannot_judge) · 해당 없음(not_applicable)은 계산에서 제외, 유효 기준이 없으면 null
- 결과 항목을 펼치면 세부 기준별 점수(2/1/0)와 근거 문장(observation) 표시
- 패션 스케치 확인을 계획서 예외처리 흐름도와 동일하게 구현 (confidence 0.8 / 0.4) → `decideRelevance()`
- 고민 글에서 찾은 진단 초점을 문장으로 보여주고 확인받는 안내 추가
- "측정값" 탭 → "입력·출력" 탭: 입력값과 1단계·2단계 응답 JSON 표시
- "기준 가이드" 메뉴를 루브릭 설명 화면으로 연결 (`#guide`)
- MobileNetV3 관련 문구 삭제, 한글 줄바꿈(keep-all) 적용

## 지금 상태
서버 연동 전이라 `buildDemoStage1()` / `buildDemoStage2()`가 이미지 픽셀을 간단히 계산해
**실제 응답과 같은 모양의 JSON**을 만든다. 점수 값 자체는 의미 없고 화면 흐름·입출력 형식 확인용.

## Django 연동 시 바꿀 곳 (js/sketchlens.js에서 `TODO(Django 연동 지점)` 검색)
1. `requestDiagnosis()` → `POST /api/diagnose/` FormData(image, worry, focus), CSRF 토큰 포함
2. `requestAdvice()` → `POST /api/advice/` {diagnosis_id}
3. 항목 점수 계산은 모델에 맡기지 말고 Django에서 위 공식으로 계산 (안)
4. 고민 글 → focus 해석(모델 / 키워드 규칙)은 DeepSeek 테스트 후 결정. 지금은 키워드 규칙(`RULES`)

### 1단계 응답 예시 (`/api/diagnose/`)
```json
{
  "diagnosis_id": "…",
  "criteria_version": "v1_draft",
  "relevance": { "relevant": true, "confidence": 0.92, "category": "티셔츠", "reason": "" },
  "focus": ["proportion", "balance"],
  "scores": { "line_quality": 83, "proportion": 67, "silhouette": 100, "balance": 67, "detail": 100 },
  "evidence": {
    "proportion": {
      "status": "analyzed",
      "subratings": [
        { "criterion": "대응 부위의 길이 차이", "status": "analyzed", "rating": 0, "observation": "오른쪽 선 양이 반대쪽의 1.43배" },
        { "criterion": "대응 부위의 너비 차이", "status": "analyzed", "rating": 2, "observation": "중심선 기준 좌우 폭 차이가 전체 너비의 2%" },
        { "criterion": "부위 간 크기 관계", "status": "analyzed", "rating": 2, "observation": "전체 세로/가로 비율 0.90" }
      ],
      "earned_points": 4, "max_points": 6
    }
  }
}
```

### 2단계 응답 예시 (`/api/advice/`)
```json
{
  "diagnosis_id": "…",
  "advice": { "proportion": "어깨너비와 총장 기준을 먼저 정하고, 좌우 소매처럼 짝이 되는 부위의 길이를 …" }
}
```

## 확인 필요
- 선 품질 외 4개 항목의 세부 기준은 초안 (`AXES` 배열). 팀에서 확정하면 1단계 DeepSeek 고정 프롬프트의 채점 기준표와 함께 바꿀 것.
- DeepSeek 공개 API에서 이미지를 받는 건 실험 모델(`deepseek-v4-flash-vision-exp`)뿐이고, 다른 모델에 이미지를 보내면 400 오류. 실험 버전이라 테스트로 채점 품질을 먼저 확인할 것.
