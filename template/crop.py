#!/usr/bin/env python3
"""노트 사진 원본에서 한 영역을 잘라 공개용 JPEG 로 만든다 (노트북 도우미의 '한 번에 발행'이 쓴다).

    python template/crop.py <원본> <결과.jpg> --top 0.26 --bottom 1 --left 0 --right 1 [--width 1400]

- 비율은 사진 전체 높이·너비를 1 로 본 값이다 (화면의 자르기 편집기와 같은 뜻).
- 촬영 방향(EXIF orientation)을 먼저 적용해 브라우저가 보여 주는 모습과 같은 기준으로 자른다.
- 결과는 가로 --width px 이하로 줄이고, 촬영 정보(EXIF, 위치)는 싣지 않는다.
- Pillow 가 필요하다: pip install pillow
"""
import argparse
import json
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--top', type=float, default=0.0)
    ap.add_argument('--bottom', type=float, default=1.0)
    ap.add_argument('--left', type=float, default=0.0)
    ap.add_argument('--right', type=float, default=1.0)
    ap.add_argument('--width', type=int, default=1400)
    ap.add_argument('--quality', type=int, default=88)
    a = ap.parse_args()

    try:
        from PIL import Image, ImageOps
    except ImportError:
        print(json.dumps({'error': 'Pillow 가 없습니다. pip install pillow'}, ensure_ascii=False))
        return 2

    im = Image.open(a.src)
    im = ImageOps.exif_transpose(im)
    if im.mode not in ('RGB', 'L'):
        im = im.convert('RGB')
    w, h = im.size
    clamp = lambda v: min(1.0, max(0.0, v))
    top, bottom, left, right = clamp(a.top), clamp(a.bottom), clamp(a.left), clamp(a.right)
    if bottom - top < 0.05:
        top, bottom = 0.0, 1.0
    if right - left < 0.05:
        left, right = 0.0, 1.0
    box = (round(w * left), round(h * top), max(round(w * left) + 1, round(w * right)), max(round(h * top) + 1, round(h * bottom)))
    out = im.crop(box)
    if out.width > a.width:
        out = out.resize((a.width, round(out.height * a.width / out.width)), Image.LANCZOS)
    out.save(a.dst, 'JPEG', quality=a.quality, optimize=True)  # exif 를 넘기지 않으므로 촬영 정보가 빠진다
    print(json.dumps({'file': a.dst, 'width': out.width, 'height': out.height, 'box': box}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
