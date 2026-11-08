# IME manual checklist

CDP's `Input.imeSetComposition` (used by `e2e/ime-spike.spec.ts`) is Chromium-only
and cannot reproduce every real-IME ordering quirk: macOS's two-set Korean compositionend ordering, Safari's
`insertCompositionText`, or a real IME's mid-composition Enter/blur race. The
cases below need a human running an actual OS IME.

Status is honest, not aspirational: everything starts at "미검증" (unverified)
until someone has actually run it and recorded the result. Do not mark a row
"통과" without having run it.

## Composition cases (8 cases)

`e2e/ime.spec.ts` was added (Chromium-only, CDP `Input.imeSetComposition`),
which is a necessary-but-not-sufficient stand-in for a real OS IME -- "자동(chromium CDP)" below means "CDP's simulated composition
sequence exercises this path", NOT "verified against a real IME". The
Chrome (Windows MS IME)/Safari (macOS) columns are about a REAL IME engine
specifically and are untouched by this: they stay honestly 미검증 until a
human actually runs them, per this file's own rule.

| # | Case | Chromium 자동화 (CDP) | Chrome (Windows MS IME) | Safari (macOS) |
|---|------|------------------------|--------------------------|-----------------|
| 1 | 조합 중 Enter (composition, then Enter before it auto-confirms) | 자동(chromium CDP) -- `ime.spec.ts` "composition then Enter splits..." covers commit-then-Enter; Enter while STILL composing can't be reproduced (a real IME/CDP dedicates Enter to confirming the composition before it ever reaches the app, which our own `e.isComposing`/`keyCode===229` guard also assumes) | 미검증 | 미검증 |
| 2 | 조합 중 Backspace | 자동(chromium CDP) -- same file, "...then Backspace merges it back" (commit-then-Backspace; see #1's caveat for "during" specifically) | 미검증 | 미검증 |
| 3 | 조합 중 blur (클릭으로 다른 곳 포커스 이동) | 자동(chromium CDP) -- "composition then blur (click elsewhere) commits exactly once" (genuinely mid-composition, not yet committed) | 미검증 | 미검증 |
| 4 | 조합 중 Mod+B (bold 토글 명령) | 자동(chromium CDP) -- "a toolbar-style command right after composition flushes the pending sync first" (a mouse-driven toolbar command, which is what this case actually describes; a KEYBOARD Mod+B literally during composition never reaches the app at all, same reasoning as #1) | 미검증 | 미검증 |
| 5 | 멘션 바로 뒤에서 조합 | 자동(chromium CDP) -- 3 tests: right after / part-way inside (DOM caret) / at the very end of a mention's label | 미검증 | 미검증 |
| 6 | 블록 첫 칸(빈 블록)에서 조합 | 자동(chromium CDP) -- "composition at a block's own start" + "composition in an empty block" | 미검증 | 미검증 |
| 7 | 표 셀 안에서 조합 | 자동(chromium CDP) -- "composition inside a table cell" | 미검증 | 미검증 |
| 8 | 빠른 연속 입력 (조합-확정을 여러 번 빠르게 반복) | 자동(chromium CDP) -- "five fast consecutive composition sequences build up '안녕하세요'..." | 미검증 | 미검증 |

## Plugins

| # | Case | Result |
|---|------|--------|
| 9 | macOS 두벌식 한글, Safari | 미검증 |
| 10 | macOS 두벌식 한글, Chrome | 미검증 -- CDP's `Input.imeSetComposition` is Chromium's own internal composition-simulation hook, not a driver for the real macOS 두벌식 IME engine, so this specific case (the real engine's jamo-combining behavior) cannot be automated at all, even on Chromium |
| 11 | Windows MS IME (한글), Chrome | 미검증 -- same reasoning as #10 (real MS IME engine, not reachable via CDP) |
| 12 | Japanese IME sanity (にほんご -> 日本語 kanji conversion), any real IME | 자동(chromium CDP) -- `ime.spec.ts` "Japanese composition with a kanji replacement" exercises the hiragana-build-then-kanji-replace SHAPE via CDP `composeSteps`+`Input.insertText`, not a real Japanese IME's own candidate-conversion engine |

## How to run

1. `pnpm --filter e2e-fixtures dev`, open `http://localhost:5173/spike` (rows
   1-4) or `http://localhost:5173/editor` (rows 5-8: mention/empty
   block/table cell/list item all need the fuller `/editor` doc, `/spike`'s
   fixture doesn't have them) in the real browser being tested.
2. For each row: place the caret via a real click (not `setCaret`, which is a
   test-only helper for the automated spec), type through the actual OS IME,
   and compare `window.__julEditor.getDoc()` (open devtools console) against what
   you typed.
3. Record "통과" (pass) or "실패: <what went wrong>" -- never leave a row
   blank or guess; "미검증" is the honest default until it's actually run.

## Cross-browser gross-regression smoke (not a substitute for the above)

`pnpm e2e:smoke` runs a webkit+firefox `@smoke` test (`e2e/ime.spec.ts`,
titled "ime @smoke: ..."): plain ASCII typing plus Playwright's
`keyboard.insertText('한글')`. `insertText` fires a single synthetic `input`
event with the given text -- it does NOT drive compositionstart/update/end at
all, so it is explicitly NOT a real IME test, only a fast check that the
plain absorb path (no composition machinery involved) still works on
webkit/firefox. It catches gross breakage, nothing about composition timing;
the table above is still what actually verifies IME behavior.
