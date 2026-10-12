import { PlainNotFound } from "@/components/shell/PlainNotFound";

/**
 * A published Site or Marketplace listing that is private, hidden, not set up or unknown, a page that does not exist, a path that names
 * nothing: all the same plain page, for a visitor and for someone signed in alike. It does not ask who is signed in (so it reads no session
 * and mounts no workspace), which is what keeps "not found" from depending on, or carrying, anyone's workspace.
 */
export default function PublicNotFound() {
  return <PlainNotFound />;
}
