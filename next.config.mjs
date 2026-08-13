import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.js");

const nextConfig = {
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
