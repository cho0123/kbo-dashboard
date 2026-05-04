import { randomUUID } from "crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.KBO_AWS_REGION || "ap-northeast-2";
const bucket = process.env.S3_VIDEO_BUCKET || "kbo-video-export";
const fnName = process.env.LAMBDA_VIDEO_ENCODER || "kbo-video-encoder";

/** Netlify Function request body ≈ 6MB; presigned URL로 본문을 무겁게 쓰지 않음 */
const MAX_BODY_BYTES = 5.5 * 1024 * 1024;
const PRESIGN_EXPIRES_SEC = 3600;

const kboAccessKeyId = process.env.KBO_AWS_ACCESS_KEY_ID;
const kboSecretAccessKey = process.env.KBO_AWS_SECRET_ACCESS_KEY;
const credentials =
  kboAccessKeyId && kboSecretAccessKey
    ? { accessKeyId: kboAccessKeyId, secretAccessKey: kboSecretAccessKey }
    : undefined;

const clientConfig = { region, ...(credentials ? { credentials } : {}) };
const s3 = new S3Client(clientConfig);
const lambda = new LambdaClient(clientConfig);

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...extra,
  };
}

function jsonError(statusCode, err, details = undefined) {
  const body = { error: err, ...(details && { details }) };
  return {
    statusCode,
    headers: cors({ "Content-Type": "application/json; charset=utf-8" }),
    body: JSON.stringify(body),
  };
}

function bodyByteLength(event) {
  const raw = event.body;
  if (raw == null || raw === "") return 0;
  if (event.isBase64Encoded) {
    return Math.floor((raw.length * 3) / 4);
  }
  return Buffer.byteLength(raw, "utf8");
}

function safeJsonParse(event) {
  const len = bodyByteLength(event);
  if (len > MAX_BODY_BYTES) {
    return {
      ok: false,
      error: jsonError(413, "request_body_too_large", {
        maxBytes: Math.floor(MAX_BODY_BYTES),
        receivedBytes: len,
        hint: "Use POST with mode=prepare, then upload via presigned URLs, then mode=finalize (see API).",
      }),
    };
  }
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";
  if (!raw.trim()) {
    return { ok: true, data: {} };
  }
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    const pos = e && typeof e === "object" && "message" in e ? e.message : String(e);
    return {
      ok: false,
      error: jsonError(400, "invalid_json", {
        message: "JSON.parse failed for request body",
        parseError: pos,
        bodyPrefix: raw.slice(0, 200),
      }),
    };
  }
}

async function streamToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function presignPut(key, contentType) {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: PRESIGN_EXPIRES_SEC });
}

export const handler = async (event) => {
  const headers = cors({
    "Content-Type": "application/json; charset=utf-8",
  });

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    if (event.httpMethod === "GET") {
      const jobId = event.queryStringParameters?.jobId;
      if (!jobId) {
        return jsonError(400, "missing_jobId", {
          hint: "GET ?jobId=<uuid>",
        });
      }
      const key = `jobs/${jobId}/status.json`;
      let status;
      try {
        const out = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key })
        );
        const buf = await streamToBuffer(out.Body);
        status = JSON.parse(buf.toString("utf8"));
      } catch (e) {
        const name = e?.name || "";
        const code = e?.$metadata?.httpStatusCode;
        if (name === "NoSuchKey" || code === 404) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({
              state: "unknown",
              progress: 0,
              error: "status 없음 (jobId 확인)",
            }),
          };
        }
        throw e;
      }

      let downloadUrl = null;
      if (status.state === "done" && status.outputKey) {
        downloadUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: bucket, Key: status.outputKey }),
          { expiresIn: 3600 }
        );
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ...status,
          downloadUrl,
        }),
      };
    }

    if (event.httpMethod === "POST") {
      const parsed = safeJsonParse(event);
      if (!parsed.ok) {
        return parsed.error;
      }
      const body = parsed.data;
      const mode = body.mode;

      if (mode === "prepare") {
        const slideCount = Number(body.slideCount);
        const durations = body.durations;
        const transition = Number(body.transition ?? 0);

        if (!Number.isFinite(slideCount) || slideCount < 1) {
          return jsonError(400, "invalid_slideCount", { slideCount: body.slideCount });
        }
        if (!Array.isArray(durations) || durations.length !== slideCount) {
          return jsonError(400, "durations_mismatch", {
            expectedLength: slideCount,
            gotLength: Array.isArray(durations) ? durations.length : null,
          });
        }

        const jobId = body.jobId || randomUUID();

        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `jobs/${jobId}/status.json`,
            Body: JSON.stringify({ state: "uploading", progress: 0 }),
            ContentType: "application/json",
          })
        );

        const slideUrls = [];
        for (let i = 0; i < slideCount; i++) {
          const key = `jobs/${jobId}/input/slide_${i}.png`;
          slideUrls.push(await presignPut(key, "image/png"));
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            jobId,
            bucket,
            presignedPut: {
              slides: slideUrls,
              music: null,
            },
            expiresIn: PRESIGN_EXPIRES_SEC,
            hint: "PUT each file to its URL with Content-Type matching the object (image/png or audio/mpeg), then POST mode=finalize.",
          }),
        };
      }

      if (mode === "music_upload_url") {
        const fileName = body.fileName != null ? String(body.fileName) : "";
        void fileName;
        const key = `music/${randomUUID()}.mp3`;
        const presignedPutUrl = await presignPut(key, "audio/mpeg");
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            key,
            presignedPutUrl,
            expiresIn: PRESIGN_EXPIRES_SEC,
            bucket,
          }),
        };
      }

      if (mode === "thumbnail") {
        const { bgColor, accentColor, text1, text2, font, textColor } = body;
        const jobId = randomUUID();
        const outKey = `jobs/${jobId}/thumbnail.jpg`;

        const safeBg = (bgColor || "#000000").replace("#", "");
        const safeAccent = (accentColor || "#ffffff").replace("#", "");
        const safeTextHex = (textColor || "#ffffff").replace(/^#/, "");
        const safeText1 = (text1 || "")
          .replace(/'/g, "\\'")
          .replace(/:/g, "\\:");
        const safeText2 = (text2 || "")
          .replace(/'/g, "\\'")
          .replace(/:/g, "\\:");
        const fontFile = `/var/task/fonts/${font || "BlackHanSans-Regular"}.ttf`;

        const vf = [
          `drawbox=x=0:y=0:w=1080:h=160:color=${safeAccent}@0.2:t=fill`,
          `drawtext=fontfile=${fontFile}:text='${safeText1}':fontcolor=0x${safeTextHex}:fontsize=88:x=(w-text_w)/2:y=700:shadowcolor=black@0.8:shadowx=3:shadowy=3`,
          `drawbox=x=240:y=900:w=600:h=6:color=${safeAccent}:t=fill`,
          `drawtext=fontfile=${fontFile}:text='${safeText2}':fontcolor=0x${safeTextHex}:fontsize=52:x=(w-text_w)/2:y=960:shadowcolor=black@0.8:shadowx=2:shadowy=2`,
        ].join(",");

        const metaThumbnail = {
          type: "thumbnail",
          outKey,
          ffmpegArgs: [
            "-f",
            "lavfi",
            "-i",
            `color=c=#${safeBg}:size=1080x1920:rate=1`,
            "-vf",
            vf,
            "-frames:v",
            "1",
            "-q:v",
            "2",
            "/tmp/thumbnail.jpg",
          ],
        };

        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `jobs/${jobId}/meta.json`,
            Body: JSON.stringify(metaThumbnail),
            ContentType: "application/json",
          })
        );

        const invokeRes = await lambda.send(
          new InvokeCommand({
            FunctionName: fnName,
            InvocationType: "RequestResponse",
            Payload: Buffer.from(JSON.stringify({ bucket, jobId })),
          })
        );

        const lambdaResult = JSON.parse(
          Buffer.from(invokeRes.Payload).toString()
        );
        if (lambdaResult.errorMessage || !lambdaResult.ok) {
          return jsonError(500, "lambda_error", {
            detail: lambdaResult.errorMessage || JSON.stringify(lambdaResult),
          });
        }

        const downloadUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: bucket, Key: outKey }),
          { expiresIn: 3600 }
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ ok: true, downloadUrl }),
        };
      }

      if (mode === "finalize") {
        const jobId = body.jobId;
        const slideCount = Number(body.slideCount);
        const durations = body.durations;
        const transition = Number(body.transition ?? 0);
        const music_s3_key =
          body.music_s3_key != null && String(body.music_s3_key).trim() !== ""
            ? String(body.music_s3_key).trim()
            : null;
        const legacyUpload = Boolean(body.hasMusic) && !music_s3_key;
        const hasMusic = Boolean(music_s3_key) || legacyUpload;

        if (!jobId || typeof jobId !== "string") {
          return jsonError(400, "missing_jobId");
        }
        if (!Number.isFinite(slideCount) || slideCount < 1) {
          return jsonError(400, "invalid_slideCount");
        }
        if (!Array.isArray(durations) || durations.length !== slideCount) {
          return jsonError(400, "durations_mismatch", {
            expectedLength: slideCount,
            gotLength: Array.isArray(durations) ? durations.length : null,
          });
        }

        let musicOptions = null;
        if (hasMusic) {
          const mo = body.musicOptions && typeof body.musicOptions === "object" ? body.musicOptions : {};
          const volume = Number(mo.volume);
          const startTime = Number(mo.startTime);
          const fadeOutDuration = Number(mo.fadeOutDuration);
          musicOptions = {
            volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.8,
            startTime: Number.isFinite(startTime) ? Math.max(0, startTime) : 0,
            fadeOutDuration: Number.isFinite(fadeOutDuration)
              ? Math.min(5, Math.max(0, fadeOutDuration))
              : 2,
          };
        }

        const meta = {
          durations,
          transition,
          slideCount,
          hasMusic,
          ...(music_s3_key ? { music_s3_key } : {}),
          ...(musicOptions ? { musicOptions } : {}),
        };

        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `jobs/${jobId}/meta.json`,
            Body: JSON.stringify(meta),
            ContentType: "application/json",
          })
        );

        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `jobs/${jobId}/status.json`,
            Body: JSON.stringify({ state: "queued", progress: 5 }),
            ContentType: "application/json",
          })
        );

        await lambda.send(
          new InvokeCommand({
            FunctionName: fnName,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify({ bucket, jobId })),
          })
        );

        return {
          statusCode: 202,
          headers,
          body: JSON.stringify({ jobId, message: "queued" }),
        };
      }

      return jsonError(400, "invalid_or_missing_mode", {
        expected: "prepare | finalize | music_upload_url | thumbnail",
        received: mode,
        hint: "Large PNG payloads must not be sent in the JSON body. POST { mode:prepare, slideCount, durations, transition, hasMusic } then PUT files to presigned URLs, then POST { mode:finalize, jobId, ... }. Music library: mode music_upload_url.",
      });
    }

    return jsonError(405, "method_not_allowed", {
      method: event.httpMethod,
    });
  } catch (e) {
    console.error("[video-encode]", e);
    const name = e instanceof Error ? e.name : "Error";
    const message = e instanceof Error ? e.message : String(e);
    return jsonError(500, "internal_error", {
      name,
      message,
      ...(process.env.NETLIFY_DEV === "true" && e instanceof Error && e.stack
        ? { stack: e.stack }
        : {}),
    });
  }
};
