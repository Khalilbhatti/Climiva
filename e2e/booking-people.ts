import { randomBytes } from "node:crypto";

/**
 * A phone number no other test has used. A guest's booking is matched to the business's customer on its email AND its phone (drizzle/0030), so a test that
 * stands for ANOTHER person has to bring a phone of their own: the same phone with a new email is, by the rule, the customer who already has it.
 */
export const freshPhone = () => `(512) ${100 + (randomBytes(2).readUInt16BE() % 900)}-${1000 + (randomBytes(2).readUInt16BE() % 9000)}`;
