import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reflex",
  description: "From a complaint to a merged PR, without a single ticket written.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a className="brand" href="/">Reflex</a>
          <nav>
            <a href="/dashboard">Dashboard</a>
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
