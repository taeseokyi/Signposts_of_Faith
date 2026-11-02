// claude CLI 에 넘길 프롬프트와 구조화 출력 스키마.
//
// CLI 는 저장소 루트를 작업 폴더로 두고 Read 도구만 쓸 수 있습니다. 그래서 경로는 모두
// 저장소 루트 기준 상대 경로로 적습니다. (Windows 에서 wsl 경유로 부를 때도 그대로 통합니다)

export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content_md", "record_md", "review"],
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
}) {
  const parts = [];

  parts.push(`너는 「신앙의 이정표」 작업의 정리 담당이다. ${date} 의 묵상을 WORKFLOW.md 의 기준에 맞춰
content.md 초안으로 정리한다. 글의 주인은 사용자이고, 노트에 적힌 사용자의 결론이 글의 중심이다.
너의 설명은 그것을 뒷받침하는 자리에 둔다.

## 먼저 읽을 것 (Read 도구)

1. WORKFLOW.md — 2장(대화 원칙), 3장(글의 구성과 분량, "대화가 남아 있지 않은 날"), 5장 "빌드"의 content.md 형식 설명
2. template/content_template.md — content.md 의 뼈대와 각 칸의 뜻
${examplePath ? `3. ${examplePath} — 실제로 완성된 content.md 본보기. 문체, 분량, 근거 정리 방식을 따른다` : "3. (본보기가 없다. template/content_template.md 를 따른다)"}

## 이날의 자료

${conversationPath
    ? `- 대화 원문: ${conversationPath} — 사용자가 claude 와 나눈 대화를 붙여 넣은 것. 사용자의 물음이 곧 이정표의 물음이다.`
    : `- 대화 원문: 없다. 3장 "대화가 남아 있지 않은 날"의 규칙을 따른다. 독서마다 이정표 하나를 두고, 물음은 노트 내용에서 다시 세운다. 여는 말씀의 고지문과 근거의 "참고"에 "그날의 대화가 남아 있지 않아 물음은 노트에서 다시 세웠다"고 밝힌다.`}
- 묵상 노트 사진 (Read 로 하나씩 열어 손글씨를 읽는다):
${list(photoPaths)}
- 머리말 "노트사진:" 에 적을 공개용 사진 파일 이름: ${publicPhotos.length ? publicPhotos.join(", ") : "(없음 — 빈 칸으로 둔다)"}

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

## review

사람이 확인해야 할 점을 한 줄씩. 전례일 이름과 주간, 독서·복음 장절, 교리서 항 번호, 인용 출처와 문구, 노트에서 읽기 어려웠던 글자, 개인 정보로 보이는 대목. 확인할 것이 없으면 빈 배열.`);

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
