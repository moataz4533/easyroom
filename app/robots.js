/**
 * This is a hotel's back office, not a website. Nobody arrives here by
 * searching, and the only thing indexing it achieves is putting the sign-in
 * page — and the hotel's name on it — in front of people who have no reason
 * to see either.
 *
 * It keeps out crawlers that ask. It is not a security control: everything
 * that actually protects the data is the sign-in and the policies behind it.
 */
export default function robots() {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
