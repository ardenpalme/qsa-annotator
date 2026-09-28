import "dotenv/config";
import { NextResponse } from "next/server"
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { auth } from "@clerk/nextjs/server";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  forcePathStyle: true,
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { names, folder = "" } = (await request.json()) as { names: string[]; folder?: string };
  const urls = await Promise.all(
    names.map((name) =>
      getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: "floor-plans", Key: `${folder}${name}` }),
        { expiresIn: 300 },
      ),
    ),
  );
  return Response.json({ urls });
}


export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const cli = new S3Client({ forcePathStyle: true });
  const res = await cli.send(new ListObjectsV2Command({ Bucket: 'floor-plans' }))
  return Response.json({ keys: (res.Contents ?? []).map((o) => o.Key) })
}
