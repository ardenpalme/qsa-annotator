"use client"

import { S3UploadForm } from "@/components/file-upload-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="flex flex-col items-center p-6">
      <S3UploadForm />
    </main>
  );
}
