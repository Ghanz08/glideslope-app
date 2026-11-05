import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/env";
import { BACKGROUND_COLOR, THEME_COLOR } from "./tokens";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    lang: "id",
    start_url: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // F-12.2 (Chrome/Edge ≥ 89, installed PWA)
    share_target: { action: "/share-target", method: "POST", enctype: "multipart/form-data", params: { files: [{ name: "image", accept: ["image/*"] }] } },
  } as MetadataRoute.Manifest;
}
