import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
  variable: "--font-fraunces",
  display: "swap",
});

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata = {
  title: "CRM Salamandra",
  description: "CRM SaaS Salamandra Solutions",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="es"
      className={`${fraunces.variable} ${geistSans.variable} ${geistMono.variable}`}
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
