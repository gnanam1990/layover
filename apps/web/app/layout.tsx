import type { ReactNode } from "react";
import { DM_Sans, JetBrains_Mono, Spectral } from "next/font/google";
import "../styles/theme.css";

const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-dm-sans" });
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
});
const spectral = Spectral({ subsets: ["latin"], weight: ["400"], variable: "--font-spectral" });

export const metadata = {
  title: "Layover · your trip's guardian",
  description:
    "Saves money before you fly. Rescues you when it breaks. Built on Kite Agent Passport and SERV Reasoning.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${mono.variable} ${spectral.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
