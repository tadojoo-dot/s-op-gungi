# 건기식 S&OP 대시보드 — Design System

> **사용 지침**: 이 문서는 디자인 토큰 및 UI 컴포넌트 스타일 전용 참조 문서입니다.
> 색상·타이포그래피·레이아웃·컴포넌트 형태만 참고하고, 내용·데이터·비즈니스 로직은 포함하지 않습니다.
> 새로운 화면 제작 시 이 문서의 스타일을 동일하게 적용하여 시각적 일관성을 유지하세요.

---

## 1. Color Palette (CSS Variables)

```css
:root {
  /* Brand */
  --navy:     #1D2783;   /* primary, CTA, header accent */
  --navy-dk:  #10145C;   /* global header/tabbar background */
  --terra:    #C46B4D;   /* warning, accent bar, active tab underline */

  /* Semantic */
  --green:    #33512E;   /* positive, OK signal */
  --green-lt: #eaf2e8;   /* green badge background */
  --red:      #D64545;   /* danger, negative */
  --red-lt:   #fdecea;   /* red badge background */
  --yellow:   #E3B341;   /* caution */
  --yellow-lt:#fef8ec;   /* yellow badge background */

  /* Neutral */
  --page:     #F0F1F5;   /* page background */
  --card:     #ffffff;   /* card / panel background */
  --border:   #E4E6EF;   /* divider, border */
  --text:     #1a1a2e;   /* body text */
  --muted:    #7a8099;   /* secondary text, labels */
  --gray-l:   #E2E2E2;
  --gray-m:   #C9C9C9;
}
```

### Signal Dots / Status Colors
| Class | Color | 의미 |
|---|---|---|
| `.sig-r` | `var(--red)` | 위험 |
| `.sig-y` | `var(--terra)` | 주의 |
| `.sig-g` | `var(--green)` | 정상 |
| `.sig-x` | `var(--yellow)` | 특이 |
| `.sig-gr` | `var(--gray-m)` | 비활성 |

### Input Field State Colors
| 상태 | 배경 | 테두리 하단 | 텍스트 |
|---|---|---|---|
| 기본 (편집 가능) | `#fdf0eb` | `2px dashed #c9856a` | `#7c3a22` |
| 엑셀 업로드값 | `#dcfce7` | `2px dashed #22c55e` | `#166534` |
| 수동 수정값 | `#fce7f3` | `2px solid #ec4899` | `#9d174d` |

---

## 2. Typography

```
font-family: 'Apple SD Gothic Neo', '맑은 고딕', sans-serif
```

| 용도 | font-size | font-weight |
|---|---|---|
| 페이지 기본 | 13px | 400 |
| 글로벌 헤더 타이틀 | 16px | 800 |
| 섹션 카드 헤더 | 13px | 800 |
| KPI 수치 (대형) | 30–34px | 800–900 |
| 목표 수치 | 24–28px | 800–900 |
| 테이블 헤더 | 11px | 700–800 |
| 테이블 바디 | 12px | 400 |
| 배지/칩 | 10px | 700 |
| 보조 설명 | 10–11px | 400–600 |
| 탭 한글 | 13px | 700 |
| 탭 영문 sub | 9px | 600, letter-spacing: 0.8px |

---

## 3. Layout

- **최소 너비**: `1280px`
- **좌우 패딩**: `28px`
- **섹션 간격**: `16–18px`
- **Sticky 레이어**:
  - Global Header: `top: 0`, `z-index: 300`
  - Filter Bar: `top: 54px`, `z-index: 290`
  - Tab Bar: `top: 58px`, `z-index: 280`

### Grid Classes
```css
.g2  { grid-template-columns: 1fr 1fr; gap: 16px; }
.g3  { grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.g64 { grid-template-columns: 6fr 4fr; gap: 16px; }
```

---

## 4. Global Header (`.hdr`)

```
배경: var(--navy-dk)  #10145C
높이: 58px
패딩: 0 28px
shadow: 0 2px 10px rgba(0,0,0,.3)
position: sticky, top: 0
```

- **좌측 액센트 바 (`.hdr-bar`)**: `4px × 34px`, 색상 `var(--terra)`, border-radius `2px`
- **타이틀**: `16px / 800 / #fff`
- **부제목**: `10px / rgba(255,255,255,.5)`
- **우측 정보**: `11px / rgba(255,255,255,.65)`, `strong` → `#fff`
- **Pill 버튼 (필터)**: 반투명 흰색 배경, 활성 시 흰색 배경 + `var(--navy)` 텍스트, border-radius `20px`

---

## 5. Tab Bar (`.tabbar`)

```
배경: var(--navy-dk)
border-bottom: 2px solid rgba(0,0,0,.35)
패딩: 0 16px
height of each tab: 48px
```

- **탭 한글 (`.tab-kr`)**: 13px / 700 / `rgba(255,255,255,.6)`
- **탭 영문 (`.tab-en`)**: 9px / 600 / `rgba(255,255,255,.35)`, uppercase
- **활성 탭**: 한글 `#fff`, 영문 `var(--terra)`, 하단 밑줄 `3px solid var(--terra)`
- **전략 탭 특별**: 한글 `#FFD166`, `font-weight: 900`
- **업로드 버튼 (`.tab-upload-btn`)**: `1.5px dashed rgba(255,255,255,.3)`, border-radius `6px`

---

## 6. Filter Bar (`.fbar`)

```
배경: #F7F8FA
border-bottom: 1px solid var(--border)
height: 46px
gap: 14px
```

- **레이블**: `11px / 600 / var(--muted)`
- **Select / Input**: `height 30px`, border-radius `6px`, `12px`

---

## 7. Section Card (`.sec-card`)

```
배경: var(--card)  #fff
border: 1px solid var(--border)
border-radius: 8px
box-shadow: 0 1px 4px rgba(0,0,0,.05)
margin-bottom: 16px
```

### Section Header (`.sec-head`)
```
배경: #2b2b2b  (다크 그레이)
padding: 11px 18px
```
- **액센트 바 (`.sec-bar`)**: `3px × 17px`, `var(--terra)`, border-radius `2px`
- **타이틀**: `13px / 800 / #fff`
- **부제목**: `10px / rgba(255,255,255,.6)`

---

## 8. KPI Cards (`.kpi-row`)

```
display: grid, 4열
배경(행): var(--border) — grid gap 역할
border-radius: 10px
box-shadow: 0 2px 8px rgba(0,0,0,.08)
```

각 KPI 카드 상단 `3px solid` 강조선:
- 1번: `var(--terra)`
- 2번: `var(--navy)`
- 3번: `var(--green)`
- 4번: `var(--red)`

| 요소 | 스타일 |
|---|---|
| 레이블 | `10.5px / 700 / var(--muted)`, uppercase, letter-spacing `.4px` |
| 수치 | `30px / 800`, line-height 1 |
| 부가 설명 | `11px / var(--muted)` |
| 배지 | `10px / 700`, border-radius `3px` |

---

## 9. Tables

### 일반 테이블 (`.aging-matrix`, `.psi-tbl`)
```
border-collapse: collapse
font-size: 12px
```

| 요소 | 스타일 |
|---|---|
| `th` | 배경 `#1D2783`, 텍스트 `#fff`, `11px / 700`, border `1px solid #2d3a9a` |
| `th.plan-hd` | 배경 `#2d3a9a` |
| `th.rate-hd` | 배경 `#10145C` |
| `td` | border `1px solid var(--border)` |
| `td.warn` | 배경 `#fef8ec`, 텍스트 `var(--terra)`, bold |
| `td.danger` | 배경 `var(--red-lt)`, 텍스트 `var(--red)`, bold |
| `td.total-col` | 배경 `#f7f8fa`, 텍스트 `var(--navy)`, `800` |
| `tr.total-row td` | 배경 `#eef0f9`, `800` |
| `td:hover` | 배경 `#dde4ff` |
| `td.active` | 배경 `#c7d2ff`, outline `2px solid var(--navy)` |

### 드릴다운 테이블 (`.dd-table`)
```
th: 배경 #eef0f9, 텍스트 var(--navy), 11px / 800
td: border-bottom 1px solid #f0f1f5
tr:hover: 배경 #f0f3ff
```

### 목표/전략 테이블 (`.goal-table`)
```
th: 배경 var(--navy), 텍스트 #fff, 9px 11px padding
td: border 1px solid var(--border), 12px, line-height 1.55
```

---

## 10. Tags / Chips / Badges

### Remark Chips (`.rem-chip`)
```
display: inline-block
padding: 1px 7px
border-radius: 10px
font-size: 10px / 700
```
| Class | 배경 | 텍스트 |
|---|---|---|
| `.rem-r` | `var(--red-lt)` | `var(--red)` |
| `.rem-y` | `var(--yellow-lt)` | `#8a5c00` |
| `.rem-g` | `var(--green-lt)` | `var(--green)` |
| `.rem-b` | `#eaedff` | `var(--navy)` |

### KPI Badges
| Class | 배경 | 텍스트 |
|---|---|---|
| `.kb-r` | `var(--red-lt)` | `var(--red)` |
| `.kb-y` | `var(--yellow-lt)` | `#8a5c00` |
| `.kb-g` | `var(--green-lt)` | `var(--green)` |

---

## 11. Alert Banner (`.alert`)

```
display: flex, align-items: center
padding: 9px 14px
border-radius: 7px
font-size: 12px / 600
margin-bottom: 14px
border-left: 4px solid [색상]
```

| 타입 | 배경 | 왼쪽 선 | 텍스트 |
|---|---|---|---|
| `.alert.r` | `var(--red-lt)` | `var(--red)` | `var(--red)` |
| `.alert.y` | `var(--yellow-lt)` | `var(--yellow)` | `#7a5000` |

---

## 12. Buttons

| 종류 | 배경 | 텍스트 | border-radius | 기타 |
|---|---|---|---|---|
| Primary (`.sim-btn`) | `var(--navy)` | `#fff` | `6px` | `height 34px` |
| Print/보조 (`.btn-print`) | `rgba(255,255,255,.13)` | `#fff` | `6px` | 탭바 내부용 |
| 저장 버튼 | `#1D2783` | `#fff` | `4px` | `font-size 11px` |
| 삭제 버튼 | `#fee2e2` | `#b91c1c` | `4px` | `font-size 11px` |
| 전체 초기화 | `#fee2e2` | `#b91c1c` | `6px` | `font-size 11px` |

---

## 13. Input Fields

### 기본 Select / Input
```
height: 30–34px
border: 1px solid var(--border)
border-radius: 6px
padding: 0 10px
font-size: 12px
background: #fff
```

### 소진계획 셀 (`.plan-cell`, `contenteditable`)
```
배경: #fff0f6
border: 1px solid #f3b6cf
font-size: 11px
```
- 포커스: `outline 2px solid #e783a9`, 배경 `#ffe6f0`
- 빈 상태 placeholder: `color #c96b91 / 700`
- 저장 완료: `.saved` 클래스 → 배경 `#fce7f0`

### 입고계획 편집 인풋 (`.buy-edit`)
```
width: 76px
border: 1px solid #e8c9b8
border-bottom: 2px dashed #c9856a
background: #fdf0eb
color: #7c3a22
border-radius: 4px
font-size: 12px / 700
text-align: right
```
- `.buy-excel`: 배경 `#dcfce7`, 텍스트 `#166534`, 하단 `2px dashed #22c55e`
- `.buy-edited`: 배경 `#fce7f3`, 텍스트 `#9d174d`, 하단 `2px solid #ec4899`

---

## 14. Drilldown Panel (`.drilldown`)

```
배경: #f7f9ff
border: 2px solid var(--navy)
border-radius: 6px
padding: 14px
```

- **타이틀**: `22px / 800 / var(--navy)`
- **닫기 버튼**: `18px / var(--muted)`, 배경 없음
- **메모 영역 (`.dd-memo-wrap`)**: 배경 `#f0f3ff`, border-left `3px solid var(--navy)`, border-radius `6px`
- **메모 레이블**: `11px / 700 / var(--navy)`
- **메모 textarea**: border-radius `4px`, focus 시 `border-color: var(--navy)`

---

## 15. Simulation / Remark Box

### 시뮬레이션 패널 (`.sim-wrap`)
```
배경: #eef0f9
border: 1px solid #d0d4ee
border-radius: 8px
padding: 14px 16px
```
- 타이틀: `13px / 800 / var(--navy)`

### Impact Cards (`.impact-card`)
```
배경: var(--card)
border: 1px solid var(--border)
border-radius: 8px
padding: 14px
3열 그리드 (gap: 12px)
```
| 타입 | border | 배경 |
|---|---|---|
| `.danger-card` | `var(--red)` | `var(--red-lt)` |
| `.warn-card` | `var(--yellow)` | `var(--yellow-lt)` |
| `.ok-card` | `var(--green)` | `var(--green-lt)` |

### Toast 알림 (`#buyToast`)
```
position: fixed, bottom: 24px, right: 24px
배경: #1D2783
color: #fff
border-radius: 8px
padding: 10px 18px
font-size: 13px / 700
opacity transition: 0.3s
```

---

## 16. Causal Chain (`.causal-chain`)

```
display: flex, align-items: center
overflow-x: auto
padding: 12px 0
```

각 노드 (`.causal-node`):
```
배경: var(--card)
border: 1px solid var(--border)
border-radius: 8px
padding: 12px 14px
min-width: 140px
text-align: center
```
| 타입 | border | 배경 |
|---|---|---|
| `.cause` | `var(--red)` | `var(--red-lt)` |
| `.effect` | `var(--yellow)` | `var(--yellow-lt)` |
| `.result` | `var(--navy)` | `#eaedff` |

화살표 (`.causal-arrow`): `20px / var(--muted)`, padding `0 6px`

---

## 17. Execution Steps (`.exec-step`)

```
display: grid, grid-template-columns: 120px 1fr 170px
border: 1px solid var(--border)
배경: #fff
font-size: 12px / line-height 1.55
```

- 각 셀: `padding 10px 12px`, `border-right 1px solid var(--border)`
- 단계 표시 (`.phase`): 배경 `var(--terra)`, 텍스트 `#fff`, `font-weight 900`, `text-align center`

---

## 18. 반복 패턴 요약

| 패턴 | 값 |
|---|---|
| 카드 border-radius | `8px` (기본), `10px` (KPI), `6px` (드릴다운/심플) |
| 액센트 바 | 좌측 `3–4px solid` 컬러, 주로 `var(--terra)` 또는 `var(--navy)` |
| 다크 헤더 색 | `#2b2b2b` (섹션), `#10145C` (글로벌) |
| 테이블 헤더 | `#1D2783` (기본), `#eef0f9` (보조) |
| Hover 하이라이트 | `#dde4ff` (테이블 셀), `#f0f3ff` (드릴다운 행) |
| 활성 선택 | `#c7d2ff` + `outline 2px solid var(--navy)` |
| 전략/경고 강조색 | `#FFD166` (골드), `var(--red)` |
