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
        const hasMusic = Boolean(body.hasMusic);

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

        let musicUrl = null;
        if (hasMusic) {
          musicUrl = await presignPut(
            `jobs/${jobId}/input/music.mp3`,
            "audio/mpeg"
          );
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            jobId,
            bucket,
            presignedPut: {
              slides: slideUrls,
              music: musicUrl,
            },
            expiresIn: PRESIGN_EXPIRES_SEC,
            hint: "PUT each file to its URL with Content-Type matching the object (image/png or audio/mpeg), then POST mode=finalize.",
          }),
        };
      }

      if (mode === "finalize") {
        const jobId = body.jobId;
        const slideCount = Number(body.slideCount);
        const durations = body.durations;
        const transition = Number(body.transition ?? 0);
        const hasMusic = Boolean(body.hasMusic);

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

        const meta = {
          durations,
          transition,
          slideCount,
          hasMusic,
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
        expected: "prepare | finalize",
        received: mode,
        hint: "Large PNG payloads must not be sent in the JSON body. POST { mode:prepare, slideCount, durations, transition, hasMusic } then PUT files to presigned URLs, then POST { mode:finalize, jobId, ... }.",
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
