import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Projekt-Assistent",
    short_name: "Assistent",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#1f6feb",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
