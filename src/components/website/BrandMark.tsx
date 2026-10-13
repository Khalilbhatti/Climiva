import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/format";

/**
 * The business's mark on a customer-facing page (a website's header, the Marketplace listing): its logo when it has one, otherwise its initials in a
 * coloured tile. `tile` shapes the initials (size, corner, type) and `image` shapes the logo (its height; the width follows the picture, up to a
 * limit), so each Template and frame keeps its own proportions.
 *
 * The logo is the business's own, drawn from `/assets/<id>` (src/lib/asset-rules) as it is when the page is drawn: it is not copied into the Site,
 * so a new logo shows without a Publish and a Template change does not touch it. It is decorative (the business's name is written beside it), so
 * it has no alt text of its own. Not a Client Component, so the Marketplace listing and the website draw it on the server too.
 */
export function BrandMark({ name, logo, tile, image }: { name: string; logo: { src: string } | null; tile: string; image: string }) {
  if (logo) {
    return (
      // The business's stored logo, already normalized and bounded by the server, so there is nothing for next/image to optimise.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo.src} alt="" data-site-logo="" className={cn("w-auto shrink-0 object-contain", image)} />
    );
  }
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center bg-primary text-white", tile)}>
      {getInitials(name)}
    </span>
  );
}
