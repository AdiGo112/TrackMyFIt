import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TrackMyFit",
    short_name: "TrackMyFit",
    description: "Log the set, load the bar, beat last week.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0d0f",
    theme_color: "#0c0d0f",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
