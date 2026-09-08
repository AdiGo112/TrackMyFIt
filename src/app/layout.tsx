import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { TabBar, UIProvider } from "@/components/ui";
import { AuthGate } from "@/components/auth";

// Archivo carries a width axis, which is what makes the headings read as
// stencilled equipment signage rather than as another UI grotesque.
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  axes: ["wdth"],
});

// Every number in this app sits in a column that has to line up: weights, reps,
// timers, volumes. That is a job for a mono, not a preference.
const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "TrackMyFit",
  description: "Log the set, load the bar, beat last week.",
  // iOS ignores the manifest's display mode; this is what makes Add to Home
  // Screen open without Safari chrome.
  appleWebApp: {
    capable: true,
    title: "TrackMyFit",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c0d0f",
  // no user zoom: stops iOS zooming into weight inputs mid-set
  initialScale: 1,
  maximumScale: 1,
  width: "device-width",
  // required for the safe-area insets below to have any effect in standalone mode
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plex.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <UIProvider>
          <AuthGate>
          <div
            className="mx-auto w-full max-w-lg px-4"
            style={{
              paddingTop: "calc(1.75rem + env(safe-area-inset-top))",
              paddingBottom: "calc(6.5rem + env(safe-area-inset-bottom))",
            }}
          >
            {children}
          </div>
          <TabBar />
          </AuthGate>
        </UIProvider>
      </body>
    </html>
  );
}
