import { DEFAULT_TIME_ZONE, formatDateWithWeekday } from "@nexus/core";
import { z } from "zod";
import { cleaningCalculationTool } from "./cleaning";
import { defineTool } from "./tools";

/** Current date and time. Agents use it for deadlines and appointments. */
export const currentTimeTool = defineTool({
  name: "aktuelle_zeit",
  description:
    "Liefert das aktuelle Datum, die Uhrzeit und den Wochentag in Wien. Verwenden Sie das Werkzeug, wenn Sie Fristen oder Termine berechnen und der <kontext>-Block nicht genügt.",
  risk: "read",
  input: z.object({}),
  run: async (_input, ctx) => {
    const time = new Intl.DateTimeFormat("de-AT", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: DEFAULT_TIME_ZONE,
    }).format(ctx.now);
    return {
      datum: formatDateWithWeekday(ctx.now),
      uhrzeit: time,
      zeitzone: DEFAULT_TIME_ZONE,
      iso: ctx.now.toISOString(),
    };
  },
});

/**
 * Safe arithmetic: + - * / % ^ and parentheses, decimal numbers with "." or ",".
 * A small recursive-descent parser – no eval, no access to anything else.
 */
export function evaluateExpression(expression: string): number {
  const source = expression.replace(/,/g, ".").replace(/\s+/g, "");
  if (source.length === 0 || source.length > 500) throw new Error("Ausdruck leer oder zu lang.");
  let pos = 0;

  const peek = () => source[pos];
  const expect = (char: string) => {
    if (source[pos] !== char) throw new Error(`Erwartet "${char}" an Position ${pos + 1}.`);
    pos++;
  };

  function parseNumber(): number {
    const match = /^\d+(\.\d+)?/.exec(source.slice(pos));
    if (!match) throw new Error(`Zahl erwartet an Position ${pos + 1}.`);
    pos += match[0].length;
    return Number(match[0]);
  }
  function parsePrimary(): number {
    const char = peek();
    if (char === "(") {
      pos++;
      const value = parseSum();
      expect(")");
      return value;
    }
    if (char === "-") {
      pos++;
      return -parsePrimary();
    }
    if (char === "+") {
      pos++;
      return parsePrimary();
    }
    return parseNumber();
  }
  function parsePower(): number {
    const base = parsePrimary();
    if (peek() === "^") {
      pos++;
      return base ** parsePower(); // right-associative
    }
    return base;
  }
  function parseProduct(): number {
    let value = parsePower();
    for (let char = peek(); char === "*" || char === "/" || char === "%"; char = peek()) {
      pos++;
      const right = parsePower();
      if ((char === "/" || char === "%") && right === 0) throw new Error("Division durch null.");
      value = char === "*" ? value * right : char === "/" ? value / right : value % right;
    }
    return value;
  }
  function parseSum(): number {
    let value = parseProduct();
    for (let char = peek(); char === "+" || char === "-"; char = peek()) {
      pos++;
      const right = parseProduct();
      value = char === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = parseSum();
  if (pos !== source.length)
    throw new Error(`Unerwartetes Zeichen "${source[pos]}" an Position ${pos + 1}.`);
  if (!Number.isFinite(result)) throw new Error("Das Ergebnis ist keine endliche Zahl.");
  return result;
}

export const calculatorTool = defineTool({
  name: "rechner",
  description:
    "Berechnet einen arithmetischen Ausdruck exakt (z. B. Summen, Prozent, Umsatzsteuer). Erlaubt sind Zahlen, + - * / % ^ und Klammern. Verwenden Sie das Werkzeug für jede Rechnung, statt im Kopf zu rechnen.",
  risk: "read",
  input: z.object({ ausdruck: z.string().describe("Der Ausdruck, z. B. (1200 + 350) * 1,2") }),
  run: async ({ ausdruck }) => {
    const result = evaluateExpression(ausdruck);
    return { ausdruck, ergebnis: Math.round(result * 1e10) / 1e10 };
  },
});

export const BUILTIN_TOOLS = [currentTimeTool, calculatorTool, cleaningCalculationTool];
