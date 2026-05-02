import { randomUUID } from "crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION || "ap-northeast-2";
const bucket = process.env.S3_VIDEO_BUCKET || "kbo-video-export";
const fnName = process.env.LAMBDA_VIDEO_ENCODER || "kbo-video-encoder";

const s3 = new S3Client({ region });
const lambda = new LambdaClient({ region });

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...extra,
  };
}

async function streamToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "missing jobId" }),
        };
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
      const body = JSON.parse(event.body || "{}");
      const jobId = body.jobId || randomUUID();
      const slides = body.slides;

      if (!Array.isArray(slides) || slides.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "slides 배열 필요" }),
        };
      }

      const durations = body.durations;
      if (!Array.isArray(durations) || durations.length !== slides.length) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: "durations 길이가 slides와 같아야 합니다.",
          }),
        };
      }

      const transition = Number(body.transition ?? 0);
      const musicBase64 = body.musicBase64 || null;

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `jobs/${jobId}/status.json`,
          Body: JSON.stringify({ state: "uploading", progress: 0 }),
          ContentType: "application/json",
        })
      );

      for (let i = 0; i < slides.length; i++) {
        const buf = Buffer.from(slides[i], "base64");
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `jobs/${jobId}/input/slide_${i}.png`,
            Body: buf,
            ContentType: "image/png",
          })
        );
      }

      const meta = {
        durations,
        transition,
        slideCount: slides.length,
        hasMusic: Boolean(musicBase64),
      };

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `jobs/${jobId}/meta.json`,
          Body: JSON.stringify(meta),
          ContentType: "application/json",
        })
      );

      if (musicBase64) {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `jobs/${jobId}/input/music.mp3`,
            Body: Buffer.from(musicBase64, "base64"),
            ContentType: "audio/mpeg",
          })
        );
      }

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

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "method not allowed" }),
    };
  } catch (e) {
    console.error("[video-encode]", e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
      }),
    };
  }
};
