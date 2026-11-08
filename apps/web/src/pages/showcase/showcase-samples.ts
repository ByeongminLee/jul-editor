import type { Block, Doc } from "@jul-editor/core";

type Locale = "en" | "ko";
type Part = string | ["b" | "i" | "c", string] | ["a", string, string] | ["m", "user" | "tag", string, string];
type Pair<T> = { en: T; ko: T };
type Sample = {
  /** Block id prefix; the first letter keeps ids stable for tests (s, n, e, m, t, u, b, c, x). */
  p: string;
  title: Pair<string>;
  lead: Pair<Part[]>;
  bullets: Pair<string[]>;
  h2: Pair<string>;
  body: Pair<Part[]>;
  todos: Pair<string[]>;
  h3: Pair<string>;
  steps: Pair<string[]>;
  quote: Pair<string>;
  tableHeading: Pair<string>;
  table: Pair<string[][]>;
  code: { language: string; text: string };
  chartHeading: Pair<string>;
  chart: { kind: "bar" | "line" | "area"; csv: string; x: string; y: string };
  image: Pair<{ alt: string; caption: string }>;
};

const DOCS = "/docs/core/styling-i18n-performance";

const samples: Record<string, Sample> = {
  shadcn: {
    p: "s",
    title: { en: "Project brief", ko: "프로젝트 개요" },
    lead: {
      en: ["Rework the first-run experience so a new workspace reaches its first shared document in one sitting. This brief keeps the ", ["b", "goal, scope, and owners"], " in one place for the whole team."],
      ko: ["새 워크스페이스가 한 번에 첫 공유 문서까지 도달하도록 첫 실행 경험을 다시 설계합니다. 이 개요는 ", ["b", "목표, 범위, 담당자"], "를 한곳에 모아 팀 전체가 같은 기준으로 움직이게 합니다."],
    },
    bullets: {
      en: ["Cut the setup steps from seven to three.", "Keep the existing import flow unchanged.", "Ship behind a flag and measure for two weeks."],
      ko: ["설정 단계를 일곱 개에서 세 개로 줄입니다.", "기존 가져오기 흐름은 그대로 둡니다.", "플래그 뒤에서 배포하고 2주간 측정합니다."],
    },
    h2: { en: "Scope and decisions", ko: "범위와 결정 사항" },
    body: {
      en: ["Design owns the new empty states; Platform owns the ", ["c", "onboarding.step"], " events. Questions go to ", ["m", "user", "mina", "Mina"], " and the open items are tracked under ", ["m", "tag", "onboarding", "onboarding"], ". The ", ["a", "styling guide", DOCS], " explains how the editor inherits your tokens."],
      ko: ["디자인팀은 새 빈 화면을, 플랫폼팀은 ", ["c", "onboarding.step"], " 이벤트를 맡습니다. 질문은 ", ["m", "user", "mina", "Mina"], "에게 보내고, 남은 항목은 ", ["m", "tag", "onboarding", "onboarding"], " 태그로 추적합니다. 에디터가 토큰을 상속하는 방법은 ", ["a", "스타일 설정 안내", DOCS], "에서 볼 수 있습니다."],
    },
    todos: {
      en: ["Confirm the three-step flow with research", "Write the empty-state copy", "Add the step events to the analytics plan"],
      ko: ["리서치팀과 세 단계 흐름 확인", "빈 화면 문구 작성", "분석 계획에 단계 이벤트 추가"],
    },
    h3: { en: "Rollout order", ko: "배포 순서" },
    steps: {
      en: ["Internal workspaces", "Ten percent of new sign-ups", "Everyone, after the two-week review"],
      ko: ["내부 워크스페이스", "신규 가입자의 10퍼센트", "2주 검토 후 전체 사용자"],
    },
    quote: { en: "A good first run asks for the least and shows the most.", ko: "좋은 첫 실행은 가장 적게 요청하고 가장 많이 보여 줍니다." },
    tableHeading: { en: "Milestones", ko: "마일스톤" },
    table: {
      en: [["Milestone", "Owner", "Due", "Status"], ["Flow prototype", "Design", "Mar 8", "Done"], ["Event tracking", "Platform", "Mar 15", "In review"], ["Flagged rollout", "Growth", "Mar 29", "Planned"]],
      ko: [["마일스톤", "담당", "마감", "상태"], ["흐름 프로토타입", "디자인", "3월 8일", "완료"], ["이벤트 추적", "플랫폼", "3월 15일", "검토 중"], ["플래그 배포", "그로스", "3월 29일", "예정"]],
    },
    code: { language: "typescript", text: `export const onboarding = {\n  steps: ["workspace", "invite", "first-doc"],\n  flag: "onboarding-v2",\n  rollout: 0.1,\n};` },
    chartHeading: { en: "Weekly activated workspaces", ko: "주간 활성화 워크스페이스" },
    chart: { kind: "bar", csv: "week,activated\nW1,142\nW2,168\nW3,159\nW4,204\nW5,231\nW6,248\nW7,266", x: "week", y: "activated" },
    image: { en: { alt: "Wireframe of the three-step onboarding flow", caption: "Figure 1. The three-step flow, drawn at the first review." }, ko: { alt: "세 단계 시작 흐름의 와이어프레임", caption: "그림 1. 첫 검토에서 그린 세 단계 흐름" } },
  },
  notebook: {
    p: "n",
    title: { en: "Field notes", ko: "현장 노트" },
    lead: {
      en: ["Observations from the community garden, written as they happen. The ", ["i", "order can change later"], ", so write first and sort afterwards."],
      ko: ["공동 텃밭에서 관찰한 내용을 그때그때 적습니다. ", ["i", "순서는 나중에 바꿀 수 있으니"], " 먼저 쓰고 나중에 정리하세요."],
    },
    bullets: {
      en: ["Tomatoes on the east bed are ripening early.", "The compost bin needs turning every few days.", "New sparrow nest under the shed roof."],
      ko: ["동쪽 두둑의 토마토가 일찍 익고 있습니다.", "퇴비통은 며칠에 한 번 뒤집어야 합니다.", "창고 지붕 아래에 새 참새 둥지가 생겼습니다."],
    },
    h2: { en: "This week in the beds", ko: "이번 주 두둑 상황" },
    body: {
      en: ["Morning watering cut the leaf curl a lot, so the schedule below worked. See ", ["a", "how the page styles lined paper", DOCS], " if you want the same look. Ask ", ["m", "user", "jun", "Jun"], " about the seed order, and tag new finds with ", ["m", "tag", "garden", "garden"], "."],
      ko: ["아침 물주기로 잎말림이 크게 줄었으니 아래 일정이 효과가 있었습니다. 같은 줄 노트 모양이 필요하면 ", ["a", "줄 노트 스타일 설정", DOCS], "을 보세요. 씨앗 주문은 ", ["m", "user", "jun", "Jun"], "에게 묻고, 새로 발견한 것은 ", ["m", "tag", "garden", "garden"], " 태그를 붙입니다."],
    },
    todos: {
      en: ["Water the east bed before 8 am", "Label the new herb rows", "Photograph the sparrow nest"],
      ko: ["오전 8시 전에 동쪽 두둑에 물 주기", "새 허브 줄에 이름표 달기", "참새 둥지 사진 찍기"],
    },
    h3: { en: "Turning the compost", ko: "퇴비 뒤집기" },
    steps: {
      en: ["Remove the top layer into a bucket", "Mix the damp middle with dry leaves", "Return the top layer and close the lid"],
      ko: ["윗층을 양동이에 덜어 냅니다", "축축한 가운데를 마른 낙엽과 섞습니다", "윗층을 다시 덮고 뚜껑을 닫습니다"],
    },
    quote: { en: "Notice one more thing than yesterday.", ko: "어제보다 하나 더 알아차리세요." },
    tableHeading: { en: "Harvest log", ko: "수확 기록" },
    table: {
      en: [["Date", "Bed", "Crop", "Weight (kg)"], ["Jun 3", "East", "Tomato", "2.4"], ["Jun 5", "North", "Lettuce", "1.1"], ["Jun 8", "East", "Tomato", "3.2"]],
      ko: [["날짜", "두둑", "작물", "무게(kg)"], ["6월 3일", "동쪽", "토마토", "2.4"], ["6월 5일", "북쪽", "상추", "1.1"], ["6월 8일", "동쪽", "토마토", "3.2"]],
    },
    code: { language: "javascript", text: `const watering = {\n  east: "06:30",\n  north: "07:15",\n  skipWhenRaining: true,\n};` },
    chartHeading: { en: "Daily harvest", ko: "일별 수확량" },
    chart: { kind: "line", csv: "day,kg\nMon,1.2\nTue,0.8\nWed,1.9\nThu,2.4\nFri,1.7\nSat,3.2\nSun,2.6", x: "day", y: "kg" },
    image: { en: { alt: "Sketch of the garden beds from above", caption: "Beds as of June, with the compost bin at the lower right." }, ko: { alt: "위에서 본 텃밭 두둑 스케치", caption: "6월 기준 두둑 배치. 오른쪽 아래가 퇴비통입니다." } },
  },
  editorial: {
    p: "e",
    title: { en: "The weekly letter", ko: "이번 주의 편지" },
    lead: {
      en: ["Small tools last longer when they ask less of the people who use them. This week we look at three teams that shipped ", ["b", "less"], " and kept more readers."],
      ko: ["작은 도구는 쓰는 사람에게 덜 요구할수록 오래갑니다. 이번 주에는 ", ["b", "더 적게"], " 내놓고도 더 많은 독자를 지킨 세 팀을 살펴봅니다."],
    },
    bullets: {
      en: ["One idea per paragraph, one claim per section.", "Lead with the sentence a skimmer would keep.", "Cut the second example, keep the better one."],
      ko: ["문단마다 하나의 생각, 절마다 하나의 주장.", "훑어 읽는 사람이 기억할 문장을 앞에 둡니다.", "두 번째 예시는 덜어 내고 더 좋은 것만 남깁니다."],
    },
    h2: { en: "What the readers told us", ko: "독자들이 알려 준 것" },
    body: {
      en: ["Replies came in all week, and most of them asked for ", ["i", "shorter"], " letters rather than more of them. Our reader survey, summarized in the ", ["a", "styling notes", DOCS], ", agrees. Thanks to ", ["m", "user", "dana", "Dana"], " for collecting the answers under ", ["m", "tag", "survey", "survey"], "."],
      ko: ["한 주 내내 답장이 도착했고, 대부분 편지를 더 보내 달라기보다 ", ["i", "더 짧게"], " 써 달라고 했습니다. ", ["a", "스타일 노트", DOCS], "에 정리한 독자 설문도 같은 결과입니다. 답변을 ", ["m", "tag", "survey", "survey"], " 태그로 모아 준 ", ["m", "user", "dana", "Dana"], "에게 감사드립니다."],
    },
    todos: {
      en: ["Trim the lead to two sentences", "Check every link before sending", "Schedule for Thursday at 8 am"],
      ko: ["도입부를 두 문장으로 줄이기", "발송 전에 모든 링크 확인", "목요일 오전 8시로 예약"],
    },
    h3: { en: "Before you send", ko: "보내기 전에" },
    steps: {
      en: ["Read it aloud once", "Remove the first paragraph and see if it still works", "Send a test to yourself"],
      ko: ["소리 내어 한 번 읽습니다", "첫 문단을 지워도 읽히는지 봅니다", "나에게 테스트 메일을 보냅니다"],
    },
    quote: { en: "Keep the key point where readers can find it.", ko: "핵심은 독자가 찾을 수 있는 곳에 두세요." },
    tableHeading: { en: "Issue performance", ko: "호별 성과" },
    table: {
      en: [["Issue", "Opens", "Replies", "Words"], ["No. 41", "58%", "36", "820"], ["No. 42", "61%", "52", "640"], ["No. 43", "64%", "71", "510"]],
      ko: [["호", "열람률", "답장", "글자 수"], ["41호", "58%", "36", "1,480"], ["42호", "61%", "52", "1,150"], ["43호", "64%", "71", "930"]],
    },
    code: { language: "typescript", text: `type Issue = {\n  number: number;\n  words: number;\n  opens: number;\n};\n\nexport const target: Pick<Issue, "words"> = { words: 500 };` },
    chartHeading: { en: "Readers by weekday", ko: "요일별 독자 수" },
    chart: { kind: "area", csv: "weekday,readers\nMon,820\nTue,940\nWed,1010\nThu,1480\nFri,1120\nSat,610\nSun,540", x: "weekday", y: "readers" },
    image: { en: { alt: "Newsletter layout with a single wide column", caption: "A single column keeps the measure near sixty characters." }, ko: { alt: "한 단 레이아웃으로 구성한 뉴스레터", caption: "한 단 구성은 한 줄을 60자 안팎으로 유지합니다." } },
  },
  midnight: {
    p: "m",
    title: { en: "Tonight's notes", ko: "오늘 밤의 메모" },
    lead: {
      en: ["Write the first thought down before it fades. Use ", ["c", "/"], " when you need a list, a heading, or a small table to hold the day."],
      ko: ["생각이 흐려지기 전에 먼저 적어 두세요. 목록, 제목, 작은 표가 필요하면 ", ["c", "/"], "를 입력하세요."],
    },
    bullets: {
      en: ["Finished the draft of the long essay.", "Walked for forty minutes after dinner.", "Tomorrow: review the open questions."],
      ko: ["긴 글의 초안을 끝냈습니다.", "저녁 식사 후 40분 걸었습니다.", "내일: 남은 질문을 검토합니다."],
    },
    h2: { en: "What stayed with me", ko: "마음에 남은 것" },
    body: {
      en: ["The quiet hour after nine is when the work finally ", ["b", "feels like mine"], ". I want to protect it. ", ["m", "user", "sora", "Sora"], " suggested a ", ["a", "dim reading theme", DOCS], " for evenings, and I filed the idea under ", ["m", "tag", "evenings", "evenings"], "."],
      ko: ["밤 아홉 시 이후의 조용한 시간에야 비로소 일이 ", ["b", "내 것처럼 느껴집니다"], ". 이 시간을 지키고 싶습니다. ", ["m", "user", "sora", "Sora"], "가 저녁용 ", ["a", "어두운 읽기 테마", DOCS], "를 추천했고, 이 아이디어를 ", ["m", "tag", "evenings", "evenings"], " 태그에 넣어 두었습니다."],
    },
    todos: {
      en: ["Put the phone away by ten", "Water the plants", "Write three lines about today"],
      ko: ["열 시까지 휴대폰 치워 두기", "화분에 물 주기", "오늘에 대해 세 줄 쓰기"],
    },
    h3: { en: "Wind-down routine", ko: "잠들기 전 루틴" },
    steps: {
      en: ["Dim the lights", "Write tomorrow's top three", "Read for twenty minutes"],
      ko: ["조명을 낮춥니다", "내일 할 일 세 가지를 적습니다", "20분간 책을 읽습니다"],
    },
    quote: { en: "A calm evening is a decision made at noon.", ko: "차분한 저녁은 한낮에 내린 결정입니다." },
    tableHeading: { en: "This week's habits", ko: "이번 주 습관" },
    table: {
      en: [["Habit", "Nights", "Streak"], ["Evening walk", "5 of 7", "3"], ["Read before bed", "6 of 7", "4"], ["Screens off at ten", "4 of 7", "2"]],
      ko: [["습관", "실천한 밤", "연속"], ["저녁 산책", "7일 중 5일", "3"], ["자기 전 독서", "7일 중 6일", "4"], ["열 시 화면 끄기", "7일 중 4일", "2"]],
    },
    code: { language: "typescript", text: `const evening = {\n  lightsOut: "22:30",\n  reading: 20,\n  screens: false,\n} as const;` },
    chartHeading: { en: "Hours of sleep", ko: "수면 시간" },
    chart: { kind: "line", csv: "night,hours\nMon,6.5\nTue,7.0\nWed,6.0\nThu,7.5\nFri,7.2\nSat,8.1\nSun,7.8", x: "night", y: "hours" },
    image: { en: { alt: "Desk lamp glowing beside an open notebook", caption: "The evening desk: one lamp, one notebook." }, ko: { alt: "펼쳐진 노트 옆에서 빛나는 스탠드", caption: "저녁의 책상. 스탠드 하나와 노트 한 권." } },
  },
  terminal: {
    p: "t",
    title: { en: "Release checklist", ko: "배포 체크리스트" },
    lead: {
      en: ["Version ", ["c", "2.4.0"], " ships on Friday. List the changes, then drag blocks into the order the release notes should follow."],
      ko: ["버전 ", ["c", "2.4.0"], "은 금요일에 배포합니다. 변경 사항을 적고 릴리스 노트 순서대로 블록을 끌어 옮기세요."],
    },
    bullets: {
      en: ["Verify the migration before publishing.", "Pin the two patched dependencies.", "Keep the rollback script next to the notes."],
      ko: ["배포 전에 마이그레이션을 검증합니다.", "패치한 의존성 두 개를 고정합니다.", "롤백 스크립트를 노트 옆에 둡니다."],
    },
    h2: { en: "Known issues", ko: "알려진 문제" },
    body: {
      en: ["The export dialog flickers on slow disks, see ", ["c", "#412"], " and the ", ["a", "styling notes", DOCS], " for the temporary workaround. Escalate blockers to ", ["m", "user", "ravi", "Ravi"], " and label them ", ["m", "tag", "release", "release"], "."],
      ko: ["느린 디스크에서 내보내기 창이 깜빡입니다. 임시 해결책은 ", ["c", "#412"], "와 ", ["a", "스타일 노트", DOCS], "를 참고하세요. 막힌 항목은 ", ["m", "user", "ravi", "Ravi"], "에게 알리고 ", ["m", "tag", "release", "release"], " 라벨을 붙입니다."],
    },
    todos: {
      en: ["Run the full test suite on the release branch", "Tag the build and publish the notes", "Announce in the changelog channel"],
      ko: ["릴리스 브랜치에서 전체 테스트 실행", "빌드에 태그를 달고 노트 게시", "변경 기록 채널에 공지"],
    },
    h3: { en: "Cut the release", ko: "릴리스 만들기" },
    steps: {
      en: ["Merge the release branch", "Run the publish workflow", "Smoke test the published package"],
      ko: ["릴리스 브랜치를 병합합니다", "게시 워크플로를 실행합니다", "게시된 패키지로 스모크 테스트를 합니다"],
    },
    quote: { en: "If it is not in the changelog, it did not ship.", ko: "변경 기록에 없으면 배포한 것이 아닙니다." },
    tableHeading: { en: "Verification", ko: "검증 결과" },
    table: {
      en: [["Check", "Result", "Time"], ["Unit tests", "Pass", "1m 12s"], ["End-to-end", "Pass", "4m 40s"], ["Bundle size", "Warn", "+2.1 kB"]],
      ko: [["항목", "결과", "소요 시간"], ["단위 테스트", "통과", "1분 12초"], ["엔드투엔드", "통과", "4분 40초"], ["번들 크기", "경고", "+2.1 kB"]],
    },
    code: { language: "typescript", text: `import { publish } from "./release";\n\nconst version = "2.4.0";\nawait publish({ version, dryRun: false });\nconsole.log(\`published \${version}\`);` },
    chartHeading: { en: "Build time per run (seconds)", ko: "실행별 빌드 시간(초)" },
    chart: { kind: "area", csv: "run,seconds\n#1,212\n#2,198\n#3,205\n#4,176\n#5,168\n#6,171\n#7,159", x: "run", y: "seconds" },
    image: { en: { alt: "Terminal window listing the release steps", caption: "The release script prints one line per step." }, ko: { alt: "릴리스 단계를 출력한 터미널 창", caption: "릴리스 스크립트는 단계마다 한 줄씩 출력합니다." } },
  },
  studio: {
    p: "u",
    title: { en: "Campaign brief", ko: "캠페인 기획서" },
    lead: {
      en: ["The spring launch should feel ", ["b", "bright, direct, and useful"], ". Write the core message, format the key details, and move sections as the brief develops."],
      ko: ["봄 출시 캠페인은 ", ["b", "밝고 직관적이며 유용한"], " 느낌이어야 합니다. 핵심 메시지를 쓰고 중요한 내용을 강조한 뒤, 기획서가 발전하면 섹션을 옮기세요."],
    },
    bullets: {
      en: ["One headline, one proof point, one call to action.", "Use the toolbar or type / to add a block.", "Keep the palette to two colors plus neutrals."],
      ko: ["헤드라인 하나, 근거 하나, 행동 유도 하나.", "툴바를 쓰거나 /를 입력해 블록을 추가합니다.", "색상은 두 가지와 중립색으로 제한합니다."],
    },
    h2: { en: "Audience and message", ko: "대상과 메시지" },
    body: {
      en: ["We speak to small teams who write every day but rarely get tools that fit. The message: ", ["i", "your editor, shaped like your product"], ". Creative direction sits with ", ["m", "user", "hana", "Hana"], "; assets are tagged ", ["m", "tag", "spring", "spring"], ". Brand rules are in the ", ["a", "style guide", DOCS], "."],
      ko: ["매일 글을 쓰지만 맞는 도구를 만나기 어려운 소규모 팀에게 말합니다. 메시지는 ", ["i", "당신의 제품을 닮은 에디터"], "입니다. 크리에이티브 방향은 ", ["m", "user", "hana", "Hana"], "가 맡고, 에셋에는 ", ["m", "tag", "spring", "spring"], " 태그를 붙입니다. 브랜드 규칙은 ", ["a", "스타일 가이드", DOCS], "에 있습니다."],
    },
    todos: {
      en: ["Approve the headline options", "Brief the illustrator", "Book the launch week social slots"],
      ko: ["헤드라인 후보 승인", "일러스트레이터에게 브리프 전달", "출시 주간 소셜 일정 예약"],
    },
    h3: { en: "Launch timeline", ko: "출시 일정" },
    steps: {
      en: ["Teaser posts, week one", "Launch announcement, week two", "Customer stories, week three"],
      ko: ["티저 게시물, 첫째 주", "출시 발표, 둘째 주", "고객 사례, 셋째 주"],
    },
    quote: { en: "Say one thing clearly and let the design carry the rest.", ko: "한 가지를 분명히 말하고 나머지는 디자인에 맡기세요." },
    tableHeading: { en: "Channel plan", ko: "채널 계획" },
    table: {
      en: [["Channel", "Budget", "Reach", "Goal"], ["Email", "$2,000", "18,000", "Sign-ups"], ["Social", "$6,500", "92,000", "Awareness"], ["Search", "$4,200", "41,000", "Trials"]],
      ko: [["채널", "예산", "도달", "목표"], ["이메일", "250만 원", "18,000", "가입"], ["소셜", "800만 원", "92,000", "인지도"], ["검색", "520만 원", "41,000", "체험"]],
    },
    code: { language: "typescript", text: `export const campaign = {\n  name: "spring-launch",\n  channels: ["email", "social", "search"],\n  start: "2026-04-06",\n};` },
    chartHeading: { en: "Reach by channel", ko: "채널별 도달" },
    chart: { kind: "bar", csv: "channel,reach\nEmail,18000\nSocial,92000\nSearch,41000\nPartners,27000\nEvents,9000\nPress,15000", x: "channel", y: "reach" },
    image: { en: { alt: "Moodboard with bright colors and a bold headline", caption: "Moodboard v2: bright, direct, and useful." }, ko: { alt: "밝은 색상과 굵은 헤드라인의 무드보드", caption: "무드보드 v2. 밝고 직관적이며 유용하게." } },
  },
  blueprint: {
    p: "b",
    title: { en: "Build specification", ko: "구현 설계" },
    lead: {
      en: ["Define the goal, record the constraints, and arrange the work in a clear order. Every requirement below has an ", ["b", "owner and an acceptance test"], "."],
      ko: ["목표를 정하고 제약을 기록한 뒤 작업을 분명한 순서로 배치합니다. 아래 모든 요구사항에는 ", ["b", "담당자와 인수 테스트"], "가 있습니다."],
    },
    bullets: {
      en: ["Confirm the acceptance criteria before implementation.", "Latency budget: 200 ms at the 95th percentile.", "No new runtime dependencies."],
      ko: ["구현 전에 인수 기준을 확정합니다.", "지연 시간 예산: 95번째 백분위수에서 200ms.", "새로운 런타임 의존성은 추가하지 않습니다."],
    },
    h2: { en: "Design decisions", ko: "설계 결정" },
    body: {
      en: ["Documents are stored as JSON blocks and rendered through the ", ["c", "Editor"], " component. ", ["m", "user", "leo", "Leo"], " reviews the schema; open questions carry the ", ["m", "tag", "spec", "spec"], " tag. Background reading lives in the ", ["a", "styling guide", DOCS], "."],
      ko: ["문서는 JSON 블록으로 저장하고 ", ["c", "Editor"], " 컴포넌트로 렌더링합니다. 스키마는 ", ["m", "user", "leo", "Leo"], "가 검토하며, 남은 질문에는 ", ["m", "tag", "spec", "spec"], " 태그를 붙입니다. 배경 자료는 ", ["a", "스타일 설정 안내", DOCS], "에 있습니다."],
    },
    todos: {
      en: ["Review the block schema", "Write the acceptance tests", "Record the latency baseline"],
      ko: ["블록 스키마 검토", "인수 테스트 작성", "지연 시간 기준선 기록"],
    },
    h3: { en: "Implementation order", ko: "구현 순서" },
    steps: {
      en: ["Schema and migrations", "Read path and caching", "Write path and validation"],
      ko: ["스키마와 마이그레이션", "읽기 경로와 캐싱", "쓰기 경로와 검증"],
    },
    quote: { en: "A specification is finished when a stranger can build from it.", ko: "낯선 사람이 보고 만들 수 있을 때 명세가 완성된 것입니다." },
    tableHeading: { en: "Requirements", ko: "요구사항" },
    table: {
      en: [["Requirement", "Priority", "Estimate", "Owner"], ["Block schema v2", "High", "5 days", "Core"], ["Read-only renderer", "High", "3 days", "Web"], ["Import tool", "Medium", "4 days", "Tools"]],
      ko: [["요구사항", "우선순위", "예상 기간", "담당"], ["블록 스키마 v2", "높음", "5일", "코어"], ["읽기 전용 렌더러", "높음", "3일", "웹"], ["가져오기 도구", "보통", "4일", "도구"]],
    },
    code: { language: "typescript", text: `export type Requirement = {\n  id: string;\n  priority: "high" | "medium" | "low";\n  estimateDays: number;\n};` },
    chartHeading: { en: "Story points per sprint", ko: "스프린트별 스토리 포인트" },
    chart: { kind: "line", csv: "sprint,points\nS1,21\nS2,26\nS3,24\nS4,30\nS5,33\nS6,31", x: "sprint", y: "points" },
    image: { en: { alt: "Architecture diagram showing reader, store, and editor", caption: "System overview: reader, store, and editor share one schema." }, ko: { alt: "리더, 저장소, 에디터를 보여 주는 구조도", caption: "시스템 개요. 리더, 저장소, 에디터가 하나의 스키마를 공유합니다." } },
  },
  canvas: {
    p: "c",
    title: { en: "Make room for ideas", ko: "아이디어를 펼쳐 보세요" },
    lead: {
      en: ["Start with a rough thought. Give the ", ["b", "important words"], " room to stand out, and let the page be loud when the idea is."],
      ko: ["거친 생각부터 시작하세요. ", ["b", "중요한 단어"], "가 돋보이도록 여백을 주고, 아이디어가 클 때는 페이지도 크게 말하게 하세요."],
    },
    bullets: {
      en: ["Write the wild version first.", "Circle what makes people lean in.", "Cut anything that needs a footnote."],
      ko: ["가장 엉뚱한 버전을 먼저 씁니다.", "사람들이 귀를 기울이는 부분에 표시합니다.", "각주가 필요한 부분은 덜어 냅니다."],
    },
    h2: { en: "Workshop results", ko: "워크숍 결과" },
    body: {
      en: ["Twenty-two ideas, five clusters, one clear winner: ", ["i", "the shared whiteboard"], ". ", ["m", "user", "yuna", "Yuna"], " will sketch the first screens and tag progress with ", ["m", "tag", "ideas", "ideas"], ". The bold look follows our ", ["a", "styling guide", DOCS], "."],
      ko: ["아이디어 22개, 묶음 5개, 분명한 1위는 ", ["i", "공유 화이트보드"], "였습니다. ", ["m", "user", "yuna", "Yuna"], "가 첫 화면을 스케치하고, 진행 상황은 ", ["m", "tag", "ideas", "ideas"], " 태그로 남깁니다. 굵은 스타일은 ", ["a", "스타일 설정 안내", DOCS], "를 따릅니다."],
    },
    todos: {
      en: ["Vote on the top three ideas", "Sketch the winning idea", "Share the board with the whole team"],
      ko: ["상위 아이디어 세 개 투표", "1위 아이디어 스케치", "전체 팀과 보드 공유"],
    },
    h3: { en: "From idea to prototype", ko: "아이디어에서 프로토타입까지" },
    steps: {
      en: ["Pick one idea", "Sketch it in ten minutes", "Show it to someone outside the team"],
      ko: ["아이디어 하나를 고릅니다", "10분 안에 스케치합니다", "팀 밖의 누군가에게 보여 줍니다"],
    },
    quote: { en: "A small idea can become the next big thing.", ko: "작은 아이디어가 다음 큰 일이 될 수 있습니다." },
    tableHeading: { en: "Idea ranking", ko: "아이디어 순위" },
    table: {
      en: [["Idea", "Votes", "Effort"], ["Shared whiteboard", "14", "Medium"], ["Voice notes", "9", "Low"], ["Template gallery", "7", "High"]],
      ko: [["아이디어", "득표", "난이도"], ["공유 화이트보드", "14", "보통"], ["음성 메모", "9", "낮음"], ["템플릿 갤러리", "7", "높음"]],
    },
    code: { language: "javascript", text: `const ideas = [\n  { name: "whiteboard", votes: 14 },\n  { name: "voice notes", votes: 9 },\n];\nconsole.log(ideas[0].name);` },
    chartHeading: { en: "Votes by cluster", ko: "묶음별 득표" },
    chart: { kind: "bar", csv: "cluster,votes\nCollaboration,21\nCapture,14\nTemplates,11\nSharing,9\nAutomation,6", x: "cluster", y: "votes" },
    image: { en: { alt: "Sticky notes grouped into clusters on a wall", caption: "Sticky notes from the workshop, grouped by theme." }, ko: { alt: "벽에 주제별로 묶어 붙인 포스트잇", caption: "워크숍의 포스트잇을 주제별로 묶었습니다." } },
  },
  custom: {
    p: "x",
    title: { en: "Make this editor yours", ko: "내 에디터 만들기" },
    lead: {
      en: ["Pick a style, then adjust the ", ["b", "type, color, and spacing"], " around your work. Every change appears here and in the CSS you copy."],
      ko: ["스타일을 고른 뒤 작업에 맞게 ", ["b", "글꼴, 색상, 간격"], "을 조정하세요. 모든 변경은 이 화면과 복사하는 CSS에 반영됩니다."],
    },
    bullets: {
      en: ["Your changes appear in the editor and the CSS you copy.", "Switch the accent to recolor links, buttons, and marks.", "Try Brutal or Mono for the most dramatic change."],
      ko: ["변경 내용은 에디터와 복사하는 CSS에 반영됩니다.", "강조색을 바꾸면 링크, 버튼, 표시가 함께 바뀝니다.", "가장 큰 변화를 보려면 브루탈이나 모노를 써 보세요."],
    },
    h2: { en: "What the accent controls", ko: "강조색이 바꾸는 것" },
    body: {
      en: ["The accent colors ", ["a", "links", DOCS], ", selections, focus rings, active toolbar buttons, list markers, checkboxes, quote borders, table headers, and ", ["c", "inline code"], ". Mentions such as ", ["m", "user", "mina", "Mina"], " and ", ["m", "tag", "design", "design"], " pick it up too."],
      ko: ["강조색은 ", ["a", "링크", DOCS], ", 선택 영역, 포커스 링, 활성 툴바 버튼, 목록 기호, 체크박스, 인용 테두리, 표 머리글, ", ["c", "인라인 코드"], "에 적용됩니다. ", ["m", "user", "mina", "Mina"], "나 ", ["m", "tag", "design", "design"], " 같은 멘션도 같은 색을 씁니다."],
    },
    todos: {
      en: ["Choose a surface theme", "Try two font pairings", "Copy the CSS into your app"],
      ko: ["배경 테마 고르기", "글꼴 조합 두 가지 써 보기", "CSS를 앱에 복사하기"],
    },
    h3: { en: "A good order to try", ko: "써 보기 좋은 순서" },
    steps: {
      en: ["Pick a style", "Pick an accent", "Fine-tune fonts and corners"],
      ko: ["스타일 고르기", "강조색 고르기", "글꼴과 모서리 다듬기"],
    },
    quote: { en: "Design the surface once, and every document inherits it.", ko: "표면을 한 번 정하면 모든 문서가 그대로 이어받습니다." },
    tableHeading: { en: "Design tokens", ko: "디자인 토큰" },
    table: {
      en: [["Token", "Controls", "Value"], ["--jul-editor-accent", "Links, active states", "Any CSS color"], ["--jul-editor-radius", "Corner shape", "Any CSS length"], ["--jul-editor-heading", "Heading font", "Any font stack"]],
      ko: [["토큰", "적용 대상", "값"], ["--jul-editor-accent", "링크, 활성 상태", "CSS 색상 값"], ["--jul-editor-radius", "모서리 모양", "CSS 길이 값"], ["--jul-editor-heading", "제목 글꼴", "글꼴 스택"]],
    },
    code: { language: "typescript", text: `const theme = {\n  accent: "<css color>",\n  radius: "<css length>",\n  heading: "<font stack>",\n};\n\nexport default theme;` },
    chartHeading: { en: "Accent choices this week", ko: "이번 주 강조색 선택" },
    chart: { kind: "bar", csv: "accent,picks\nSlate,34\nRose,52\nAmber,28\nCobalt,61\nMint,45\nViolet,39", x: "accent", y: "picks" },
    image: { en: { alt: "Preview of the same document in three styles", caption: "The same document in three styles." }, ko: { alt: "같은 문서를 세 가지 스타일로 보여 주는 미리보기", caption: "같은 문서를 세 가지 스타일로 본 모습." } },
  },
};

function inline(parts: Part[]): NonNullable<Block["content"]> {
  return parts.map((part) => {
    if (typeof part === "string") return { type: "text" as const, text: part };
    if (part[0] === "m") return { type: "mention" as const, attrs: { kind: part[1], id: part[2], label: part[3] } };
    if (part[0] === "a") return { type: "text" as const, text: part[1], marks: [{ type: "link", attrs: { href: part[2] } }] };
    return { type: "text" as const, text: part[1], marks: [{ type: part[0] === "b" ? "bold" : part[0] === "i" ? "italic" : "code" }] };
  }) as NonNullable<Block["content"]>;
}

/** A coherent mini document per theme: headings, marks, links, lists, quote, table, code, chart, and image. */
export function showcaseBlocks(themeId: string, locale: Locale, themeKey = themeId): Block[] {
  const s = samples[themeId]!;
  const id = (suffix: string) => `${s.p}-${suffix}`;
  const text = (value: string): NonNullable<Block["content"]> => [{ type: "text", text: value }];
  const cell = (row: number, col: number, value: string): Block => ({ id: `${themeKey}-cell-${row}-${col}`, type: "tableCell", props: {}, content: text(value) });
  const rows = s.table[locale];
  const bullets = s.bullets[locale].map((item, index): Block => ({ id: index === 0 ? id("list") : id(`list-${index + 1}`), type: "bulletListItem", props: {}, content: text(item) }));
  return [
    { id: id("title"), type: "heading", props: { level: 1 }, content: text(s.title[locale]) },
    { id: id("p"), type: "paragraph", props: {}, content: inline(s.lead[locale]) },
    ...bullets,
    { id: id("h2"), type: "heading", props: { level: 2 }, content: text(s.h2[locale]) },
    { id: id("body"), type: "paragraph", props: {}, content: inline(s.body[locale]) },
    ...s.todos[locale].map((item, index): Block => ({ id: id(`todo-${index + 1}`), type: "todoListItem", props: { checked: index === 0 }, content: text(item) })),
    { id: id("h3"), type: "heading", props: { level: 3 }, content: text(s.h3[locale]) },
    ...s.steps[locale].map((item, index): Block => ({ id: id(`step-${index + 1}`), type: "orderedListItem", props: {}, content: text(item) })),
    { id: id("quote"), type: "quote", props: {}, content: text(s.quote[locale]) },
    { id: id("table-heading"), type: "heading", props: { level: 2 }, content: text(s.tableHeading[locale]) },
    { id: `${themeKey}-table`, type: "table", props: { headerRow: true }, children: rows.map((row, r): Block => ({ id: `${themeKey}-row-${r}`, type: "tableRow", props: {}, children: row.map((value, c) => cell(r, c, value)) })) },
    { id: `${themeKey}-code`, type: "codeBlock", props: { language: s.code.language }, content: text(s.code.text) },
    { id: id("chart-heading"), type: "heading", props: { level: 2 }, content: text(s.chartHeading[locale]) },
    { id: `${themeKey}-chart`, type: "chart", props: { kind: s.chart.kind, source: { type: "inline", csv: s.chart.csv }, x: s.chart.x, y: s.chart.y } },
    { id: `${themeKey}-image`, type: "image", props: { src: "/editor-canvas.svg", alt: s.image[locale].alt, caption: s.image[locale].caption, width: 420 } },
  ];
}

export function showcaseDoc(themeId: string, locale: Locale): Doc {
  return { version: 1, blocks: showcaseBlocks(themeId, locale) };
}
