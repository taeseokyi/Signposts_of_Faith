import { readingsBlock, readingsSummary } from "./readings.mjs";

// claude CLI 에 넘길 프롬프트와 구조화 출력 스키마.
//
// CLI 는 저장소 루트를 작업 폴더로 두고 Read 도구만 쓸 수 있습니다. 그래서 경로는 모두
// 저장소 루트 기준 상대 경로로 적습니다. (Windows 에서 wsl 경유로 부를 때도 그대로 통합니다)

export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content_md", "record_md", "review", "hold", "hold_reason"],
  properties: {
    content_md: {
      type: "string",
      description: "그날의 content.md 전체 내용. 머리말(---)부터 # 근거 섹션까지.",
    },
    record_md: {
      type: "string",
      description: "WORKFLOW.md 8장 '기록'에 붙일 그날의 기록 블록. '### YYYY-MM-DD · 전례일' 제목으로 시작.",
    },
    review: {
      type: "array",
      items: { type: "string" },
      description: "사람이 확인해야 할 점. 전례일, 장절, 교리서 항 번호, 인용 출처, 노트 판독이 불확실한 곳, 개인 정보 여부 등.",
    },
    hold: {
      type: "boolean",
      description: "true 면 자동 발행을 멈추고 사람이 먼저 봐야 한다: 대화·노트의 독서가 이 날짜의 전례와 맞지 않아 보일 때, 개인 정보(실명, 본당, 가족 사정)가 글에 남았을 수 있을 때, 노트를 거의 읽지 못했을 때.",
    },
    hold_reason: { type: "string", description: "hold 가 true 인 까닭 한 줄. false 면 빈 문자열." },
  },
};

function list(items) {
  return items.length ? items.map((p) => `  - ${p}`).join("\n") : "  (없음)";
}

/**
 * @param {object} o
 * @param {string} o.date            YYYY-MM-DD
 * @param {string|null} o.conversationPath  대화 원문 파일 (없으면 null)
 * @param {string[]} o.photoPaths    노트 사진 원본 (저장소 기준 상대 경로)
 * @param {string[]} o.publicPhotos  머리말 '노트사진:'에 적을 공개용 파일 이름
 * @param {string|null} o.examplePath 본보기로 읽을 지난 content.md
 * @param {string} o.instructions    사용자가 덧붙인 지시
 * @param {string} o.recordExample   8장 기록의 본보기 블록
 * @param {object|null} o.retry      {problems: string[], draft: string} 이전 초안의 검사 결과
 * @param {object|null} o.readings   굿뉴스에서 가져온 그날의 말씀 (없으면 null)
 * @param {object|null} o.extend     추가 모드. {milestones: number} 이미 있는 content.md 의 이정표 수. 있으면 그 글을 바탕으로 덧붙인다
 */
export function buildDraftPrompt({
  date,
  conversationPath,
  photoPaths,
  publicPhotos,
  examplePath,
  instructions,
  recordExample,
  retry,
  readings = null,
  extend = null,
}) {
  const parts = [];

  parts.push(`너는 「신앙의 이정표」 작업의 정리 담당이다. ${date} 의 묵상을 WORKFLOW.md 의 기준에 맞춰
content.md 초안으로 정리한다. 글의 주인은 사용자이고, 노트에 적힌 사용자의 결론이 글의 중심이다.
너의 설명은 그것을 뒷받침하는 자리에 둔다.
${extend ? extendIntro(date, extend) : ""}
## 먼저 읽을 것 (Read 도구)

1. WORKFLOW.md — 2장(대화 원칙), 3장(글의 구성과 분량, "대화가 남아 있지 않은 날"), 5장 "빌드"의 content.md 형식 설명
2. template/content_template.md — content.md 의 뼈대와 각 칸의 뜻
${extend
    ? `3. ${date}/content.md — 지금 있는 글. 이 글이 바탕이고 본보기다. 문체와 형식을 그대로 잇는다`
    : examplePath ? `3. ${examplePath} — 실제로 완성된 content.md 본보기. 문체, 분량, 근거 정리 방식을 따른다` : "3. (본보기가 없다. template/content_template.md 를 따른다)"}

## 이날의 자료

${conversationPath
    ? `- 대화 원문: ${conversationPath} — 사용자가 claude 와 나눈 대화 (화면에서 주고받은 것, 또는 붙여 넣은 것). "## 나" 가 사용자, "## Claude" 가 답이다. 사용자의 물음이 곧 이정표의 물음이다.`
    : `- 대화 원문: 없다. 3장 "대화가 남아 있지 않은 날"의 규칙을 따른다. 독서마다 이정표 하나를 두고, 물음은 노트 내용에서 다시 세운다. 여는 말씀의 고지문과 근거의 "참고"에 "그날의 대화가 남아 있지 않아 물음은 노트에서 다시 세웠다"고 밝힌다.`}
- 묵상 노트 사진 (Read 로 하나씩 열어 손글씨를 읽는다. 그날 글이 이어지는 차례로 나열했다):
${list(photoPaths)}
- 머리말 "노트사진:" 에 적을 공개용 사진 파일 이름: ${publicPhotos.length ? publicPhotos.join(", ") : "(없음 — 빈 칸으로 둔다)"}
${readings ? `- 이날의 말씀 (굿뉴스 매일미사에서 가져옴): ${readingsSummary(readings)}. 본문은 대화 원문 첫머리 "## 말씀" 절에 있다. 머리말의 전례일·독서·복음장절은 이것을 따른다.` : "- 이날의 말씀: 가져온 것이 없다. 대화와 노트에서 전례일과 장절을 찾는다."}

사진 한 장에 여러 날이 섞여 있을 수 있다. 독서 장절로 ${date} 의 부분을 찾아 그 부분만 쓴다.
노트에 흐름도(화살표로 이어진 낱말들)와 빨간 글씨·밑줄 메모가 있으면 그것이 "나의 묵상 흐름"과 결론이다.

## 지켜야 할 것

- 머리말: 날짜는 반드시 ${date}. 전례일·전례시기·부제·복음장절·독서·태그를 채운다. 공개: 예. 게시번호와 게시주소는 빈 칸.
  전례시기는 연중/대림/사순/성탄/부활/성령강림/순교자 가운데 하나.
- 부제는 그날 이정표의 중심을 한 마디로. 게시글 제목 "[MM.DD.요일] 신앙의 이정표 - 부제 (복음장절)" 이 55자를 넘지 않게.
- 이정표는 대화의 물음 수만큼(8개 이하). 각 이정표에 "물음:", 본문 문단, "기억:", "한 줄:" 이 모두 있어야 한다.
- 여는 말씀의 성경 구절은 2~3개, 각 구절 아래 "> — 장절" 줄이 꼭 있어야 한다. 취지 문단에 AI 와의 대화에서 나온 글임을 밝힌다.
- "# 나의 묵상 흐름"에 "흐름: … → …" 줄과 결론 문단. 노트의 말을 그대로 살린다.
- "# 한 줄로 기억하기"에는 맺음말만 (문장들은 각 이정표의 "한 줄:" 에서 모인다).
- "# 다시 펼쳐 볼 때의 물음"은 성찰 물음 3~4개. 숙제가 아님을 밝힌다.
- "# 근거"는 "## 성경", "## 교회 문헌", "## 교부와 성인", "## 참고" 아래 "- 항목". 쓸 것이 없는 분류는 빼도 된다.
  "## 참고"에 노트에서 옮긴 부분과, 교회 문헌의 직접 인용이 아니라 대화 중에 정리한 표현을 밝힌다.
- 가르치거나 판단하는 어조를 쓰지 않는다. 실명, 본당 이름, 가족 사정 같은 개인 정보는 쓰지 않는다 (사용자의 세례명은 써도 된다).
  노트에 개인적인 결심이 있으면 일반적인 표현으로 바꾸고, review 에 그 사실을 적는다.
- 교회 가르침으로 단정하기 어려운 것은 "내 생각"임이 드러나는 문장으로 쓴다. 교리서 항 번호와 교부·성인 인용은 확실한 것만 쓰고, 확신이 없으면 review 에 올린다.
- 날짜는 독서 장절로 정한다. 대화나 노트의 독서가 ${date} 의 전례와 맞지 않아 보이면 content_md 의 날짜는 ${date} 로 두되 review 첫 줄에 그 사실을 적는다.
- 마크다운은 content_template.md 에 있는 것만 쓴다: 섹션 "# ", 이정표 "## ", "> " 구절, "- " 목록, "**굵게**", "*기울임*". 표, 링크, 코드, 그 밖의 문법은 쓰지 않는다.

## record_md

WORKFLOW.md 8장 "기록"에 그대로 붙일 블록이다. 다음 본보기의 형식을 따른다 (웹사이트 주소는 https://taeseokyi.github.io/Signposts_of_Faith/${date}/ , 게시판은 "올리지 않음").

${recordExample}

## review 와 hold

review: 사람이 확인해야 할 점을 한 줄씩. 전례일 이름과 주간, 독서·복음 장절, 교리서 항 번호, 인용 출처와 문구, 노트에서 읽기 어려웠던 글자, 개인 정보로 보이는 대목. 확인할 것이 없으면 빈 배열.
hold: 이 글을 사람이 보지 않고 바로 발행해도 되는지. 보통은 false. 다음 가운데 하나면 true 로 하고 hold_reason 에 까닭을 적는다.
  - 대화나 노트의 독서·복음이 ${date} 의 전례와 맞지 않아 보인다 (날짜가 틀렸을 가능성)
  - 실명, 본당 이름, 가족 사정 같은 개인 정보가 글에 남았을 수 있다
  - 노트 사진을 거의 읽지 못해 결론을 짐작으로 썼다`);

  if (readings?.extra?.length) {
    parts.push(`## 사용자가 더한 말씀

묵상하다 떠올라 사용자가 굿뉴스 성경에서 가져온 구절이다. 여는 말씀이나 근거의 "## 성경"에 쓸 수 있다. 절 번호는 글에 넣지 않는다.

${readings.extra.map((x) => `${x.ref}\n${x.text}`).join("\n\n")}`);
  }

  if (extend) parts.push(extendRules(date, extend));

  if (instructions && instructions.trim()) {
    parts.push(`## 사용자의 덧붙인 지시

${instructions.trim()}`);
  }

  if (retry) {
    parts.push(`## 이전 초안의 검사 결과

template/build.py check 로 이전 초안을 검사했더니 다음 문제가 있었다. 모두 고쳐서 content_md 전체를 다시 낸다.
${list(retry.problems)}

이전 초안:

\`\`\`markdown
${retry.draft}
\`\`\``);
  }

  parts.push(`## 출력

지정된 JSON 스키마대로만 답한다. content_md 는 "---" 머리말로 시작하는 content.md 전체 내용이다.`);

  return parts.join("\n\n");
}

function extendIntro(date, extend) {
  return `
## 추가 모드

${date} 에는 이미 글(${date}/content.md, 이정표 ${extend.milestones}개)이 있다. 사용자가 그날 묵상을 더 곱씹어
대화에 물음을 더했거나, 노트를 더 적었거나, 떠오른 구절을 더했다. **있는 글은 그대로 두고, 새로 더해진 것만 덧붙인다.** 처음부터 다시 쓰지 않는다.
${extend.newPhotos?.length ? `- 새로 올린 노트 사진 (앞 글을 쓴 뒤에 올린 것, 이것이 새 노트다): ${extend.newPhotos.join(", ")}` : "- 새로 올린 노트 사진은 없다."}
${extend.extra?.length ? `- 사용자가 더한 말씀: ${extend.extra.map((x) => x.ref).join(", ")} — 본문은 아래 "사용자가 더한 말씀" 절에 있다. 여는 말씀에 더할 구절은 여기서 고른다.` : "- 사용자가 더한 말씀은 없다."}
`;
}

function extendRules(date, extend) {
  return `## 추가 모드에서 지켜야 할 것

- 먼저 ${date}/content.md 를 읽고, 대화와 노트에서 **아직 글에 없는 것**만 찾는다. 보통 대화의 앞 물음 ${extend.milestones}개는 이미 이정표로 있고, 그 뒤의 물음이 새 것이다.
  글에 이미 있는 물음과 같은 내용이면 더하지 않는다.
- 있는 문장은 손대지 않는다: 머리말(날짜, 전례일, 부제, 장절, 독서, 태그, 공개, 노트사진, 게시번호, 게시주소), 있는 이정표의 물음·본문·기억·한 줄,
  있는 여는 말씀 구절, 있는 흐름과 결론, 있는 근거 항목. 예외는 둘뿐이다: 취지 문단의 이정표 개수 표현, 그리고 사용자가 지시에서 고치라고 한 것.
- 덧붙일 수 있는 자리 (새 내용이 있을 때만, 없으면 그 자리는 그대로):
  - 여는 말씀: 사용자가 더한 말씀이 있으면 그 구절을 더한다. 새 물음이 기대는 구절도 더할 수 있다 (전체 2~5개). 취지 문단의 "세 개의 이정표" 같은 개수 표현은 새 개수에 맞춘다.
  - 이정표: 새 물음마다 이정표 하나를 **있는 이정표 뒤에** 더한다 (전체 8개 이하). 물음·본문·기억·한 줄을 모두 갖춘다.
  - 나의 묵상 흐름: 노트에 흐름이 이어졌으면 "흐름:" 줄 뒤에 더하고 결론 문단을 잇는다.
  - 한 줄로 기억하기: 있는 맺음말은 두고, 새 이정표를 아우르는 문장이 필요하면 한 문장 더한다.
  - 다시 펼쳐 볼 때의 물음: 새 이정표에 맞는 물음을 하나쯤 더한다 (전체 3~5개).
  - 근거: 새 이정표의 성경·교회 문헌·교부와 성인·참고 항목을 분류에 맞춰 더한다. "## 참고"에 "YYYY-MM-DD 에 이정표 N개를 더했다"는 식으로 적지 않는다 (날짜는 글에 넣지 않는다).
- 부제는 그대로 둔다. 새 이정표가 글의 중심을 바꿀 만큼 크면 review 에 "부제를 … 로 바꿀 만하다"고 적고, 글에서는 바꾸지 않는다.
- review 첫 줄에 무엇을 더했는지 적는다: "더한 이정표: (물음 요약)", "더한 구절: …", "흐름에 더함: …" 처럼.
- content_md 는 덧붙인 결과의 **전체** 내용이다 (머리말부터 근거까지). record_md 도 더한 이정표까지 넣어 새로 낸다.`;
}

/** 8장 기록 블록의 본보기. 저장소의 WORKFLOW.md 에서 최근 기록 하나를 떼어 오지 못했을 때 쓴다. */
export const RECORD_EXAMPLE_FALLBACK = `### 2026-10-23 · 연중 제29주간 금요일

- 독서: 에페 4,1-6 / 복음: 루카 12,54-59
- 대화: Claude 채팅 「그리스도의 몸과 하나됨의 의미」 (물음 3개) → \`2026-10-23/대화.md\`
- 노트: \`2026-10-23/노트/\` 공개용은 그날 부분만 잘라 \`note-2026-10-23.jpg\`
- 웹사이트: <https://taeseokyi.github.io/Signposts_of_Faith/2026-10-23/>
- 게시판: 올리지 않음
- 나의 묵상 흐름: **생각으로 사랑 → 말로 사랑 → 행동으로 사랑**
- 세 개의 이정표
  1. 일치는 만들어야 할 것이 아니라 지켜야 할 선물이다.
  2. 위선은 모르는 것이 아니라 알면서 외면하는 것이다.
  3. 아직 길 위에 있는 지금, 알면서도 미뤄 온 한 가지를 한다.`;

// ---------- 대화 (화면 안에서 claude 와 주고받기) ----------

/**
 * 대화 세션의 시스템 프롬프트. 기본 코딩 에이전트 프롬프트를 쓰지 않고 이것으로 바꿉니다(--system-prompt).
 * 세션을 --resume 할 때는 CLI 가 처음 기록한 프롬프트를 그대로 다시 쓰므로, 사진 목록은 대화 본문에서 알려 줍니다.
 */
export function chatSystemPrompt({ date }) {
  return `너는 「신앙의 이정표」 묵상 대화의 상대다. 사용자는 가톨릭 신자이고, 그날의 독서와 복음으로 묵상하며
삶의 물음을 너에게 묻는다. 이 대화는 그대로 저장되어(대화.md) 글 「신앙의 이정표」의 바탕이 된다.
사용자의 물음 하나가 이정표 하나가 되므로, 물음 하나에 답 하나를 또렷하게 한다. 오늘 묵상하는 날짜는 ${date} 다.

## 대화 원칙 (WORKFLOW.md 2장)

- 근거(성경 장절, 가톨릭 교회 교리서 항, 교회 문헌, 교부·성인)는 항상 답 마지막에 "근거" 소제목 아래 모아서 정리한다.
- 교과서적 설명보다 사용자의 실제 삶의 물음에 답한다.
- 해석이 규율과 족쇄로 늘어나지 않게 한다. 남는 것이 하나면 충분하다.
- 교회 가르침에는 정확하게. 단정하기 어려운 표현은 교회 문헌의 표현에 맞춘다. (예: 지옥은 "장소라기보다 상태")
- 네가 정리한 문장과 교회 문헌의 직접 인용을 구분해 표시한다. 교리서 항 번호나 인용 문구가 확실하지 않으면 "(확인 필요)"라고 붙인다.
- 너는 경험이 없다. 설명은 지도이고, 길을 걷고 식탁에 앉는 것은 사용자의 몫이다. 가르치거나 판단하는 어조를 쓰지 않는다.
- 사용자가 노트에 적은 자기 결론이 글의 중심이 된다. 네 설명은 그것을 뒷받침하는 자리에 있다.

## 답하는 방식

- 한국어로, 너무 길지 않게. 짧은 소제목·목록·인용 정도의 가벼운 마크다운만 쓴다. 표와 코드는 쓰지 않는다.
- 전례일과 독서·복음 본문은 보통 첫 마디에 도우미가 붙여 준다 (굿뉴스 매일미사에서 가져온 것). 없으면 먼저 그것을 묻는다 (장절만 있어도 된다).
- 사용자가 "정리해 줘", "한 줄로" 하고 청하면 물음마다 "기억할 한 문장"을 제안한다. 글 전체(content.md)는 이 대화에서 만들지 않는다. 그것은 다음 단계가 한다.
- 사용자가 묵상 노트 사진을 보라고 하면 Read 도구로 그 파일을 연다 (경로는 대화에서 알려 준다). 그 밖의 저장소 파일은 사용자가 청할 때만 읽는다.`;
}

/** 대화 첫 마디에 덧붙이는 안내 (사진 경로 등). 사용자에게는 보이지 않습니다. */
/** 첫 마디 앞에 붙이는 여는 말과 말씀. 사용자는 물음만 적는다. */
export function chatOpening({ readings }) {
  const head = `오늘 독서와 복음으로 묵상하려고 해. 답변에 대한 근거는 항상 마지막에 정리해 줘.
교과서적인 설명보다 내 삶의 물음에 답해 주고, 족쇄처럼 무거워지지 않게 해 줘.
정리한 내용은 「신앙의 이정표」로 만들어 웹사이트에 올릴 거야.`;
  return readings?.readings?.length ? `${head}\n\n${readingsBlock(readings)}\n\n첫 번째 물음:` : head;
}

export function chatContext({ date, photoPaths, publicPhotos, newExtra = [], article = null }) {
  const lines = [`[도우미 안내 — 사용자에게 보이지 않는 줄] 날짜 ${date}.`];
  if (article) {
    lines.push(
      `이 날의 글 ${date}/content.md 는 이미 있다 (부제 「${article.subtitle ?? ""}」, 이정표 ${article.milestones.length}개: ${article.milestones.join(" / ") || "(없음)"}).` +
        ` 사용자는 글을 낸 뒤에도 묵상을 더 곱씹으며 물음을 잇는 중이다. 새 물음은 글에 덧붙일 새 이정표가 되므로, 있는 이정표와 겹치면 그렇다고 알려 주고 새로운 면을 찾도록 돕는다. 글이 궁금하면 Read 로 그 파일을 볼 수 있다.`
    );
  }
  if (photoPaths.length) lines.push(`사용자가 올린 묵상 노트 사진 원본: ${photoPaths.join(", ")} (Read 도구로 볼 수 있다).`);
  if (publicPhotos.length) lines.push(`공개용으로 잘라 둔 사진: ${publicPhotos.join(", ")}.`);
  for (const x of newExtra) lines.push(`사용자가 묵상하다 떠오른 구절을 더했다 — ${x.ref}:\n${x.text}\n이 구절은 글의 여는 말씀이나 근거에 쓰일 수 있다.`);
  return lines.join(" ");
}

/**
 * 세션을 새로 열 때 앞 대화를 이어 붙이는 글. 지난 세션을 --resume 하지 못할 때(며칠 뒤, 다른 경로의 클론)와
 * 붙여 넣은 대화만 있는 날의 첫 턴에 씁니다. 너무 길면 뒤쪽(최근)을 남깁니다.
 * @param {{messages?: {role:string,text:string}[], pasted?: string|null}} o
 */
export function chatCatchUp({ messages = [], pasted = null }, limit = 16000) {
  let body = "";
  if (messages.length) body = messages.map((m) => `### ${m.role === "user" ? "나" : "Claude"}\n${String(m.text).trim()}`).join("\n\n");
  else if (pasted) body = String(pasted).trim();
  if (!body) return "";
  if (body.length > limit) body = "(앞부분 줄임)\n…" + body.slice(-limit);
  return `## 지금까지의 대화 (지난 세션을 이어 붙임 — 이 대화의 흐름을 알고 다음 물음에 답한다. 다시 요약하지 않는다)\n\n${body}`;
}

// ---------- 노트 사진에서 그 날짜 부분 찾기 ----------

export const SCRAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["photos", "summary"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "has_day", "evidence", "other_days", "order", "crop", "private"],
        properties: {
          file: { type: "string", description: "사진 파일 이름 (경로 말고 이름만)" },
          has_day: { type: "boolean", description: "이 날짜의 노트가 이 사진에 있는가" },
          evidence: { type: "string", description: "무엇을 보고 판단했는가: 날짜 표시, 독서·복음 장절, 전례일 이름" },
          other_days: { type: "array", items: { type: "string" }, description: "같은 사진에 보이는 다른 날짜 표시" },
          order: { type: "integer", description: "이 날짜의 글이 이어지는 차례. 글의 맥락으로 정한다: 그날 글이 시작하는 부분이 1, 그 마지막 문장이 이어지는 부분이 2, 3 … has_day 가 아니면 0" },
          crop: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["top", "bottom", "left", "right"],
            properties: {
              top: { type: "number" },
              bottom: { type: "number" },
              left: { type: "number" },
              right: { type: "number" },
            },
            description: "그 날짜 부분만 남기는 사각형. 사진 전체 높이·너비를 1 로 본 비율 (0~1). has_day 가 아니면 null",
          },
          private: { type: "string", description: "crop 안에 공개하면 안 될 줄이 보이면 어디인지: 실명, 본당·단체 이름, 가족이나 다른 사람의 사정, 연락처·주소, 건강·돈 문제. 신앙적 결심이나 기도문은 공개해도 되는 글이므로 적지 않는다. 없으면 빈 문자열" },
        },
      },
    },
    summary: { type: "string", description: "한두 줄 요약: 어느 사진의 어느 부분이 이 날짜인지" },
  },
};

/**
 * @param {object} o
 * @param {string} o.date
 * @param {string[]} o.photoPaths   저장소 기준 상대 경로
 * @param {string} o.hint           대화에서 알게 된 전례일·장절 (없으면 빈 문자열)
 */
export function buildScrapPrompt({ date, photoPaths, hint }) {
  return `${date} 의 묵상 노트 사진에서 이 날짜의 부분을 찾는다. 사진에는 여러 날이 섞여 있을 수 있다
(한 쪽에 두세 날, 또는 펼친 두 쪽). 사진을 Read 도구로 하나씩 연다.

사진:
${photoPaths.map((p) => `  - ${p}`).join("\n")}
${hint ? `\n이 날짜에 대해 대화에서 알게 된 것: ${hint}\n` : ""}
판단 기준: 노트에 적힌 날짜 표시 (예: 11/3, 11.3, 11월 3일, 요일), 독서·복음 장절, 전례일 이름.
${date} 는 ${monthDay(date)} 이다. 날짜 표시가 없으면 장절로 추정하고 evidence 에 그렇게 적는다.

각 사진마다 has_day, evidence, other_days, order, crop, private 를 낸다.
- order 는 그날 글이 이어지는 차례다. 파일 이름이나 촬영 순서가 아니라 **글의 맥락**으로 정한다.
  각 사진의 그날 부분에서 첫 줄과 마지막 줄을 읽고, 어느 부분의 마지막 문장이 어느 부분의 첫 줄로 이어지는지 본다
  (예: 한 쪽 아래의 날짜·장절 표시와 물음이 다음 쪽 첫 줄의 답으로 이어지면 물음이 있는 쪽이 1, 답이 이어지는 쪽이 2).
  글이 시작하는 부분이 1, 그것을 잇는 부분이 2, 3 … 이다. 이어지는 근거(앞 부분의 끝 문장과 뒤 부분의 첫 문장)를 evidence 에 적는다. has_day 가 아니면 0.
- crop 은 그 날짜의 글이 모두 들어가고 다른 날의 줄은 들어가지 않는 가장 작은 사각형에 위아래로 2~3% 여유를 둔 것이다.
  top/bottom 은 위에서부터의 높이 비율, left/right 는 왼쪽부터의 너비 비율이다 (0 ≤ top < bottom ≤ 1, 0 ≤ left < right ≤ 1).
  그날 부분이 사진 전체면 {top:0, bottom:1, left:0, right:1}. 날짜 표시 줄은 crop 안에 넣는다.
  사진 안의 촬영 시각 표시(카메라 앱이 찍은 글자)는 있으면 남겨도 된다.
- private 는 실명, 본당·단체 이름, 가족이나 다른 사람의 사정, 연락처·주소, 건강·돈 문제처럼 공개 사이트에 실리면 안 될 줄만 적는다.
  신앙적 결심("…하겠습니다"), 기도문, 자기 반성은 이 노트의 본래 내용이라 공개해도 된다. 적지 않는다.
- 손글씨를 다 읽을 필요는 없다. 날짜와 장절, 경계를 찾는 것이 일이다.
- 지정된 JSON 스키마대로만 답한다. file 은 파일 이름만 적는다 (예: photo-2.jpg).`;
}

function monthDay(date) {
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일`;
}
