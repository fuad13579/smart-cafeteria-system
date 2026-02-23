// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { ThemeProvider } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Smart Cafeteria",
  description: "Fast ordering for IUT cafeteria",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <ThemeProvider>
          <Header />
          <main className="mx-auto w-full max-w-4xl px-4 py-8">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}