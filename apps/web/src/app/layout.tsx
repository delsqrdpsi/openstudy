import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenStudy",
  description: "A whiteboard tutor you run yourself.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request: the Content-Security-Policy nonce (see proxy.ts) is new each time.
  await connection();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
