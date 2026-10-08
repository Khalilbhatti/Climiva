import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { withAddedService, withUpdatedService } from "../src/components/services/service-state";
import {
  CUSTOMERS,
  describeLastService,
  formatPropertyAddress,
  getCustomerById,
  getEquipmentForCustomer,
  getPrimaryProperty,
  getPropertiesForCustomer,
  getPropertyById,
} from "../src/data/customers";
import {
  BOOKING_METHOD_LABEL,
  SERVICES,
  formatServicePrice,
  getOnlineBookableServices,
  getPublicActiveServices,
  getServiceById,
} from "../src/data/services";

// Pure data/selector tests: no browser needed.

const CANONICAL_SERVICES = [
  ["AC Repair & Diagnostics", "$89 diagnostic fee", "Request appointment"],
  ["Annual Cooling Tune-Up & Maintenance", "$129 fixed price", "Instant booking"],
  ["Heat Pump Diagnostics & Repair", "$99 diagnostic fee", "Request appointment"],
  ["Emergency No-Heat / No-Cool Service", "$149 call fee", "Request appointment"],
  ["Ductless Mini-Split Installation & Estimate", "Free assessment", "Request quote / assessment"],
  ["Furnace Safety Inspection & Tune-Up", "$119 fixed price", "Instant booking"],
] as const;

test.describe("canonical services", () => {
  test("are exactly the six approved services, with approved prices and booking methods", () => {
    expect(SERVICES.map((service) => [service.name, formatServicePrice(service.pricing), BOOKING_METHOD_LABEL[service.bookingMethod]])).toEqual(
      CANONICAL_SERVICES.map((row) => [...row]),
    );
  });

  test("selectors read the same records", () => {
    expect(getServiceById("ac-repair-diagnostics")?.name).toBe("AC Repair & Diagnostics");
    expect(getServiceById("does-not-exist")).toBeUndefined();
    expect(getPublicActiveServices()).toHaveLength(6);
    expect(getOnlineBookableServices()).toHaveLength(6);
  });

  test("public/bookable selectors exclude inactive and internal services", () => {
    const [first, second, third] = SERVICES;
    const list = [{ ...first, active: false }, { ...second, visibility: "internal" as const }, { ...third, visibility: "public-only" as const }];
    expect(getPublicActiveServices(list).map((service) => service.id)).toEqual([third.id]);
    expect(getOnlineBookableServices(list)).toEqual([]);
  });

  test("demo-state helpers never mutate the canonical fixtures", () => {
    const before = JSON.stringify(SERVICES);
    const added = withAddedService(SERVICES, { ...SERVICES[0], id: "demo", name: "Demo" });
    const updated = withUpdatedService(SERVICES, { ...SERVICES[0], name: "Renamed", active: false });

    expect(added).toHaveLength(7);
    expect(updated[0].name).toBe("Renamed");
    expect(SERVICES).toHaveLength(6);
    expect(JSON.stringify(SERVICES)).toBe(before);
  });
});

test.describe("canonical customers", () => {
  test("Sarah Mitchell has the approved contact details and a single Home property at 1402 Kinney Ave", () => {
    const sarah = getCustomerById("sarah-mitchell");
    expect(sarah).toMatchObject({ name: "Sarah Mitchell", phone: "(512) 555-0194", email: "sarah.m@gmail.com" });

    const properties = getPropertiesForCustomer("sarah-mitchell");
    expect(properties).toHaveLength(1);
    expect(properties[0].label).toBe("Home");
    expect(formatPropertyAddress(properties[0])).toBe("1402 Kinney Ave, Austin, TX 78704");
    expect(getPrimaryProperty(sarah!)?.id).toBe(properties[0].id);
    expect(getEquipmentForCustomer("sarah-mitchell")).toHaveLength(2);
  });

  test("every customer's references resolve", () => {
    for (const customer of CUSTOMERS) {
      for (const propertyId of customer.propertyIds) {
        expect(getPropertyById(propertyId)?.customerId, `${customer.name} → ${propertyId}`).toBe(customer.id);
      }
      if (customer.lastService?.serviceId) expect(getServiceById(customer.lastService.serviceId)).toBeDefined();
    }
    // Service names shown for customers come from the service catalog, not copied text.
    expect(describeLastService(getCustomerById("sarah-mitchell")!)).toBe(getServiceById("ac-repair-diagnostics")!.name);
  });
});

test.describe("source guardrails", () => {
  const PROHIBITED = [
    "Comprehensive AC Tune-Up",
    "Thermostat Calibration",
    "Smart Thermostat Integration",
    "Whole-Home Duct Inspection",
    "Full System Replacement",
    "Emergency Commercial Rooftop Diagnostics",
    "Electrical & Air Quality Inspection",
    "1804 South Lamar",
    "Module Foundation Ready",
    "Lifetime value",
    "Churn risk",
    "Lead score",
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(tsx?|css|md)$/.test(entry) ? [path] : [];
    });
  }

  test("no invented services, alternate addresses or prohibited concepts in production source", () => {
    const hits: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const phrase of PROHIBITED) if (text.includes(phrase.toLowerCase())) hits.push(`${file}: ${phrase}`);
    }
    expect(hits).toEqual([]);
  });
});
