import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Asset Generator",
  description:
    "Generation d'assets graphiques coherents pour jeu video, a partir d'un contexte permanent et d'images de reference.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Laisse la place aux encoches et à la barre de geste sur iPhone.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
