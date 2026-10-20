import { createHmac, timingSafeEqual } from "node:crypto";
import { unzipSync } from "fflate";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// CVAT webhooks send `X-Signature-256: sha256=<hex HMAC-SHA256(secret, raw body)>`
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (header === null) return false;
  const expected = Buffer.from(
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex"),
  );
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type CompletedJob = { id: number; taskName: string };

// Returns the job when the payload is an `update:job` event for a job in state "completed", null for any other
// event. The update payload carries no previous state, so this also fires on later saves of a completed job.
export function parseCompletedJob(payload: unknown): CompletedJob | null {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("webhook payload is not an object");
  }
  const { event, job } = payload as { event?: unknown; job?: unknown };
  if (event !== "update:job") return null;

  if (typeof job !== "object" || job === null) {
    throw new Error("update:job payload has no job object");
  }
  const { id, state, task_name } = job as { id?: unknown; state?: unknown; task_name?: unknown };
  if (typeof id !== "number" || typeof state !== "string" || typeof task_name !== "string") {
    throw new Error(`malformed job in update:job payload: ${JSON.stringify(job)}`);
  }
  return state === "completed" ? { id, taskName: task_name } : null;
}

const ANNOTATIONS_PREFIX = "datasets/private/annotations/";

// Same rule as sanitizeName in src/app/api/files/route.ts
const sanitizeName = (s: string) =>
  s.replace(/[/\\]/g, "_").replace(/\.{2,}/g, "_").slice(0, 200);

export function annotationKey(taskName: string, jobId: number): string {
  return `${ANNOTATIONS_PREFIX}${sanitizeName(taskName)}_job_${jobId}.xml`;
}

// A "CVAT for images 1.1" export without images is a zip holding a single annotations.xml
export function extractAnnotationsXml(zip: Uint8Array): Uint8Array {
  const files = unzipSync(zip, { filter: (f) => f.name === "annotations.xml" });
  const xml = files["annotations.xml"];
  if (xml === undefined) {
    throw new Error("export zip has no annotations.xml");
  }
  return xml;
}

const EXPORT_FORMAT = "CVAT for images 1.1";
const POLL_INTERVAL_MS = 2_000;
const EXPORT_TIMEOUT_MS = 5 * 60_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function cvatFetch(url: string | URL, method = "GET", okStatuses: number[] = []): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${requireEnv("CVAT_ACCESS_TOKEN")}` },
  });
  if (!res.ok && !okStatuses.includes(res.status)) {
    throw new Error(`CVAT ${method} ${url} -> ${res.status}: ${await res.text()}`);
  }
  return res;
}

// Exports the job's annotations (no images) from CVAT and writes annotations.xml to R2. Returns the R2 key.
export async function exportJobToR2(job: CompletedJob): Promise<string> {
  const cvatUrl = requireEnv("CVAT_URL");
  const bucket = requireEnv("BUCKET");

  const exportUrl = new URL(`/api/jobs/${job.id}/dataset/export`, cvatUrl);
  exportUrl.search = new URLSearchParams({
    format: EXPORT_FORMAT,
    save_images: "false",
    location: "local", // otherwise a task whose target storage is a cloud storage exports there
  }).toString();
  // 409: an export of the same job and format is already running; its rq_id is in the body
  const { rq_id } = (await (await cvatFetch(exportUrl, "POST", [409])).json()) as { rq_id: string };

  const deadline = Date.now() + EXPORT_TIMEOUT_MS;
  let resultUrl: string | undefined;
  while (resultUrl === undefined) {
    if (Date.now() > deadline) throw new Error(`export ${rq_id} did not finish in ${EXPORT_TIMEOUT_MS} ms`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const status = (await (
      await cvatFetch(new URL(`/api/requests/${encodeURIComponent(rq_id)}`, cvatUrl))
    ).json()) as { status: string; message?: string; result_url?: string | null };
    if (status.status === "failed") throw new Error(`export ${rq_id} failed: ${status.message}`);
    if (status.status === "finished") {
      if (!status.result_url) throw new Error(`export ${rq_id} finished without a result_url`);
      resultUrl = status.result_url;
    }
  }

  const zip = new Uint8Array(await (await cvatFetch(resultUrl)).arrayBuffer());
  const key = annotationKey(job.taskName, job.id);
  const s3 = new S3Client({ forcePathStyle: true, endpoint: process.env.AWS_ENDPOINT_URL_S3 });
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: extractAnnotationsXml(zip),
      ContentType: "application/xml",
    }),
  );
  return key;
}
