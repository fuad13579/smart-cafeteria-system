import "./globals.css";
import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthBootstrap } from "@/components/AuthBootstrap";
import { ToastProvider } from "@/components/ToastProvider";

export const metadata: Metadata = {
  title: "Smart Cafeteria",
  description: "Fast ordering for IUT cafeteria",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <ThemeProvider>
          <ToastProvider>
            <AuthBootstrap />
            <Header />
            <main className="mx-auto w-full max-w-4xl px-3 py-5 pb-28 sm:px-4 sm:py-8 sm:pb-8">{children}</main>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
