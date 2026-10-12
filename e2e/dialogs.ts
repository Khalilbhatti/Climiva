/** The workspace's main dialogs, each with the address it is reached from and the way it is opened. Shared by the responsive and accessibility specs. */
import type { Page } from "playwright/test";

export type DialogCase = {
  name: string;
  url: string;
  /** Opens the dialog from the page at `url`. Dialogs opened by an address (?new=1) have no opener to return focus to. */
  open: (page: Page) => Promise<void>;
  title: string;
  /** The button that opens it, when it has one: focus must return here on close. */
  opener?: (page: Page) => ReturnType<Page["getByRole"]>;
  /** A dialog that is a long list inside a scrolling body: the window holds the dialog and its close button, not every entry of the list. */
  bodyScrolls?: boolean;
};

export const DIALOGS: DialogCase[] = [
  {
    name: "Add a section",
    url: "/website/builder",
    title: "Add a section",
    bodyScrolls: true,
    opener: (page) => page.getByRole("button", { name: "Add section" }).first(),
    open: (page) => page.getByRole("button", { name: "Add section" }).first().click(),
  },
  {
    name: "Delete a page",
    url: "/website/builder",
    title: "Delete the About page?",
    opener: (page) => page.getByRole("button", { name: "Actions for About page" }),
    open: async (page) => {
      await page.getByRole("button", { name: "Actions for About page" }).click();
      await page.getByRole("menuitem", { name: "Delete page" }).click();
    },
  },
  { name: "Create booking", url: "/bookings?new=1", open: async () => {}, title: "Create booking" },
  { name: "Record payment", url: "/payments?record=1", open: async () => {}, title: "Record payment" },
  { name: "Create maintenance plan", url: "/maintenance-plans?new=1", open: async () => {}, title: "Create maintenance plan" },
  {
    name: "Add new service",
    url: "/services",
    title: "Add new service",
    opener: (page) => page.getByRole("button", { name: "Add service" }).first(),
    open: (page) => page.getByRole("button", { name: "Add service" }).first().click(),
  },
  {
    name: "Add team member",
    url: "/team",
    title: "Add team member",
    opener: (page) => page.getByRole("button", { name: "Add team member" }).first(),
    open: (page) => page.getByRole("button", { name: "Add team member" }).first().click(),
  },
  {
    name: "Request a review",
    url: "/reviews",
    title: "Request a review",
    opener: (page) => page.getByRole("button", { name: "Request review" }).first(),
    open: (page) => page.getByRole("button", { name: "Request review" }).first().click(),
  },
  {
    name: "Create invoice",
    url: "/quotes-invoices/quotes/QT-884",
    title: "Create invoice",
    opener: (page) => page.getByRole("button", { name: "Create invoice" }).first(),
    open: (page) => page.getByRole("button", { name: "Create invoice" }).first().click(),
  },
  {
    name: "Select date range",
    url: "/analytics",
    title: "Select date range",
    opener: (page) => page.getByRole("button", { name: /^Date range/ }).first(),
    open: (page) => page.getByRole("button", { name: /^Date range/ }).first().click(),
  },
];
