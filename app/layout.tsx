import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppSidebar from "@/components/AppSidebar";
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
  title: "Dividend Tracker",
  description: "Trading212 dividend tracker, portfolio overview and financial-freedom forecast",
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
      {/* The rail is fixed, so content is offset by its width from lg upward. */}
      <body className="flex min-h-full flex-col lg:pl-[var(--sidebar-width)]">
        <AppSidebar />
        {children}
      </body>
    </html>
  );
}
