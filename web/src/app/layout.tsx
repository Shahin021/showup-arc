import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ShowUp | Programmable commitment on Arc",
    template: "%s | ShowUp",
  },
  description:
    "Create free or paid events, accept USDC commitments, issue wallet-bound private invitations, and settle attendance transparently on Arc.",
  applicationName: "ShowUp",
  keywords: [
    "ShowUp",
    "Arc",
    "USDC",
    "Circle",
    "programmable money",
    "events",
    "reservations",
    "onchain attendance",
  ],
};

export const viewport: Viewport = {
  themeColor: "#050817",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#050817] text-white">
        {children}
      </body>
    </html>
  );
}
