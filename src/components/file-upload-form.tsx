"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import * as z from "zod"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { buttonVariants } from "@/components/ui/button"
import { Spinner } from "./ui/spinner"
import { CirclePlus, ChevronDown, ChevronRight, File, Folder } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

type Tree = { [name: string]: Tree } // a node with no children is a file

function buildTree(keys: string[]): Tree {
  const root: Tree = {}
  for (const key of keys) {
    let node = root
    for (const part of key.split("/").filter(Boolean)) {
      node = node[part] ??= {}
    }
  }
  return root
}

function listFolders(keys: string[]): string[] {
  const set = new Set<string>([""])
  for (const key of keys) {
    const parts = key.split("/").slice(0, -1) // drop the file name
    parts.forEach((_, i) => set.add(parts.slice(0, i + 1).join("/") + "/"))
  }
  return [...set].sort()
}

function TreeNode({ tree }: { tree: Tree }) {
  return (
    <ul className="pl-4">
      {Object.entries(tree).map(([name, children]) => (
        <li key={name}>
          {Object.keys(children).length ? (
            <Collapsible>
              <CollapsibleTrigger
                render={<Button variant="ghost" size="sm" className="group cursor-pointer" />}
              >
                <ChevronRight className="cursor-pointer transition-transform group-data-[panel-open]:rotate-90" />
                <Folder />
                {name}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <TreeNode tree={children} />
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 text-sm">
              <File className="size-4" />
              {name}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

const formSchema = z.object({
  folder: z.string(),
  files: z.array(z.file())
})

export function S3UploadForm() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      folder: "",
      files: [],
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        names: data.files.map((f) => f.name),
        folder: data.folder,
      }),
    });
    if (!res.ok) throw new Error(`Presign failed: ${res.status}`);
    const { urls } = (await res.json()) as { urls: string[] };

    const puts = await Promise.all(
      data.files.map((f, i) => fetch(urls[i], { method: "PUT", body: f })),
    );
    const failed = puts.filter((r) => !r.ok);
    if (failed.length) throw new Error(`${failed.length} upload(s) failed`);

    const list = await fetch("/api/files");
    if (list.ok) {
      const { keys } = (await list.json()) as { keys: string[] };
      setObjs(keys);
    }

    form.resetField("files");
  }

  const [objs, setObjs] = React.useState<string[]>([])
  React.useEffect(() => {
    async function load () {
      const list = await fetch("/api/files");
      if (list.ok) {
        const { keys } = (await list.json()) as { keys: string[] };
        setObjs(keys);
      }
    }
    load()
  },[])

  const folders = React.useMemo(() => listFolders(objs), [objs])

  return (
      <Card className="w-full sm:max-w-md">
        <CardHeader>
          <CardTitle>Cloudflare R2 Object Storage File Upload</CardTitle>
          <CardDescription>
            Upload files into their respective directories
          </CardDescription>
        </CardHeader>
        <form id="upload-form" onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent>
            <div className="flex flex-row gap-x-4 justify-between">
            <Controller
              name="files"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} className="w-auto">
                  <label className={buttonVariants({ variant: "outline", className: "cursor-pointer" })}>
                    <input 
                      type="file" 
                      multiple
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      onChange={(e) => field.onChange(Array.from(e.target.files ?? []))}
                      className="hidden"
                    />
                    Add Files
                    <CirclePlus/>
                  </label>
                  {field.value && (
                    <ul>
                      {field.value.map((f) => (
                        <li key={f.name}>{f.name}</li>
                      ))}
                    </ul>
                  )}
                </Field>
              )}
            />
            <Controller
              name="folder"
              control={form.control}
              render={({ field }) => (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button type="button" variant="outline" className="justify-between cursor-pointer" />}
                  >
                    <span className="flex items-center gap-2 truncate w-30">
                      <Folder />
                      {field.value || "/ (root)"}
                    </span>
                    <ChevronDown />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-64 overflow-y-auto">
                    <DropdownMenuRadioGroup value={field.value} onValueChange={field.onChange}>
                      {folders.map((f) => (
                        <DropdownMenuRadioItem key={f} value={f}>
                          {f || "/ (root)"}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            />
            <Button type="submit" form="upload-form" className="cursor-pointer" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />}
              {form.formState.isSubmitting ? "Uploading" : "Upload"}
            </Button>
            </div>
          </CardContent>
        </form>
        <CardFooter>
          <TreeNode tree={buildTree(objs)} />
        </CardFooter>
      </Card>
  );
}

