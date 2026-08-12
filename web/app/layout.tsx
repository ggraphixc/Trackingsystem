import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dravex — Lost Phone Tracking & Recovery for Nigeria",
  description:
    "Protect your phone before it's lost. If it's stolen, recover it: GPS tracking, police & carrier IMEI blacklisting facilitation, community sightings, and sustainability impact.",
  keywords: [
    "lost phone Nigeria",
    "stolen phone tracking",
    "IMEI blacklist Nigeria",
    "NCC",
    "phone recovery",
    "device insurance",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
