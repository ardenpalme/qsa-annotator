import "dotenv/config";
import { NextResponse } from "next/server"
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

async function uploadfiles(files : File[], folder : string) {
  const cli = new S3Client({ forcePathStyle: true });
  for (const file of files) {
    await cli.send(
      new PutObjectCommand({
        Bucket: 'floor-plans',
        Key: folder + file.name,
        Body: Buffer.from(await file.arrayBuffer()),
      }),
    );
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const files = formData.getAll("files") as File[]
    const folder = (formData.get("folder") as string) ?? ""
    await uploadfiles(files, folder)
    return new Response(null, { status: 200 })
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : 'Unexpected error'
    console.error(message)
 
    return new NextResponse(message, { status: 500 })
  }
}


export async function GET() {
  const cli = new S3Client({ forcePathStyle: true });
  const res = await cli.send(new ListObjectsV2Command({ Bucket: 'floor-plans' }))
  return Response.json({ keys: (res.Contents ?? []).map((o) => o.Key) })
}
