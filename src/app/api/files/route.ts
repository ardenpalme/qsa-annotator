import "dotenv/config";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { auth } from "@clerk/nextjs/server";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const MAX_FILES = 50;

const s3 = new S3Client({
  forcePathStyle: true,
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
});

const sanitizeName = (s: string) =>
  s.replace(/[/\\]/g, "_").replace(/\.{2,}/g, "_").slice(0, 200);

const sanitizeFolder = (s: string) =>
  s.replace(/^\/+|\/+$/g, "")
   .replace(/[^a-zA-Z0-9/_-]/g, "")
   .replace(/\/{2,}/g, "/");

export async function POST(request: Request) {
  const { userId } = await auth.protect()
  const body = await request.json() as { files?: unknown };
  const files = body.files;

  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
      return Response.json(
        { error: `files must be 1..${MAX_FILES} entries` },
        { status: 400 },
      );
    }

  for (const f of files) {
    if (
      typeof f !== "object" ||
      f === null ||
      typeof (f as any).name !== "string" ||
      (f as any).name.length === 0 ||
      ((f as any).folder !== undefined && typeof (f as any).folder !== "string")
    ) {
      return Response.json({ error: "bad file entry" }, { status: 400 });
    }
  }

  try {
    const items = await Promise.all(
      (files as { name: string; folder?: string }[]).map(async ({ name, folder }) => {
        const safeFolder = folder ? sanitizeFolder(folder) : "";
        const prefix = safeFolder ? `${safeFolder}/` : "";
        const key = `${prefix}${userId}_${randomUUID()}_${sanitizeName(name)}`;

        const url = await getSignedUrl(
          s3,
          new PutObjectCommand({ Bucket: process.env.BUCKET, Key: key }),
          { expiresIn: 300 },
        );

        return { url, key, name, folder: safeFolder };
      }),
    );

    return Response.json({ items });
  } catch (err) {
    console.error("presign failed", err);
    return Response.json({ error: "presign failed" }, { status: 502 });
  }
}

export async function GET() {
  const { userId } = await auth.protect()
  const cli = new S3Client({ forcePathStyle: true });
  const res = await cli.send(new ListObjectsV2Command({ Bucket: 'floor-plans' }))
  return Response.json({ keys: (res.Contents ?? []).map((o) => o.Key) })
}
