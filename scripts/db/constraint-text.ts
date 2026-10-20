/**
 * A CHECK constraint, written the one way two databases agree on.
 *
 * PostgreSQL prints a stored expression from its tree, and a database that was restored from a dump has a flatter tree than the one the migration made:
 * `((a AND b) AND c)` in the original is `(a AND b AND c)` after a restore. They mean the same and must compare equal. This reads the printed
 * expression, drops parentheses that only group, and flattens a chain of ANDs (or of ORs) into one list, in order; everything else is kept exactly, so
 * a changed constant, operator, column or a swapped AND/OR is still a difference.
 *
 * Pure: a string in, a string out. No `server-only` on purpose (the fingerprint tool and a spec both read it).
 */

type Node = { kind: "and" | "or"; parts: Node[] } | { kind: "leaf"; text: string };

/** Index of the parenthesis that closes the one at `open`, or -1. Quoted text and double-quoted names are skipped. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") {
      index = text.indexOf("'", index + 1);
      while (index !== -1 && text[index + 1] === "'") index = text.indexOf("'", index + 2);
      if (index === -1) return -1;
    } else if (char === '"') {
      index = text.indexOf('"', index + 1);
      if (index === -1) return -1;
    } else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** The pieces of `text` between a top-level (outside every parenthesis and quote) ` AND ` or ` OR `. */
function splitTop(text: string, word: "AND" | "OR"): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") {
      index = text.indexOf("'", index + 1);
      while (index !== -1 && text[index + 1] === "'") index = text.indexOf("'", index + 2);
      if (index === -1) break;
    } else if (char === '"') {
      index = text.indexOf('"', index + 1);
      if (index === -1) break;
    } else if (char === "(") {
      const end = closing(text, index);
      if (end === -1) break;
      index = end;
    } else if (text.startsWith(` ${word} `, index)) {
      parts.push(text.slice(start, index));
      start = index + word.length + 2;
      index = start - 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Remove parentheses that enclose the whole of `text`. */
function unwrap(text: string): string {
  let current = text.trim();
  while (current.startsWith("(") && closing(current, 0) === current.length - 1) current = current.slice(1, -1).trim();
  return current;
}

function parse(text: string): Node {
  const body = unwrap(text);
  for (const [word, kind] of [["OR", "or"], ["AND", "and"]] as const) {
    const parts = splitTop(body, word);
    if (parts.length > 1) {
      const children = parts.map(parse);
      // A chain inside a chain of the same kind is the same chain.
      return { kind, parts: children.flatMap((child) => (child.kind === kind ? child.parts : [child])) };
    }
  }
  return { kind: "leaf", text: body };
}

function print(node: Node): string {
  return node.kind === "leaf" ? node.text : `${node.kind.toUpperCase()}[${node.parts.map(print).join(" | ")}]`;
}

/** The definition `pg_get_constraintdef` printed, with a CHECK's expression canonicalized and any other kind of constraint only tidied. */
export function canonicalConstraint(definition: string): string {
  const text = definition.replace(/\s+/g, " ").trim();
  if (!text.startsWith("CHECK (")) return text;
  const open = text.indexOf("(");
  const end = closing(text, open);
  if (end === -1) return text;
  return `CHECK ${print(parse(text.slice(open, end + 1)))}${text.slice(end + 1)}`;
}
