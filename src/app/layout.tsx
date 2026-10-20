import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'
import { cn } from "@/lib/utils";
import Link from "next/link";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Floor Plan Annotator",
  description: "Quantity Surveyor AI Annotation Tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}>
      <body className="min-h-full flex flex-col">
        <ClerkProvider>
          <header className="flex justify-between items-center p-4 gap-4 h-12 border-b">
            <nav className="flex items-center gap-6 text-lg font-medium">
              <Link href="/" className="font-semibold">Upload</Link>
              <a href="https://cvat.fpcadanot438.xyz" className="text-muted-foreground hover:text-foreground">
                Annotate
              </a>
            </nav>

            <div className="flex items-center gap-4">
              <Show when="signed-out">
                <SignInButton />
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
            </div>
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  )
}
