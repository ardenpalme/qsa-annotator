import { after } from "next/server";
import { exportJobToR2, parseCompletedJob, verifySignature } from "@/lib/cvat-export";

// CVAT webhook (event update:job). Public route: the HMAC signature replaces Clerk auth.
export async function POST(request: Request) {
  const secret = process.env.CVAT_WEBHOOK_SECRET;
  if (!secret) throw new Error("CVAT_WEBHOOK_SECRET is not set");

  const body = await request.text();
  if (!verifySignature(body, request.headers.get("x-signature-256"), secret)) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }

  let job;
  try {
    job = parseCompletedJob(JSON.parse(body));
  } catch (err) {
    console.error("cvat webhook: bad payload", err);
    return Response.json({ error: "bad payload" }, { status: 400 });
  }
  if (job === null) return Response.json({ skipped: true });

  // CVAT gives up on a webhook after 10 s; the export runs after the response
  after(async () => {
    try {
      const key = await exportJobToR2(job);
      console.log(`cvat webhook: job ${job.id} exported to ${key}`);
    } catch (err) {
      console.error(`cvat webhook: export of job ${job.id} failed`, err);
    }
  });
  return Response.json({ exporting: job.id }, { status: 202 });
}
