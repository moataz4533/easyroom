import "./globals.css";

export const metadata = {
  title: "Easyroom",
  description: "إدارة الغرف والحجوزات",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Easyroom", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B3A46",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
