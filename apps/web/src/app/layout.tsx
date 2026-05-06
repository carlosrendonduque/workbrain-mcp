import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "WorkBrain",
  description: "Multi-client project memory layer for Cursor and Claude Code.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
