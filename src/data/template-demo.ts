import type { HoursRow } from "@/lib/settings-state";
import type { Service } from "./services";
import type { BusinessInfo } from "./settings";

/**
 * The demonstration business a Template is previewed with, in the Template Gallery.
 *
 * A Template is a layout and some words; the business's name, phone, hours and Services come from the organization when it is applied.
 * To show what a Template looks like before it is applied, it is drawn with this: a clearly made-up business, owned by the application,
 * the same for everyone. It is NOT read from any organization (not the one looking at the Gallery, not another) and nothing in it is
 * private: the phone number is in the range reserved for fiction, the address is "Anytown, ST", and the email is on example.com.
 *
 * Nothing here is stored. Choosing a Template copies none of it: the new Draft is drawn from the business's own record.
 */
export const DEMO_BUSINESS: BusinessInfo = {
  name: "Sample HVAC Company",
  phone: "(555) 010-0100",
  email: "hello@example.com",
  address: { street: "100 Example Street", city: "Anytown", state: "ST", postalCode: "00000" },
};

export const DEMO_HOURS: readonly HoursRow[] = [
  { days: "Mon – Fri", hours: "8:00 AM – 5:00 PM" },
  { days: "Saturday", hours: "9:00 AM – 1:00 PM" },
  { days: "Sunday", hours: "Closed" },
];

type DemoService = Pick<Service, "id" | "name" | "category" | "description" | "durationMinutes" | "pricing" | "bookingMethod">;

const SERVICES: readonly DemoService[] = [
  {
    id: "ac-repair",
    name: "AC repair",
    category: "Cooling",
    description: "Find out why your air conditioner is not cooling, and get a clear plan for the repair.",
    durationMinutes: 90,
    pricing: { model: "diagnostic-fee", amount: 89, label: "diagnostic fee" },
    bookingMethod: "request-appointment",
  },
  {
    id: "heating-repair",
    name: "Heating repair",
    category: "Heating",
    description: "Get a furnace or heating system that is not keeping up checked and repaired.",
    durationMinutes: 90,
    pricing: { model: "diagnostic-fee", amount: 89, label: "diagnostic fee" },
    bookingMethod: "request-appointment",
  },
  {
    id: "seasonal-tune-up",
    name: "Seasonal tune-up",
    category: "Maintenance",
    description: "A maintenance visit before the heating or cooling season, with a checklist you can keep.",
    durationMinutes: 60,
    pricing: { model: "fixed-price", amount: 129 },
    bookingMethod: "instant",
  },
  {
    id: "heat-pump-service",
    name: "Heat pump service",
    category: "Heat pumps",
    description: "Service and checks for heat pumps that heat and cool your home.",
    durationMinutes: 75,
    pricing: { model: "fixed-price", amount: 149 },
    bookingMethod: "request-appointment",
  },
  {
    id: "mini-split-estimate",
    name: "Ductless mini-split estimate",
    category: "Cooling",
    description: "An in-home assessment and a written estimate for a ductless mini-split system.",
    durationMinutes: 45,
    pricing: { model: "free-assessment" },
    bookingMethod: "request-quote",
  },
  {
    id: "emergency-service",
    name: "Emergency service",
    category: "Emergency",
    description: "Request urgent help when your heating or cooling stops working.",
    durationMinutes: 90,
    pricing: { model: "diagnostic-fee", amount: 149, label: "call fee" },
    bookingMethod: "request-appointment",
  },
];

/** The demonstration Services, in the full shape the website renderer expects. All are public and bookable online. */
export const DEMO_SERVICES: readonly Service[] = SERVICES.map((service, index) => ({
  ...service,
  audience: ["residential"],
  visibility: "public-booking",
  active: true,
  displayOrder: index + 1,
  intake: [],
}));
