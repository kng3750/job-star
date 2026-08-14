# Job Star

상담사와 행정 실무자를 위한 행정업무 자동화 및 상담 지원 웹 애플리케이션입니다. 정적 프론트엔드와 Gemini 서버리스 API로 구성되어 있습니다.

## 보안 구조

Gemini API 키는 `GEMINI_API_KEY` 서버 환경변수로만 읽습니다. API 키는 HTML, 브라우저 JavaScript, 정적 파일, Git 저장소에 포함되지 않으며, `/api/generate` 서버리스 함수에서만 Gemini API를 호출합니다.

압축파일이나 과거 로컬 파일에 있던 기존 키는 재사용하지 말고 발급처에서 폐기·재발급하세요. 실제 키는 채팅, 코드, README, `.env.example`에 입력하지 않습니다.

## 로컬 실행

Node.js 18 이상에서 다음 명령을 실행합니다.

```bash
npm install
```

Windows PowerShell에서는 현재 터미널 세션에만 새 키를 설정한 뒤 실행할 수 있습니다.

```powershell
$env:GEMINI_API_KEY="새로 발급한 키"
$env:GEMINI_MODEL="gemini-2.5-flash"
npm start
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열고 [http://localhost:3000/api/health](http://localhost:3000/api/health)의 `hasApiKey`가 `true`인지 확인합니다. API 키 원문은 응답에 포함되지 않습니다.

## Vercel 배포

GitHub 저장소를 Vercel 프로젝트에 연결한 뒤 Vercel 프로젝트 설정의 Environment Variables에서 다음 변수를 필요한 환경에 등록합니다.

| 이름 | 값 | 적용 환경 |
|---|---|---|
| `GEMINI_API_KEY` | 새로 발급한 Gemini API 키 | Preview, Production 및 필요한 Development |
| `GEMINI_MODEL` | 기본값은 `gemini-2.5-flash` | 선택 사항 |

`GEMINI_API_KEY`는 서버 환경변수로 등록하고 `NEXT_PUBLIC_` 또는 `VITE_` 접두사는 사용하지 않습니다. 키 값을 입력한 뒤 새 배포를 실행해야 배포에 반영됩니다.

## 기능

1. 상담일지 자동 생성
2. 면접 예상 질문 및 답변 생성
3. 모의 면접 답변 피드백
4. 취업 후 사후관리 계획 수립
5. 사례 종결 요약 보고서
6. 취업 전략 전환

## 배포 전 보안 검사

```bash
grep -RInE --exclude-dir=node_modules --exclude-dir=.git 'GEMINI_API_KEY|__GEMINI_API_KEY|AIza|gemini-config|gemini\.env|generativelanguage.googleapis.com|\\?key=' .
```

소스 코드에서 `GEMINI_API_KEY`가 나타나는 것은 서버 환경변수 조회와 문서의 변수명까지는 정상입니다. 그러나 실제 키 값, `window.__GEMINI_API_KEY`, 브라우저의 Gemini URL 또는 `?key=` 호출이 나타나면 커밋하지 않습니다.

## API

`GET /api/health`는 서버 환경변수에 키가 설정되어 있는지만 Boolean으로 반환합니다. `POST /api/generate`는 `{ "feature": "counselingLog", "input": { ... } }` 형식으로 요청하며, 기능별 결과를 반환합니다. 인증 쿼리와 API 키는 외부 응답에 포함되지 않습니다.
