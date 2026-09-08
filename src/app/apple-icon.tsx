import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/**
 * A loaded competition bar, in the international plate colours — the same code
 * the app uses everywhere. Fuller bleed than the maskable icon: iOS applies its own rounding.
 */
export default function Icon() {
  const red = { width: 56, height: 300, borderRadius: 8, background: "#e23a2e" };
  const blue = { width: 42, height: 300, borderRadius: 8, background: "#2d6fd1" };
  const collar = { width: 22, height: 132, borderRadius: 6, background: "#98a1ab" };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          background: "#0c0d0f",
        }}
      >
        <div style={collar} />
        <div style={blue} />
        <div style={red} />
        <div style={{ width: 108, height: 52, borderRadius: 4, background: "#f2efe9" }} />
        <div style={red} />
        <div style={blue} />
        <div style={collar} />
      </div>
    ),
    size
  );
}
