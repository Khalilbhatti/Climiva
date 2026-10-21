"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useOpenedByLink } from "@/components/ui/useOpenedByLink";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { AddCustomerModal } from "./AddCustomerModal";

/**
 * The "Add customer" action for someone who may add a customer (an owner or admin). For anyone else it shows `fallback`, or nothing. The screen only
 * decides what to show: the server checks the role again when the form is sent, and the database a third time.
 */
export function AddCustomerButton({ fallback = null }: { fallback?: ReactNode }) {
  const canAdd = useCan("customers:manage");
  // "+ New → Customer" opens this page with ?new=1: the modal opens, and closing it takes the flag off the address.
  const link = useOpenedByLink("/customers", canAdd);
  const [open, setOpen] = useState(false);
  if (!canAdd) return <>{fallback}</>;
  const close = () => {
    setOpen(false);
    link.done();
  };
  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-[18px]" />
        Add customer
      </Button>
      {(open || link.asked) && <AddCustomerModal onClose={close} />}
    </>
  );
}
