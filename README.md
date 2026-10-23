# 신앙의 이정표 · Signposts of Faith

말씀을 따라 걸은 하루의 묵상.

매일 미사의 독서와 복음을 붙들고 묻고 답한 것을 몇 개의 **이정표**로 정리합니다.
지켜야 할 규칙이 아니라, 길을 잃었을 때 다시 펼쳐 볼 표지판입니다.

- **웹사이트**: <https://taeseokyi.github.io/Signposts_of_Faith/>
- **굿뉴스 게시판**: 「우리들의 묵상/체험」 <https://maria.catholic.or.kr/mi_pr/missa/bbs_list.asp?menu=4770>

> 이 글들은 AI와 나눈 대화에서 나왔습니다. 정리와 결론은 묵상 노트에 적은 나의 말을 중심으로 하며,
> Claude가 정리한 문장과 교회 문헌의 직접 인용은 구분해 표시합니다.

## 한 편이 세 가지로 나옵니다

날짜 폴더의 `content.md` 하나가 원본이고, 나머지는 모두 여기서 만들어집니다.

| 결과 | 쓰임 | 만드는 곳 |
|---|---|---|
| 웹사이트 쪽 | 누구나 읽는 공개 페이지 | GitHub Actions (main에 push할 때마다) |
| 게시판용 HTML | 굿뉴스 게시판에 붙여넣을 본문 | 내 컴퓨터 |
| 인쇄용 PDF | A4로 뽑아 두고 다시 읽기 (웹사이트에서도 내려받기) | 둘 다 |

## 폴더

```
├── README.md
├── WORKFLOW.md              작업 절차와 기준 (대화 원칙, 구성, 디자인, 게시 절차, 기록)
├── requirements.txt
├── .github/workflows/
│   └── pages.yml            웹사이트 자동 배포
├── template/                빌드 코드
│   ├── build.py               실행 파일
│   ├── content.py             content.md 읽기와 검사
│   ├── content_template.md    새 날짜의 뼈대
│   ├── board_inline.py        게시판용 HTML
│   ├── print_pdf.py           인쇄용 PDF
│   ├── print.css
│   ├── website.py             웹사이트
│   └── web.css
└── 2026-10-21/
    └── content.md           그날의 묵상 (원본)
```

빌드 결과(`board.html`, PDF, `_site/`)와 묵상 노트 사진은 저장소에 넣지 않습니다.

## 쓰는 법

필요한 것: Python 3, `pip install -r requirements.txt`, Edge 또는 Chrome.

```bash
python template/build.py new 2026-10-24      # 새 날짜 폴더와 content.md 뼈대
python template/build.py 2026-10-24          # 게시판용 HTML + 인쇄용 PDF
python template/build.py site                # 웹사이트를 _site/ 에 (미리 보기)
```

하루를 마치면:

```bash
git add -A
git commit -m "2026-10-24 묵상: 부제"
git push                                     # → 몇 분 뒤 웹사이트에 반영
```

`content.md`의 형식, 게시판에 올리는 법, 디자인 기준은 [WORKFLOW.md](WORKFLOW.md)에 있습니다.

## 웹사이트 배포

`main`에 push하면 [웹사이트 배포](.github/workflows/pages.yml) 워크플로가 돌아
날짜 폴더의 `content.md`를 모두 읽어 사이트와 PDF를 만들고 GitHub Pages에 올립니다.

- 머리말에 `공개: 아니오`라고 쓴 날은 사이트에 싣지 않습니다. 다만 저장소가 공개라서 `content.md` 자체는 GitHub에서 보입니다. 아직 내보이고 싶지 않은 초안은 push하지 마세요.
- `content.md`에 오류가 있는 날은 건너뛰고 나머지만 배포합니다. 배포 기록은 저장소의 **Actions** 탭에서 볼 수 있습니다.
