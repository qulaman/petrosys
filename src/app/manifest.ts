import type { MetadataRoute } from "next";

/** PWA-манифест: полевые сотрудники ставят приложение на главный экран. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Arlan Ops — West Arlan Group",
    short_name: "Arlan Ops",
    description: "Система управления и учёта производства West Arlan Group",
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
