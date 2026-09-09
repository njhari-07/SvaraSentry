import type { Metadata } from "next";
import "./globals.css";
import "./tailwind.css";

export const metadata: Metadata = {
  title: "ChhayaSwara · Voice authenticity monitor",
  description: "Real-time voice-clone risk monitoring.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
