"""신앙의 이정표 빌드.

    python template/build.py 2026-10-21          content.md → board.html, PDF
    python template/build.py 2026-10-21 --board  게시판용 HTML만 (PDF 생략)
    python template/build.py new 2026-10-24      새 날짜 폴더와 content.md 뼈대 만들기
    python template/build.py site                웹사이트를 _site/ 에 (GitHub Actions가 쓴다)
    python template/build.py site --no-pdf       웹사이트를 PDF 없이 빠르게
    python template/build.py check 2026-10-24    content.md 를 검사만 한다 (--json 으로 결과를 JSON 으로)
    python template/build.py check 초안.md --as 2026-10-24
                                                 다른 곳에 둔 초안을 그 날짜의 content.md 로 보고 검사

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

import content  # noqa: E402


def report(problems):
    for level, message in problems:
        print(f'  [{level}] {message}')
    return any(level == '오류' for level, _ in problems)


def cmd_new(day):
    date = datetime.date.fromisoformat(day[:10])  # 같은 날 하나 더는 YYYY-MM-DD-2
    folder = ROOT / day
    target = folder / 'content.md'
    if target.exists():
        sys.exit(f'이미 있습니다: {target}')
    (folder / '노트').mkdir(parents=True, exist_ok=True)
    skeleton = (HERE / 'content_template.md').read_text(encoding='utf-8')
    target.write_text(skeleton.replace('{날짜}', date.isoformat()), encoding='utf-8')
    print(f'만들었습니다: {target.relative_to(ROOT)}')
    print(f'노트 사진은 {(folder / "노트").relative_to(ROOT)}/ 에 둡니다.')


def cmd_check(target, as_day=None, as_json=False):
    """content.md 를 만들지 않고 검사만 한다. 도우미 앱(server/)이 초안을 검사할 때 쓴다."""
    import json
    if as_day:
        source, folder, day = Path(target), ROOT / as_day, as_day
    elif target.endswith('.md'):
        source = Path(target)
        folder, day = source.parent, source.parent.name
    else:
        folder, day = ROOT / target, target
        source = folder / 'content.md'
    result = {'file': str(source), 'day': day, 'problems': [], 'title': None, 'pdf': None, 'milestones': 0}
    try:
        if not source.is_file():
            raise content.ContentError(f'파일이 없습니다: {source}')
        data = content.parse(source, folder=folder)
        if data['date'].isoformat() != day[:10]:
            data['problems'].append(('오류', f'머리말 날짜({data["date"]})가 폴더 이름({day})과 다릅니다.'))
        result['problems'] = [list(p) for p in data['problems']]
        result['milestones'] = len(data['milestones'])
        try:
            result['title'] = content.title_of(data)
            result['pdf'] = content.pdf_name_of(data)
            if len(result['title']) > 55:
                result['problems'].append(['주의', f'제목이 {len(result["title"])}자입니다. (최대 55자)'])
        except KeyError:
            pass
    except (content.ContentError, ValueError) as e:
        result['problems'] = [['오류', str(e)]]
    result['ok'] = not any(level == '오류' for level, _ in result['problems'])
    if as_json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(f'검사: {source}')
        report(result['problems'])
        print('통과' if result['ok'] else '[오류]가 있습니다.')
    return result['ok']


def cmd_build(day, board_only=False, keep_html=False):
    folder = ROOT / day
    source = folder / 'content.md'
    if not source.is_file():
        sys.exit(f'content.md가 없습니다: {source}  (새로 시작하려면: python template/build.py new {day})')

    print(f'읽는 중: {source.relative_to(ROOT)}')
    data = content.parse(source)
    if data['date'].isoformat() != day[:10]:
        data['problems'].append(('오류', f'머리말 날짜({data["date"]})가 폴더 이름({day})과 다릅니다.'))
    if report(data['problems']):
        sys.exit('content.md를 고친 뒤 다시 실행하세요.')

    import board_inline
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


def cmd_site(out, with_pdf):
    import website
    out = Path(out) if Path(out).is_absolute() else ROOT / out
    print(f'웹사이트 만드는 중: {out}')
    entries = website.build_site(ROOT, out, with_pdf=with_pdf)
    print(f'묵상 {len(entries)}개 → {out / "index.html"}')


def main():
    parser = argparse.ArgumentParser(description='신앙의 이정표 빌드')
    parser.add_argument('args', nargs='+', help='YYYY-MM-DD  /  new YYYY-MM-DD  /  site')
    parser.add_argument('--board', action='store_true', help='게시판용 HTML만 만든다')
    parser.add_argument('--keep-html', action='store_true', help='PDF용 중간 HTML을 날짜 폴더에 남긴다')
    parser.add_argument('--no-pdf', action='store_true', help='site: 인쇄용 PDF를 만들지 않는다')
    parser.add_argument('--out', default='_site', help='site: 결과 폴더 (기본 _site)')
    parser.add_argument('--as', dest='as_day', help='check: 이 파일을 이 날짜(YYYY-MM-DD)의 content.md 로 보고 검사')
    parser.add_argument('--json', action='store_true', help='check: 결과를 JSON 한 줄로')
    a = parser.parse_args()
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        if a.args == ['site']:
            cmd_site(a.out, with_pdf=not a.no_pdf)
        elif a.args[0] == 'new' and len(a.args) == 2:
            cmd_new(a.args[1])
        elif a.args[0] == 'check' and len(a.args) == 2:
            sys.exit(0 if cmd_check(a.args[1], as_day=a.as_day, as_json=a.json) else 2)
        elif len(a.args) == 1:
            cmd_build(a.args[0], board_only=a.board, keep_html=a.keep_html)
        else:
            parser.error('인자가 잘못됐습니다.')
    except (content.ContentError, ValueError) as e:
        sys.exit(f'[오류] {e}')


if __name__ == '__main__':
    main()
