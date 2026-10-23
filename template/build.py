"""신앙의 이정표 빌드.

    python template/build.py 2026-10-21          content.md → board.html, PDF
    python template/build.py 2026-10-21 --board  게시판용 HTML만 (PDF 생략)
    python template/build.py new 2026-10-24      새 날짜 폴더와 content.md 뼈대 만들기

결과는 모두 날짜 폴더(예: 2026-10-21/) 안에 생긴다.
  board.html          게시판 HTML 모드에 붙여넣을 본문
  board_preview.html  붙여넣기 전에 브라우저로 열어 볼 미리보기
  게시정보.txt         제목·분류·태그 (복사용)
  YYYY-MM-DD_신앙의_이정표_부제.pdf
"""
import argparse
import datetime
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import board_inline  # noqa: E402
import content  # noqa: E402


def report(problems):
    for level, message in problems:
        print(f'  [{level}] {message}')
    return any(level == '오류' for level, _ in problems)


def cmd_new(day):
    date = datetime.date.fromisoformat(day)
    folder = ROOT / day
    target = folder / 'content.md'
    if target.exists():
        sys.exit(f'이미 있습니다: {target}')
    (folder / '노트').mkdir(parents=True, exist_ok=True)
    skeleton = (HERE / 'content_template.md').read_text(encoding='utf-8')
    target.write_text(skeleton.replace('{날짜}', date.isoformat()), encoding='utf-8')
    print(f'만들었습니다: {target.relative_to(ROOT)}')
    print(f'노트 사진은 {(folder / "노트").relative_to(ROOT)}/ 에 둡니다.')


def cmd_build(day, board_only=False, keep_html=False):
    folder = ROOT / day
    source = folder / 'content.md'
    if not source.is_file():
        sys.exit(f'content.md가 없습니다: {source}  (새로 시작하려면: python template/build.py new {day})')

    print(f'읽는 중: {source.relative_to(ROOT)}')
    data = content.parse(source)
    if data['date'].isoformat() != day:
        data['problems'].append(('오류', f'머리말 날짜({data["date"]})가 폴더 이름({day})과 다릅니다.'))
    if report(data['problems']):
        sys.exit('content.md를 고친 뒤 다시 실행하세요.')

    title = content.title_of(data)
    fragment = board_inline.render(data)
    problems = board_inline.check(fragment, title)
    if report(problems):
        sys.exit('게시판용 HTML이 4.3 제약을 지키지 못했습니다.')

    (folder / 'board.html').write_text(fragment, encoding='utf-8')
    (folder / 'board_preview.html').write_text(board_inline.preview_page(fragment, title), encoding='utf-8')
    meta = data['meta']
    info = [
        f'제목: {title}',
        f'제목 길이: {len(title)}자 (최대 55자)',
        '분류: 우리들의 묵상',
        f'태그: {meta.get("태그", "")}',
        f'본문: board.html ({len(fragment):,}자) — 편집 창 아래 HTML 버튼을 누른 뒤 붙여넣기',
    ]
    (folder / '게시정보.txt').write_text('\n'.join(info) + '\n', encoding='utf-8')
    print(f'게시판용 HTML: {day}/board.html ({len(fragment):,}자)')
    print(f'  제목: {title} ({len(title)}자)')

    if board_only:
        return
    import print_pdf
    pdf = folder / content.pdf_name_of(data)
    total, body_pages = print_pdf.build(data, pdf, keep_html_dir=folder if keep_html else None)
    print(f'인쇄용 PDF: {day}/{pdf.name} (표지 + 본문 {body_pages}쪽 = {total}쪽)')
    if body_pages > 8:
        print(f'  [주의] 본문이 {body_pages}쪽입니다. (3장 분량 기준: 6~8쪽)')


def main():
    parser = argparse.ArgumentParser(description='신앙의 이정표 빌드')
    parser.add_argument('args', nargs='+', help='YYYY-MM-DD  또는  new YYYY-MM-DD')
    parser.add_argument('--board', action='store_true', help='게시판용 HTML만 만든다')
    parser.add_argument('--keep-html', action='store_true', help='PDF용 중간 HTML을 날짜 폴더에 남긴다')
    a = parser.parse_args()
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        if a.args[0] == 'new' and len(a.args) == 2:
            cmd_new(a.args[1])
        elif len(a.args) == 1:
            cmd_build(a.args[0], board_only=a.board, keep_html=a.keep_html)
        else:
            parser.error('인자가 잘못됐습니다.')
    except (content.ContentError, ValueError) as e:
        sys.exit(f'[오류] {e}')


if __name__ == '__main__':
    main()
