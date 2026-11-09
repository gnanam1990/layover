import type { ReactNode } from "react";
// Self-hosted fonts (no network at build time): DM Sans 400/500/700, JetBrains Mono 400/500, Spectral 400.
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/spectral/400.css";
import "../styles/theme.css";

export const metadata = {
  title: "Layover · your trip's guardian",
  description:
    "Saves money before you fly. Rescues you when it breaks. Built on Kite Agent Passport and SERV Reasoning.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
