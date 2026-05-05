import type { ReactNode } from "react";

export const metadata = {
  title: "WorkBrain",
  description: "Multi-client project memory layer for Cursor and Claude Code.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
