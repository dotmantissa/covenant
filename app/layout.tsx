import type { Metadata } from "next";
import { Archivo, Newsreader } from "next/font/google";
import "./globals.css";
import { AppPrivyProvider } from "@/components/privy-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import type { ReactNode } from "react";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Covenant | Intelligent Credit Facilities",
  description:
    "On-chain credit facilities whose conditions are written in plain English and continuously evaluated by GenLayer validators.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${newsreader.variable} ${archivo.variable}`}>
      <body className="antialiased min-h-screen flex flex-col bg-[var(--paper)] text-[var(--ink)]">
        <ThemeProvider>
          <AppPrivyProvider>
            <Header />
            <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
              {children}
            </main>
          </AppPrivyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
