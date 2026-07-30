import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { themeInitScript } from "@/lib/theme/theme-script";
import { ru } from "@/lib/i18n/ru";
import { Toaster } from "@/components/ui/sonner";
import { NavProgressProvider } from "@/components/nav-progress";

// subsets управляет предзагрузкой: без cyrillic preload уходил на латиницу,
// которой в интерфейсе почти нет, а весь русский текст перерисовывался вторым
// заходом. Гос. номера и цифры остаются латиницей — нужны оба набора.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  // template — чтобы вкладка называлась «Справочники — Arlan Ops», а не одинаково у всех.
  title: {
    default: `${ru.app.name} — ${ru.app.tagline}`,
    template: `%s — ${ru.app.name}`,
  },
  description: "Система управления и учёта производства West Arlan Group",
  appleWebApp: { capable: true, title: "Arlan Ops", statusBarStyle: "default" },
  icons: { apple: "/icon-192.png" },
};

export const viewport = {
  themeColor: "#c2410c",
  // Без cover отступы env(safe-area-inset-*) на iOS всегда 0 — нижнее меню
  // и закреплённые панели наезжают на системную полосу жестов.
  viewportFit: "cover" as const,
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
