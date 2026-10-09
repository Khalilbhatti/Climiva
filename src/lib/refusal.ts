/**
 * A change the rules refuse, with a message for the person. Thrown from inside a tenant transaction so the whole change rolls
 * back (nothing is half done, and a number taken for it is given back); the server action turns it into a safe answer.
 *
 * Pure: the data layer, the server actions and the specs share it. Never carries a database error.
 */
export class Refusal extends Error {
  constructor(
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "Refusal";
  }
}

export const refuse = (message: string, fields?: Record<string, string>): never => {
  throw new Refusal(message, fields);
};
