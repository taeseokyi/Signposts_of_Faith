# 도우미 백엔드 (노트북)

집 노트북에서 돌리는 서버입니다. 폰이나 노트북 브라우저에서 화면(`app/`)을 열어 Claude 데스크톱에서
나눈 대화와 묵상 노트 사진을 보내면, 노트북의 `claude` CLI 가 WORKFLOW.md 기준으로 `content.md`
초안을 쓰고, 검토한 뒤 git 으로 발행(commit + push)합니다. 굿뉴스 게시판에는 올리지 않습니다.

```
폰 / 노트북 브라우저  ──대화·사진──▶  https://노트북:8788  ──▶  node 서버  ──▶  claude CLI (WSL)
        ▲                                   │                      │
        │                                   ├── python template/build.py check / site
        └──────── 초안·검사·미리보기 ────────┘                      └── git add / commit / push
```

저장소 작업 폴더가 곧 자료 보관소입니다. 날짜 폴더에 WORKFLOW.md 5장 규칙 그대로 놓입니다.

| 파일 | 어디에 | git |
|---|---|---|
| 대화 원문 | `YYYY-MM-DD/대화.md` | 제외 |
| 노트 사진 원본 | `YYYY-MM-DD/노트/photo-N.jpg` | 제외 |
| 공개용 노트 사진 | `YYYY-MM-DD/note-YYYY-MM-DD.jpg` (두 장째부터 `-1`, `-2`) | 커밋 |
| 그날의 글 | `YYYY-MM-DD/content.md` | 커밋 |
| 초안·작업 상태·CLI 로그·미리보기 | `server/data/YYYY-MM-DD/`, `server/data/_site/` | 제외 |

## 흐름

1. **날짜 폴더 만들기** — 날짜는 독서 장절로 정합니다.
2. **대화 저장** — Claude 데스크톱의 대화를 복사해 붙여 넣습니다. 없어도 됩니다 (노트만으로 물음을 다시 세웁니다).
3. **사진** — 원본은 `노트/`에 그대로 보관, 공개용은 폰 갤러리에서 그날 부분만 잘라 올립니다. 공개용은 가로 1400px 로 줄여 보내므로 촬영 정보(위치 포함)가 모두 지워집니다.
4. **초안 만들기** — `claude -p` 가 `WORKFLOW.md`, `template/content_template.md`, 가장 최근 `content.md` 본보기, 대화, 사진을 Read 로 읽고 JSON 스키마로 `content.md` 전문·8장 기록 블록·확인할 점을 냅니다. 서버가 `python template/build.py check` 로 검사해 [오류]가 있으면 그 목록을 붙여 최대 3번까지 다시 시킵니다.
5. **content.md 로 올리기 → 다듬기** — 화면에서 고치고 저장할 때마다 검사합니다. 사실 확인(전례일·장절·교리서 항·인용)은 사람이 합니다.
6. **미리보기** — `python template/build.py site --no-pdf` 로 `server/data/_site/` 를 만들어 `/preview/` 에 띄웁니다.
7. **발행** — `content.md`, 공개용 사진, WORKFLOW.md 8장 기록(초안의 블록을 `### (다음 기록은 여기에 이어서)` 앞에 끼움)을 `git add` → `commit "YYYY-MM-DD 묵상: 부제"` → `push`. push 가 막히면 커밋만 남기고 알려 줍니다.

claude CLI 에는 Read 도구만 줍니다. 저장소를 고치는 것은 서버이고, 커밋과 push 는 화면에서 **발행**을 눌렀을 때만 합니다.

## 준비

- Node.js 20.11 이상
- `claude` CLI (WSL), 구독 계정으로 로그인. `--bare` 는 쓰지 않습니다 (구독 로그인을 읽지 않음)
- Python 3.12 이상과 `pip install -r requirements.txt` (검사와 미리보기는 pymupdf 없이도 됩니다. `template/board_inline.py` 가 3.12 문법을 쓰므로 3.11 에서는 `check` 와 `site --no-pdf` 만 됩니다)
- `git` 이 push 할 수 있는 상태 (자격 증명 저장됨). 서버는 `GIT_TERMINAL_PROMPT=0` 으로 돌리므로 비밀번호를 묻는 상태면 push 가 실패합니다.
- openssl (https 용. Windows 에 없으면 WSL 것을 빌려 씁니다)

CLI 옵션(`-p`, `--output-format json`, `--json-schema`, `--tools`, `--allowedTools`, `--permission-prompts none`, `--max-turns`)은 Claude Code 2.1.316 에서 확인했습니다.

## 실행

### WSL 에서

```bash
cd ~/work/Signposts_of_Faith
cat > .env.local <<EOF
SIGNPOSTS_TOKEN=$(openssl rand -hex 16)
EOF
node server/launch.mjs            # 떼어 띄우기 (로그 server.log)
node server/launch.mjs status     # 돌고 있는지
node server/launch.mjs stop       # 끄기
```

창을 띄워 두고 보려면 `set -a; . ./.env.local; set +a; node server/server.mjs`.

WSL 은 LAN 에서 바로 안 보이므로 Windows 쪽에서 포트 전달과 방화벽을 한 번 엽니다 (관리자 PowerShell):

```powershell
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8788 connectaddress=127.0.0.1 connectport=8788
netsh advfirewall firewall add rule name="Signposts helper 8788" dir=in action=allow protocol=TCP localport=8788
```

### Windows 의 node 로 (carefor 와 같은 방식)

저장소를 Windows 폴더에 두고 `.env.local` 에 WSL 의 claude 경로를 적습니다.

```
SIGNPOSTS_TOKEN=긴_임의_문자열
CLAUDE_BIN=wsl -d Ubuntu -e /home/<WSL사용자>/.local/bin/claude
```

`wsl` 은 비로그인 셸이라 PATH 에 claude 가 없으므로 절대 경로를 적습니다 (`wsl -d Ubuntu -- which claude`).
사진·대화 경로는 저장소 기준 상대 경로로 넘기므로 따로 바꿀 것이 없습니다 (`wsl.exe` 가 현재 폴더를 `/mnt/c/...` 로 옮겨 시작합니다).
python 과 git 은 Windows 것을 씁니다. WSL 것을 쓰려면 `PYTHON_BIN=wsl -d Ubuntu -e python3`, `GIT_BIN=wsl -d Ubuntu -e git` 처럼 적습니다.

로그인할 때 창 없이 자동으로 뜨게 하려면 (일반 PowerShell):

```powershell
$root = 'C:\Temp\Signposts_of_Faith'   # 저장소 위치
$action   = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$root\server\start-hidden.vbs`"" -WorkingDirectory $root
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT20S'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskPath '\tsyi\' -TaskName 'Signposts helper' -Action $action -Trigger $trigger -Settings $settings
Start-ScheduledTask    -TaskPath '\tsyi\' -TaskName 'Signposts helper'
```

방화벽은 8788 포트를 엽니다: `netsh advfirewall firewall add rule name="Signposts helper 8788" dir=in action=allow protocol=TCP localport=8788`.

### 폰에서 열기

서버가 자체 서명 https 로 뜹니다 (`server/certs/`). 처음 한 번 폰에 루트 인증서를 설치합니다.

1. 폰 브라우저로 `https://<노트북IP>:8788/ca.crt` 를 받습니다 (경고 화면을 지나서).
2. 안드로이드: 설정 → 보안 → 암호화 및 사용자 인증 정보 → 인증서 설치 → **CA 인증서** → `signposts-ca.crt`
   아이폰: 설정 → 일반 → VPN 및 기기 관리에서 설치 후, 설정 → 일반 → 정보 → **인증서 신뢰 설정**에서 켜기
3. `https://<노트북IP>:8788/` 을 열고 ⚙ 설정에 토큰을 넣습니다. 크롬 메뉴 → **홈 화면에 추가**로 앱처럼 둘 수 있습니다.

노트북 IP 가 바뀌면 서버를 다시 띄울 때 새 IP 로 서버 인증서가 다시 발급됩니다. 폰은 루트 인증서만 믿으므로 손댈 것이 없습니다.

인증서 없이 쓰려면 `.env.local` 에 `TLS=off` 를 적고 `http://<노트북IP>:8788/` 로 엽니다. 같은 Wi-Fi 안에서만 쓰고, 홈 화면 설치(서비스 워커)는 안 됩니다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `SIGNPOSTS_TOKEN` | (필수) | 접근 토큰. 비어 있으면 서버가 뜨지 않습니다 |
| `PORT` | `8788` | 들을 포트 (carefor 는 8787) |
| `REPO_DIR` | 이 폴더의 상위 | 저장소 루트 |
| `DATA_DIR` | `server/data` | 초안과 작업 상태 |
| `CLAUDE_BIN` | `claude` | 실행할 명령. 앞에 `wsl -d Ubuntu -e` 를 붙일 수 있습니다 |
| `CLAUDE_MODEL` | (CLI 기본값) | `opus`, `sonnet` 등 |
| `PYTHON_BIN` | `python` (Windows) / `python3` | `template/build.py` 를 돌릴 파이썬 |
| `GIT_BIN` | `git` | |
| `MAX_UPLOAD_MB` | `200` | 한 번에 받는 최대 용량 |
| `TLS` | `on` | `off` 로 두면 http |
| `CERT_DIR` | `server/certs` | 인증서 보관 위치 |
| `TLS_HOSTS` | (자동) | 인증서에 더 넣을 IP·호스트명 (쉼표 구분) |

## 파일

| 파일 | 하는 일 |
|---|---|
| `server.mjs` | API 서버. `app/` 화면과 `/preview/` 도 함께 냅니다 |
| `days.mjs` | 날짜 폴더(대화, 사진, content.md)와 초안 상태 |
| `prompt.mjs` | claude 에 주는 프롬프트와 출력 스키마 |
| `runner.mjs` | `claude -p` 호출 |
| `exec.mjs` | python, git, claude 를 돌리는 공용 함수 |
| `tls.mjs` | 루트 CA 생성, 서버 인증서 재발급 |
| `launch.mjs` | 떼어 띄우고 끄는 런처 (`start` / `stop` / `status`) |
| `start-hidden.vbs`, `start.ps1` | Windows 에서 창 없이 / 창을 띄워 실행 |

## API

토큰은 `Authorization: Bearer <토큰>` 헤더나, `/api/login` 으로 받은 쿠키로 보냅니다.

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| GET | `/api/health` | 연결·토큰 확인 (토큰 없이 가능) |
| POST | `/api/login` | `{token}` → 쿠키. `<img>` 와 미리보기 페이지용 |
| GET | `/api/days` | 날짜 폴더 목록과 상태 |
| POST | `/api/days` | `{date}` 새 날짜 폴더 |
| GET | `/api/days/:date` | 대화, 사진 목록, content.md, 초안, 기록, 작업 상태 |
| PUT | `/api/days/:date/conversation` | `{text}` → `대화.md` (비우면 지움) |
| POST | `/api/days/:date/photos` | `{photos:[{kind:"note"|"public", mediaType, base64}]}` |
| GET / DELETE | `/api/days/:date/photos/:name` | 사진 보기 / 지우기 |
| POST | `/api/days/:date/draft` | `{instructions}` 초안 작업 등록 (한 번에 하나씩) |
| POST | `/api/days/:date/draft/apply` | 초안을 `content.md` 로 (있던 것은 `server/data/` 에 사본) |
| PUT | `/api/days/:date/content` | `{text}` 저장하고 검사 |
| GET | `/api/days/:date/check` | `content.md` 검사 결과 |
| POST | `/api/preview` | 웹사이트를 PDF 없이 빌드 → `/preview/` |
| GET | `/api/git` | 브랜치, push 안 된 커밋 수, 바뀐 파일 |
| POST | `/api/days/:date/publish` | `{message?, push?, record?}` commit + push |
| GET | `/ca.crt` | 폰에 설치할 루트 인증서 (토큰 불필요) |

## 문제가 생기면

- **`claude 명령을 찾지 못했습니다`** — `CLAUDE_BIN` 에 절대 경로를 적으세요.
- **`구조화된 초안을 받지 못했습니다`** — `server/data/<날짜>/claude-N.log` 에 CLI 의 원본 출력이 있습니다. 로그인이 풀렸거나, 사진을 못 읽었거나, `unknown option` 이 있으면 CLI 버전 차이입니다.
- **`content.md 검사(python)를 돌리지 못했습니다`** — `PYTHON_BIN` 과 파이썬 버전(3.12 이상)을 확인하세요. 노트북에서 `python template/build.py check <날짜>` 를 직접 돌려 보세요.
- **push 되지 않음** — 커밋은 남아 있습니다. 노트북 터미널에서 `git push` 를 하고, 자격 증명이 저장돼 있는지 확인하세요. 원격이 앞서 있으면(화면의 git 상태에 "원격이 N개 앞섬") 먼저 `git pull` 합니다.
- **폰에서 연결이 안 됨** — 서버가 떠 있는지(`node server/launch.mjs status`), 같은 Wi-Fi 인지, 방화벽과 포트 전달, 루트 인증서 설치 순으로 봅니다.
