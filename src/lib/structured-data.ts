/**
 * Structured data (schema.org, as JSON-LD) for the pages Climvia lets a search engine index.
 *
 * Only what is true and public is ever said. The landing says what Climvia is and that its Marketplace can be searched; a provider's profile says what the
 * provider chose to show on it, and a rating only when the provider has at least one review that its customer made public and the platform has not hidden
 * (the same rule, `app_review_is_public`, that decides the number a visitor sees). Nothing is invented: no price, no service area it has not listed, no
 * opening hours, no rating without reviews, no "best" or "top".
 *
 * Every address is built from the platform's own configured origin, never from a request, and the script is written so that no value can close the tag.
 */

type Json = Record<string, unknown>;

/** JSON that is safe inside a `<script>`: `<` becomes an escape, so a business name cannot end the element, and U+2028/2029 cannot end a line. */
export function jsonLd(data: Json): string {
  const lineSeparator = new RegExp(String.fromCharCode(0x2028), "g");
  const paragraphSeparator = new RegExp(String.fromCharCode(0x2029), "g");
  const escape = (code: string) => String.fromCharCode(92) + "u" + code;
  return JSON.stringify(data).replace(/</g, escape("003c")).replace(lineSeparator, escape("2028")).replace(paragraphSeparator, escape("2029"));
}

/** The landing: the organization behind it, and the Marketplace search a visitor can use. Null without a configured origin (it has no address to give). */
export function landingStructuredData(origin: string | null): Json | null {
  if (!origin) return null;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${origin}/#organization`, name: "Climvia", url: `${origin}/` },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: `${origin}/`,
        name: "Climvia",
        publisher: { "@id": `${origin}/#organization` },
        potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: `${origin}/marketplace?q={search_term_string}` }, "query-input": "required name=search_term_string" },
      },
    ],
  };
}

export type ProviderStructuredInput = {
  slug: string;
  name: string;
  description: string;
  phone: string | null;
  address: { street: string | null; city: string | null; state: string | null; postalCode: string | null } | null;
  rating: { average: number; count: number } | null;
};

/** A provider's profile: the business, as the profile shows it. */
export function providerStructuredData(origin: string | null, provider: ProviderStructuredInput): Json | null {
  if (!origin) return null;
  const data: Json = {
    "@context": "https://schema.org",
    "@type": "HVACBusiness",
    "@id": `${origin}/listings/${provider.slug}#business`,
    name: provider.name,
    url: `${origin}/listings/${provider.slug}`,
  };
  if (provider.description) data.description = provider.description;
  if (provider.phone) data.telephone = provider.phone;
  const address = provider.address;
  if (address && (address.street || address.city || address.state || address.postalCode)) {
    data.address = {
      "@type": "PostalAddress",
      ...(address.street ? { streetAddress: address.street } : {}),
      ...(address.city ? { addressLocality: address.city } : {}),
      ...(address.state ? { addressRegion: address.state } : {}),
      ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    };
  }
  if (provider.rating && provider.rating.count > 0) {
    data.aggregateRating = { "@type": "AggregateRating", ratingValue: provider.rating.average, reviewCount: provider.rating.count, bestRating: 5, worstRating: 1 };
  }
  return data;
}
