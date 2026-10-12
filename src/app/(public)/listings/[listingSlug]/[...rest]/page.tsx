import { notFound } from "next/navigation";

/** An address under the public prefix that names no Site or listing page: the plain "not found" of `(public)`, for a visitor and for anyone signed in alike. */
export default function PublicAddressThatNamesNothing(): never {
  notFound();
}
