import type { MetadataRoute } from "next";

/** PWA-манифест: полевые сотрудники ставят приложение на главный экран. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QuarryOps — учёт техники и ГСМ",
    short_name: "QuarryOps",
    description: "Учёт работы техники и ГСМ на карьере",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#c2410c",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
