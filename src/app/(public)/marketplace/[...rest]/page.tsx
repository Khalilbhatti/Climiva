import { notFound } from "next/navigation";

/** An address under /marketplace that is not the index or one of its Service and place pages: the plain "not found" of `(public)`. */
export default function MarketplaceAddressThatNamesNothing(): never {
  notFound();
}
