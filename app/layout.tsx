import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MR00100 AI — YOUR SYSTEM. YOUR COMMAND.",
  description:
    "MR00100 AI — a lightweight, futuristic, voice-controlled personal AI command center and coding assistant.",
};

export const viewport: Viewport = {
  themeColor: "#02060a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="green" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
