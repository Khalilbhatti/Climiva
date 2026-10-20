"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import type { IssuedReviewLink } from "@/data/reviews";
import { formatDate } from "@/lib/format";

/**
 * A review link, shown to the business ONCE: the moment it is made (a new request, or a new link for a request whose link was lost or ran out). The secret
 * in it is never stored (only its hash is), so it cannot be shown again; a lost link is replaced with a new one. Climvia does not send it: the business
 * copies it and gives it to the customer.
 */
export function IssuedLinkView({ link }: { link: IssuedReviewLink }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast("Review link copied.");
    } catch {
      // Clipboard access can be refused (an insecure page, a browser setting). The link is selected in the field for the person to copy by hand.
      toast("Couldn't copy automatically. Select the link and copy it.");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        Copy this link and send it to your customer yourself. Climvia does not send it for you. It works once, and it stops working on{" "}
        <strong className="font-semibold">{formatDate(link.expires.slice(0, 10))}</strong>.
      </p>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input label="Review link" readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} />
        </div>
        <Button type="button" variant="secondary" onClick={copy}>
          <Copy aria-hidden className="size-4" />
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p className="text-xs text-ink-muted">This is the only time the link is shown. If it is lost, make a new one from the request: the old one then stops working.</p>
    </div>
  );
}
