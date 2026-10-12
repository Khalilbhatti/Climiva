import { notFound } from "next/navigation";

/** Every address that matches no other route is "not found": this page exists only so that answer is given by `(unmatched)/not-found.tsx`. */
export default function UnmatchedAddress(): never {
  notFound();
}
