import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annotationKey,
  extractAnnotationsXml,
  parseCompletedJob,
  verifySignature,
} from "./cvat-export.ts";

// HMAC-SHA256 of BODY with key "s3cret", computed with `openssl dgst -sha256 -hmac s3cret`
const BODY = '{"event": "ping", "webhook_id": 1}';
const SIGNATURE = "sha256=a2cf2e396d40583b190b31f42bbcedbbafa8dca057be0a9a3d6958a3a33741d3";

test("signature from CVAT verifies", () => {
  assert.equal(verifySignature(BODY, SIGNATURE, "s3cret"), true);
});

test("signature fails for a tampered body, wrong secret, or missing header", () => {
  assert.equal(verifySignature(BODY.replace("1", "2"), SIGNATURE, "s3cret"), false);
  assert.equal(verifySignature(BODY, SIGNATURE, "other"), false);
  assert.equal(verifySignature(BODY, null, "s3cret"), false);
  assert.equal(verifySignature(BODY, "sha256=abc", "s3cret"), false);
});

const jobEvent = (job: Record<string, unknown>, event = "update:job") => ({
  event,
  webhook_id: 1,
  job: { id: 42, task_id: 7, task_name: "plan-001", type: "annotation", ...job },
  sender: null,
});

test("a completed job update yields the job id and task name", () => {
  assert.deepEqual(parseCompletedJob(jobEvent({ state: "completed" })), {
    id: 42,
    taskName: "plan-001",
  });
});

test("jobs that are not completed, and other events, are skipped", () => {
  assert.equal(parseCompletedJob(jobEvent({ state: "in progress" })), null);
  assert.equal(parseCompletedJob(jobEvent({ state: "completed" }, "create:job")), null);
  assert.equal(parseCompletedJob({ event: "ping", webhook_id: 1 }), null);
});

test("a malformed job update throws", () => {
  assert.throws(() => parseCompletedJob({ event: "update:job" }));
  assert.throws(() => parseCompletedJob(jobEvent({ state: "completed", task_name: undefined })));
  assert.throws(() => parseCompletedJob(jobEvent({ state: "completed", id: "42" })));
  assert.throws(() => parseCompletedJob(null));
});

test("annotations are keyed by task name and job id under the annotations prefix", () => {
  assert.equal(annotationKey("plan-001", 42), "datasets/private/annotations/plan-001_job_42.xml");
});

test("a task name cannot escape the annotations prefix", () => {
  assert.equal(
    annotationKey("../a/b\\c", 3),
    "datasets/private/annotations/__a_b_c_job_3.xml",
  );
});

// Deflated zips written by Python's zipfile
const XML = "<annotations><version>1.1</version></annotations>";
const ZIP_WITH_ANNOTATIONS =
  "UEsDBBQAAAAIAAclVF3QcvZfIQAAADEAAAAPAAAAYW5ub3RhdGlvbnMueG1ss0nMy8svSSzJzM8rtrMpSy0qBrLsDPUMbfRhHBt9ZDUAUEsBAhQDFAAAAAgAByVUXdBy9l8hAAAAMQAAAA8AAAAAAAAAAAAAAIABAAAAAGFubm90YXRpb25zLnhtbFBLBQYAAAAAAQABAD0AAABOAAAAAAA=";
const ZIP_WITHOUT_ANNOTATIONS =
  "UEsDBBQAAAAIAAclVF2DFtyMAwAAAAEAAAAJAAAAb3RoZXIudHh0qwAAUEsBAhQDFAAAAAgAByVUXYMW3IwDAAAAAQAAAAkAAAAAAAAAAAAAAIABAAAAAG90aGVyLnR4dFBLBQYAAAAAAQABADcAAAAqAAAAAAA=";

test("annotations.xml is extracted from a CVAT export zip", () => {
  const xml = extractAnnotationsXml(Buffer.from(ZIP_WITH_ANNOTATIONS, "base64"));
  assert.equal(Buffer.from(xml).toString("utf8"), XML);
});

test("an export zip without annotations.xml throws", () => {
  assert.throws(
    () => extractAnnotationsXml(Buffer.from(ZIP_WITHOUT_ANNOTATIONS, "base64")),
    /annotations\.xml/,
  );
});
