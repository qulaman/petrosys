import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { themeInitScript } from "@/lib/theme/theme-script";
import { ru } from "@/lib/i18n/ru";
import { Toaster } from "@/components/ui/sonner";
import { NavProgressProvider } from "@/components/nav-progress";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${ru.app.name} — ${ru.app.tagline}`,
  description: "Система управления и учёта производства West Arlan Group",
  appleWebApp: { capable: true, title: "Arlan Ops", statusBarStyle: "default" },
  icons: { apple: "/icon-192.png" },
};

export const viewport = {
  themeColor: "#c2410c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Тема применяется до отрисовки — без мигания при загрузке. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <NavProgressProvider>{children}</NavProgressProvider>
        <Toaster />
      </body>
    </html>
  );
}
