"use client"

import * as React from "react"
import { useAuth } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card"
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "./ui/spinner"
import {
  ChevronRight, File as FileIcon, Folder as FolderIcon, Plus, X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Input } from "./ui/input"

import { Skeleton } from "@/components/ui/skeleton"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"

const MAX_VISIBLE_ROWS = 10;
const PRESIGN_BATCH = 50
const UPLOAD_CONCURRENCY = 4

// ---------------- types ----------------

type PendingStatus = "pending" | "uploading" | "error"

type PendingItem = {
  id: string
  file: File
  folder: string              // "" for root, otherwise "docs/" (trailing slash)
  status: PendingStatus
}

type PutResult = { ok: boolean; status: number }

type UploadProgress = {
  phase: "presign" | "upload"
  loadedBytes: number
  totalBytes: number
  done: number
  failed: number
  total: number
}

type TreeNode = {
  name: string
  path: string                // "" for root, otherwise "docs/" (trailing slash)
  children: Map<string, TreeNode>
  files: string[]             // existing keys at this level
  pending: PendingItem[]      // queued uploads targeting this folder
}

// ---------------- tree building ----------------

function buildTree(
  keys: string[],
  pending: PendingItem[],
  extraFolders: string[],
): TreeNode {
  const root: TreeNode = {
    name: "", path: "", children: new Map(), files: [], pending: [],
  }

  function ensure(path: string): TreeNode {
    let node = root
    let cur = ""
    for (const part of path.split("/").filter(Boolean)) {
      cur += part + "/"
      let child = node.children.get(part)
      if (!child) {
        child = { name: part, path: cur, children: new Map(), files: [], pending: [] }
        node.children.set(part, child)
      }
      node = child
    }
    return node
  }

  for (const key of keys) {
    if (key.endsWith("/")) {
      // directory marker — ensure the node exists, don't add a file
      ensure(key)
      continue
    }
    const parts = key.split("/").filter(Boolean)
    if (!parts.length) continue
    const fileName = parts.pop()!
    const folderPath = parts.length ? parts.join("/") + "/" : ""
    const node = folderPath ? ensure(folderPath) : root
    node.files.push(fileName)
  }

  for (const path of extraFolders) ensure(path)

  for (const p of pending) {
    const node = p.folder ? ensure(p.folder) : root
    node.pending.push(p)
  }

  return root
}

// ---------------- drop zone ----------------

function useDropZone(onFiles: (files: File[]) => void) {
  const [isOver, setIsOver] = React.useState(false)
  const depth = React.useRef(0)

  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files")

  return {
    isOver,
    handlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        depth.current++
        setIsOver(true)
      },
      onDragOver: (e: React.DragEvent) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = "copy"
      },
      onDragLeave: (e: React.DragEvent) => {
        e.stopPropagation()
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setIsOver(false)
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        depth.current = 0
        setIsOver(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length) onFiles(files)
      },
    },
  }
}

// ---------------- leaf bits ----------------

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

// fetch() exposes no upload progress, so PUT via XHR to get xhr.upload.onprogress
function putWithProgress(
  url: string,
  file: File,
  onProgress: (loadedBytes: number) => void,
): Promise<PutResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status })
    xhr.onerror = () => reject(new Error(`PUT failed: network error (${file.name})`))
    xhr.onabort = () => reject(new Error(`PUT aborted (${file.name})`))
    xhr.send(file)
  })
}

function PendingRow({
  item, onRemove,
}: { item: PendingItem; onRemove: (id: string) => void }) {
  const uploading = item.status === "uploading"
  const errored = item.status === "error"
  return (
    <div className={cn(
      "group flex items-center gap-2 rounded px-3 py-1 text-sm",
      errored ? "text-destructive" : "text-muted-foreground italic",
    )}>
      <FileIcon className="size-4 shrink-0 opacity-50" />
      <span className="truncate">{item.file.name}</span>
      <span className="ml-auto shrink-0 text-xs opacity-60">
        {errored ? "failed" : formatBytes(item.file.size)}
      </span>
      {uploading && <Spinner className="size-3 shrink-0" />}
      {!uploading && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Remove"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

function FileRow({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-sm">
      <FileIcon className="size-4 shrink-0" />
      <span className="truncate">{name}</span>
    </div>
  )
}

// ---------------- tree node ----------------

function FolderRows({
  pending, files, onRemovePending,
}: {
  pending: PendingItem[]
  files: string[]
  onRemovePending: (id: string) => void
}) {
  const all = [
    ...pending.map((p) => ({ kind: "pending" as const, p })),
    ...files.map((f) => ({ kind: "file" as const, f })),
  ]
  const visible = all.slice(0, MAX_VISIBLE_ROWS)
  const hidden = all.length - visible.length
  return (
    <>
      {visible.map((row) =>
        row.kind === "pending"
          ? <PendingRow key={row.p.id} item={row.p} onRemove={onRemovePending} />
          : <FileRow key={row.f} name={row.f} />,
      )}
      {hidden > 0 && (
        <div className="px-3 py-1 text-xs italic text-muted-foreground">
          … and {hidden} more
        </div>
      )}
    </>
  )
}

function FolderNodeImpl({
  node, onDropFiles, onRemovePending,
}: {
  node: TreeNode
  onDropFiles: (files: File[], folder: string) => void
  onRemovePending: (id: string) => void
}) {
  const { isOver, handlers } = useDropZone((files) => onDropFiles(files, node.path))
  const empty = node.children.size === 0 && node.files.length === 0 && node.pending.length === 0

  const allRows = [
    ...node.pending.map((p) => ({ kind: "pending" as const, p })),
    ...node.files.map((f) => ({ kind: "file" as const, f })),
  ];
  const visible = allRows.slice(0, MAX_VISIBLE_ROWS);
  const hidden = allRows.length - visible.length;

  return (
    // handlers live on the wrapper so the whole subtree is a drop target;
    // stopPropagation in the hook keeps the parent zone from also firing.
    <div
      {...handlers}
      className={cn(
        "rounded-md transition-colors",
        isOver && "bg-primary/10 ring-1 ring-inset ring-primary/40",
      )}
    >
      <Collapsible>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="group w-full cursor-pointer justify-start gap-1"
            />
          }
        >
          <ChevronRight className="size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
          <FolderIcon className="size-4 shrink-0" />
          <span className="truncate">{node.name}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
        <div className="pl-4">
          <FolderRows pending={node.pending} files={node.files} onRemovePending={onRemovePending} />
          {[...node.children.values()].map((child) => (
            <FolderNode
              key={child.path}
              node={child}
              onDropFiles={onDropFiles}
              onRemovePending={onRemovePending}
            />
          ))}
        </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

const FolderNode = React.memo(FolderNodeImpl, (prev, next) =>
  prev.node === next.node &&
  prev.onDropFiles === next.onDropFiles &&
  prev.onRemovePending === next.onRemovePending
);

// ---------------- main ----------------

function TreeSkeleton() {
  return (
    <div className="space-y-1 py-1" aria-hidden>
      {[
        { indent: 0, width: "w-24" },
        { indent: 1, width: "w-32" },
        { indent: 2, width: "w-28" },
        { indent: 2, width: "w-40" },
        { indent: 1, width: "w-20" },
        { indent: 1, width: "w-36" },
        { indent: 1, width: "w-24" },
      ].map((row, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-3 py-1"
          style={{ paddingLeft: 12 + row.indent * 20 }}
        >
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className={cn("h-3.5", row.width)} />
        </div>
      ))}
    </div>
  )
}


function NewFolderDialog({
  open,
  onOpenChange,
  existing,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing: string[]
  onCreate: (path: string) => void
}) {
  const [value, setValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  // reset each time the dialog opens
  React.useEffect(() => {
    if (open) {
      setValue("")
      setError(null)
    }
  }, [open])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const raw = value.trim().replace(/^\/+|\/+$/g, "")
    if (!raw) {
      setError("Enter a folder name")
      return
    }
    if (!/^[a-zA-Z0-9/_-]+$/.test(raw)) {
      setError("Only letters, numbers, /, _, and - are allowed")
      return
    }
    const path = raw + "/"
    if (existing.includes(path)) {
      setError("That folder already exists")
      return
    }
    onCreate(path)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Use "/" to nest, e.g. reports/2024/q4
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Input
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setError(null)
              }}
              placeholder="folder/name"
              aria-invalid={!!error}
            />
            {error && (
              <p className="mt-2 text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button type="submit" className="cursor-pointer">
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function S3UploadForm() {
  const { isLoaded, isSignedIn } = useAuth()

  const [objs, setObjs] = React.useState<string[]>([])
  const [pending, setPending] = React.useState<PendingItem[]>([])
  const [extraFolders, setExtraFolders] = React.useState<string[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/files")
      if (res.ok) {
        const { keys } = (await res.json()) as { keys: string[] }
        setObjs(keys)
      }
    } finally {
      setLoaded(true)
    }
  }, [])

  React.useEffect(() => { void refresh() }, [refresh])

  // stop the browser from navigating when a file is dropped anywhere else
  React.useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault()
    document.addEventListener("dragover", prevent)
    document.addEventListener("drop", prevent)
    return () => {
      document.removeEventListener("dragover", prevent)
      document.removeEventListener("drop", prevent)
    }
  }, [])

  const addFiles = React.useCallback((files: File[], folder: string) => {
    setPending((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        folder,
        status: "pending" as const,
      })),
    ])
  }, [])

  const removePending = React.useCallback((id: string) => {
    setPending((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const tree = React.useMemo(
    () => buildTree(objs, pending, extraFolders),
    [objs, pending, extraFolders],
  )

  const rootDrop = useDropZone((files) => addFiles(files, ""))

  const ready = pending.filter((p) => p.status === "pending" && p.file.name.length > 0)

  // per-file bytes live in refs; XHR progress events are coalesced into one
  // setProgress per animation frame so big batches don't re-render per event
  const [progress, setProgress] = React.useState<UploadProgress | null>(null)
  const loadedRef = React.useRef<number[]>([])
  const countsRef = React.useRef({ done: 0, failed: 0 })
  const rafRef = React.useRef<number | null>(null)

  const scheduleProgress = React.useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const loadedBytes = loadedRef.current.reduce((a, b) => a + b, 0)
      const { done, failed } = countsRef.current
      setProgress((prev) => prev && { ...prev, loadedBytes, done, failed })
    })
  }, [])

  async function uploadAll(
    items: PendingItem[],
    signed: { url: string; key: string }[],
    concurrency: number,
    onFileProgress: (i: number, loadedBytes: number) => void,
    onFileDone: (i: number, ok: boolean) => void,
  ): Promise<PromiseSettledResult<PutResult>[]> {
    const results: PromiseSettledResult<PutResult>[] = new Array(items.length)
    let next = 0
    async function worker() {
      while (true) {
        const i = next++
        if (i >= items.length) return
        let r: PromiseSettledResult<PutResult>
        try {
          r = {
            status: "fulfilled",
            value: await putWithProgress(signed[i].url, items[i].file, (loaded) => onFileProgress(i, loaded)),
          }
        } catch (e) {
          r = { status: "rejected", reason: e }
        }
        results[i] = r
        onFileDone(i, r.status === "fulfilled" && r.value.ok)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
    return results
  }

  async function presignBatch(batch: PendingItem[]): Promise<{ url: string; key: string }[]> {
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: batch.map((p) => ({
          name: p.file.name,
          folder: p.folder.replace(/\/$/, ""),
        })),
      }),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => "<no body>")
      throw new Error(`presign failed: ${res.status} — ${err}`)
    }
    const { items: batchSigned } = (await res.json()) as {
      items: { url: string; key: string }[]
    }
    return batchSigned
  }

  async function upload() {
    if (!ready.length || submitting) return
    setSubmitting(true)
    setPending((prev) =>
      prev.map((p) => (p.status === "pending" ? { ...p, status: "uploading" } : p)),
    )
    loadedRef.current = ready.map(() => 0)
    countsRef.current = { done: 0, failed: 0 }
    setProgress({
      phase: "presign",
      loadedBytes: 0,
      totalBytes: ready.reduce((sum, p) => sum + p.file.size, 0),
      done: 0,
      failed: 0,
      total: ready.length,
    })

    try {
      // presign each batch right before uploading it so URLs (expiresIn: 300s)
      // don't go stale while earlier batches are still uploading
      for (let start = 0; start < ready.length; start += PRESIGN_BATCH) {
        const batch = ready.slice(start, start + PRESIGN_BATCH)
        const signed = await presignBatch(batch)
        setProgress((prev) => prev && { ...prev, phase: "upload" })

        const results = await uploadAll(
          batch,
          signed,
          4,
          (i, loaded) => {
            loadedRef.current[start + i] = loaded
            scheduleProgress()
          },
          (i, ok) => {
            // count failed files as finished so the bar still reaches 100%
            loadedRef.current[start + i] = batch[i].file.size
            if (ok) countsRef.current.done++
            else countsRef.current.failed++
            scheduleProgress()
          },
        )

        const okIds = new Set<string>()
        const errIds = new Set<string>()
        results.forEach((r, i) => {
          const id = batch[i].id
          if (r.status === "fulfilled" && r.value.ok) okIds.add(id)
          else errIds.add(id)
        })

        setPending((prev) =>
          prev
            .filter((p) => !okIds.has(p.id))
            .map((p) => (errIds.has(p.id) ? { ...p, status: "error" as const } : p)),
        )
      }
    } catch (err) {
      console.error(err)
      setPending((prev) =>
        prev.map((p) =>
          p.status === "uploading" ? { ...p, status: "error" as const } : p,
        ),
      )
    } finally {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      setProgress(null)
      setSubmitting(false)
      await refresh()
    }
  }

  const progressPct = !progress
    ? 0
    : progress.totalBytes > 0
      ? (progress.loadedBytes / progress.totalBytes) * 100
      : ((progress.done + progress.failed) / progress.total) * 100


  if (!isLoaded) return (
    <Skeleton className="w-full sm:max-w-lg h-40" />
  );

  if (!isSignedIn) return (
    <h1>You must be signed in to view this page</h1>
  );

  return (
    <Card className="w-full sm:max-w-lg">
      <CardHeader>
        <CardTitle>Upload files</CardTitle>
        <CardDescription>
          Drag files onto a folder, or anywhere in the tree to upload to the root.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Files</span>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFolderDialogOpen(true)}
                className="cursor-pointer"
              >
                <Plus className="size-4" /> New folder
              </Button>
            </div>
          </div>
        </div>

        <div
          {...rootDrop.handlers}
          className={cn(
            "min-h-40 rounded-md border border-dashed p-2 transition-colors",
            rootDrop.isOver ? "border-primary bg-primary/5" : "border-border",
          )}
        >
        {!loaded ? (
          <TreeSkeleton />
        ) : (
          <>
            {tree.pending.map((p) => (
              <PendingRow key={p.id} item={p} onRemove={removePending} />
            ))}
            {tree.files.map((f) => <FileRow key={f} name={f} />)}
            {[...tree.children.values()].map((child) => (
              <FolderNode
                key={child.path}
                node={child}
                onDropFiles={addFiles}
                onRemovePending={removePending}
              />
            ))}
            {tree.children.size === 0 &&
              tree.files.length === 0 &&
              tree.pending.length === 0 && (
                <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
                  Drop files here
                </div>
              )}
          </>
        )}
        </div>

        {progress && (
          <Progress value={progressPct} className="gap-2 pt-1">
            <ProgressLabel className="text-xs font-normal text-muted-foreground">
              {progress.phase === "presign" ? (
                "Preparing uploads…"
              ) : (
                <>
                  {progress.done}/{progress.total} files
                  {" · "}
                  {formatBytes(progress.loadedBytes)} / {formatBytes(progress.totalBytes)}
                  {progress.failed > 0 && (
                    <span className="text-destructive"> · {progress.failed} failed</span>
                  )}
                </>
              )}
            </ProgressLabel>
            <ProgressValue className="text-xs" />
          </Progress>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {ready.length === 0
            ? "No files queued"
            : `${ready.length} file${ready.length === 1 ? "" : "s"} queued`}
        </span>
        <div className="flex gap-2">
          {pending.length > 0 && (
            <Button
              type="button" variant="outline"
              onClick={() => setPending([])}
              disabled={submitting}
              className="cursor-pointer"
            >
              Clear
            </Button>
          )}
          <Button
            type="button"
            onClick={upload}
            disabled={!ready.length || submitting}
            className="cursor-pointer"
          >
            {submitting && <Spinner />}
            {submitting ? "Uploading" : "Upload"}
          </Button>
        </div>
      </CardFooter>
      <NewFolderDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        existing={extraFolders}
        onCreate={(path) =>
          setExtraFolders((prev) => (prev.includes(path) ? prev : [...prev, path]))
        }
      />
    </Card>
  )
}
