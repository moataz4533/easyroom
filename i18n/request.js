import { getRequestConfig } from "next-intl/server";
import { headers } from "next/headers";

export default getRequestConfig(async () => {
  const locale = (await headers()).get("x-easyroom-locale") === "en" ? "en" : "ar";
  return {
    locale,
    timeZone: "Africa/Cairo",
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
