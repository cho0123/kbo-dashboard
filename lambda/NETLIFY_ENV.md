# Netlify · AWS — 영상 인코딩 연동 환경변수

## Netlify (Site → Environment variables)

| 변수 | 예시 | 설명 |
|------|------|------|
| `AWS_ACCESS_KEY_ID` | `AKIA...` | S3 업로드·상태 읽기·presigned URL, Lambda `Invoke` 권한이 있는 IAM 사용자 키 |
| `AWS_SECRET_ACCESS_KEY` | (비밀) | 위와 쌍 |
| `AWS_REGION` | `ap-northeast-2` | 서울 리전 |
| `S3_VIDEO_BUCKET` | `kbo-video-export` | PNG / `status.json` / 출력 MP4 저장 버킷 |
| `LAMBDA_VIDEO_ENCODER` | `kbo-video-encoder` | 비동기 인코딩 Lambda 함수 이름 |

### IAM 권한(요약)

- S3: `kbo-video-export` 에 대해 `GetObject`, `PutObject`, `ListBucket`(선택)
- Lambda: `lambda:InvokeFunction` 대상 `kbo-video-encoder`

### 제한 사항

- Netlify Functions 요청 본문 크기 제한(약 6MB)이 있어, **PNG·음악 base64 합이 크면** 업로드 실패할 수 있습니다. 그 경우 S3 presigned multipart 등으로 분리 업로드가 필요합니다.

## AWS Lambda (`kbo-video-encoder`)

| 변수 | 예시 | 설명 |
|------|------|------|
| `AWS_REGION` | `ap-northeast-2` | (런타임 기본과 동일 가능) |
| `S3_BUCKET` | `kbo-video-export` | 입력·출력 버킷 (`index.mjs` 기본값과 동일 가능) |

### Lambda 실행 역할

- S3 `kbo-video-export` 에 `GetObject`, `PutObject`
- CloudWatch Logs
- 레이어: `arn:aws:lambda:ap-northeast-2:145266761615:layer:ffmpeg:1` (함수에 연결)

### S3 버킷 CORS (브라우저에서 presigned MP4 직접 열 때)

최소 예시 (필요 도메인만 `AllowedOrigins` 로 제한 권장):

```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
  </CORSRule>
</CORSConfiguration>
```

## 로컬 개발

- `netlify dev` 로 Functions + 리다이렉트 적용 후 API 호출.
- Vite는 `vite.config.js` 에 `/api/video-encode` → Netlify proxy 설정됨.
