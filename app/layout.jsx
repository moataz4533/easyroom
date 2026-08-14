import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { IBM_Plex_Mono, IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import LegacyTranslator from "../components/LegacyTranslator";
import ServiceWorkerManager from "../components/ServiceWorkerManager";
import "./globals.css";

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

const latin = Inter({
  subsets: ["latin"],
  variable: "--font-latin",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export async function generateMetadata() {
  const locale = (await headers()).get("x-easyroom-locale") === "en" ? "en" : "ar";
  return {
    title: { default: "Easyroom", template: "%s · Easyroom" },
    description: locale === "ar" ? "إدارة الغرف والحجوزات" : "Hotel room and booking management",
    manifest: locale === "ar" ? "/manifest-ar.json" : "/manifest-en.json",
    appleWebApp: { capable: true, title: "Easyroom", statusBarStyle: "black-translucent" },
    icons: { icon: "/easyroom-logo.png", apple: "/easyroom-logo.png" },
    // Says the same thing as robots.txt, to the crawlers that read one and
    // not the other. A hotel's back office does not belong in search results.
    robots: { index: false, follow: false, nocache: true },
  };
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B3A46",
};

export default async function RootLayout({ children }) {
  const locale = (await headers()).get("x-easyroom-locale") === "en" ? "en" : "ar";
  const messages = (await import(`../messages/${locale}.json`)).default;

  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body className={`${arabic.variable} ${latin.variable} ${mono.variable}`}>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Africa/Cairo">
          <LegacyTranslator />
          <ServiceWorkerManager />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
