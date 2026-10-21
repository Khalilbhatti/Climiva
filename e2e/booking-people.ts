import { randomBytes } from "node:crypto";

/**
 * A phone number no other test has used. A guest's booking is matched to the business's customer on its email first (drizzle/0031): a phone number is shared by
 * households, so a different email on a known phone is a NEW customer, never the one who has the phone. A test that wants its guest to share nobody's phone brings
 * one of its own, so that what it asserts about that guest cannot depend on another test's.
 */
export const freshPhone = () => `(512) ${100 + (randomBytes(2).readUInt16BE() % 900)}-${1000 + (randomBytes(2).readUInt16BE() % 9000)}`;
