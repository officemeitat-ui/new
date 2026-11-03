// Minimal stand-in for the Claude Messages API (streaming only), for end-to-end tests.
// The real SDK talks to it via ANTHROPIC_BASE_URL – production code contains no fakes.
//
//   "Berechne …"           → calls the tool "rechner", then answers with its result
//   "… E-Mail an x@y …"    → calls "email_senden" (if the agent has it), then reports the outcome
//   "Laut Wissen: …"       → calls "wissen_suchen" (if the agent has it), then cites the first hit
//   "Welche Geräte …"      → calls "geraete_suchen" (only problems), then lists the devices
//   "Sperre <Gerät>"       → searches the device, calls "geraet_sperren", then reports
//   anything else          → streams a greeting that quotes the message
import { createServer } from "node:http";

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 4010);
// Realistic latency, so the browser is subscribed while the run is still streaming.
const latencyMs = Number(process.env.MOCK_ANTHROPIC_LATENCY_MS ?? 1500);
const chunkDelayMs = Number(process.env.MOCK_ANTHROPIC_CHUNK_DELAY_MS ?? 40);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let counter = 0;

function sse(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
}

function lastUserText(messages) {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return "";
  const blocks =
    typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
  return blocks
    .filter((b) => b.type === "text" && !b.text.startsWith("<kontext>"))
    .map((b) => b.text)
    .join(" ");
}

/** The person's latest question (the last user message with text, not a tool result). */
function currentQuestion(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    const text = blocks
      .filter((b) => b.type === "text" && !b.text.startsWith("<kontext>"))
      .map((b) => b.text)
      .join(" ");
    if (text) return text;
  }
  return "";
}

const toolUse = (name, input) => ({
  type: "tool_use",
  id: `toolu_mock_${counter + 1}`,
  name,
  input,
});

async function streamMessage(res, model, blocks, stopReason) {
  const id = `msg_mock_${++counter}`;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  sse(res, "message_start", {
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 812,
        output_tokens: 1,
        cache_read_input_tokens: counter > 1 ? 2048 : 0,
        cache_creation_input_tokens: counter > 1 ? 0 : 2048,
      },
    },
  });
  await sleep(latencyMs);
  for (const [index, block] of blocks.entries()) {
    if (block.type === "text") {
      sse(res, "content_block_start", { index, content_block: { type: "text", text: "" } });
      for (const piece of block.text.match(/.{1,12}/gs) ?? []) {
        sse(res, "content_block_delta", { index, delta: { type: "text_delta", text: piece } });
        await sleep(chunkDelayMs);
      }
    } else {
      sse(res, "content_block_start", {
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      sse(res, "content_block_delta", {
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
    }
    sse(res, "content_block_stop", { index });
  }
  sse(res, "message_delta", {
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 64 },
  });
  sse(res, "message_stop", {});
  res.end();
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return res.end("ok");
  if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
    res.writeHead(404).end();
    return;
  }
  // SDK 1.x sends "Authorization: Bearer <key>"; older SDKs send "x-api-key".
  if (!req.headers["x-api-key"] && !req.headers.authorization?.startsWith("Bearer ")) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        type: "error",
        error: { type: "authentication_error", message: "missing key" },
      }),
    );
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const request = JSON.parse(body);
    const last = request.messages.at(-1);
    const toolResult = Array.isArray(last?.content)
      ? last.content.find((b) => b.type === "tool_result")
      : null;
    const previous = request.messages.at(-2);
    const calledTool = Array.isArray(previous?.content)
      ? previous.content.find((b) => b.type === "tool_use")?.name
      : undefined;
    if (toolResult && calledTool === "geraete_suchen") {
      const result = JSON.parse(toolResult.content);
      const lock = /^sperre\s+(.+)$/i.exec(currentQuestion(request.messages).trim());
      if (lock && result.geraete?.length) {
        const device = result.geraete[0];
        return void streamMessage(
          res,
          request.model,
          [toolUse("geraet_sperren", { geraet_id: device.geraet_id, geraet_name: device.name })],
          "tool_use",
        );
      }
      const answer = result.geraete?.length
        ? `Handlungsbedarf bei: ${result.geraete.map((d) => `${d.name} (${d.probleme.join(", ")})`).join("; ")}.`
        : "Alle Geräte sind in Ordnung.";
      return void streamMessage(res, request.model, [{ type: "text", text: answer }], "end_turn");
    }
    if (toolResult && calledTool === "geraet_sperren") {
      const answer = toolResult.is_error
        ? `Das Gerät wurde nicht gesperrt. ${toolResult.content}`
        : `Das Gerät ${JSON.parse(toolResult.content).geraet} ist gesperrt.`;
      return void streamMessage(res, request.model, [{ type: "text", text: answer }], "end_turn");
    }
    if (toolResult && calledTool === "wissen_suchen") {
      const { treffer } = JSON.parse(toolResult.content);
      const answer = treffer.length
        ? `${treffer[0].text} [${treffer[0].quelle}]`
        : "Dazu habe ich in den Dokumenten nichts gefunden.";
      return void streamMessage(res, request.model, [{ type: "text", text: answer }], "end_turn");
    }
    if (toolResult && calledTool === "email_senden") {
      const answer = toolResult.is_error
        ? `Verstanden, ich sende die E-Mail nicht. ${toolResult.content}`
        : `Die E-Mail an ${JSON.parse(toolResult.content).an.join(", ")} ist versendet.`;
      return void streamMessage(res, request.model, [{ type: "text", text: answer }], "end_turn");
    }
    if (toolResult) {
      const { ergebnis } = JSON.parse(toolResult.content);
      const amount = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2 }).format(ergebnis);
      return void streamMessage(
        res,
        request.model,
        [{ type: "text", text: `Die Umsatzsteuer beträgt **${amount} €**.` }],
        "end_turn",
      );
    }
    const text = lastUserText(request.messages);
    const recipient = /E-Mail an ([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/i.exec(text)?.[1];
    const canMail = request.tools?.some((tool) => tool.name === "email_senden");
    const hasTool = (name) => request.tools?.some((tool) => tool.name === name);
    if (/^welche geräte/i.test(text.trim()) && hasTool("geraete_suchen")) {
      return void streamMessage(
        res,
        request.model,
        [toolUse("geraete_suchen", { suche: "", nur_probleme: true })],
        "tool_use",
      );
    }
    const lockTarget = /^sperre\s+(.+)$/i.exec(text.trim())?.[1];
    if (lockTarget && hasTool("geraete_suchen") && hasTool("geraet_sperren")) {
      return void streamMessage(
        res,
        request.model,
        [toolUse("geraete_suchen", { suche: lockTarget, nur_probleme: false })],
        "tool_use",
      );
    }
    const knowledgeQuery = /^laut wissen:\s*(.+)$/i.exec(text.trim())?.[1];
    if (knowledgeQuery && request.tools?.some((tool) => tool.name === "wissen_suchen")) {
      return void streamMessage(
        res,
        request.model,
        [
          {
            type: "tool_use",
            id: `toolu_mock_${counter + 1}`,
            name: "wissen_suchen",
            input: { anfrage: knowledgeQuery },
          },
        ],
        "tool_use",
      );
    }
    if (recipient && canMail) {
      return void streamMessage(
        res,
        request.model,
        [
          { type: "text", text: "Ich bereite die E-Mail vor." },
          {
            type: "tool_use",
            id: `toolu_mock_${counter + 1}`,
            name: "email_senden",
            input: {
              an: [recipient],
              betreff: "Terminbestätigung",
              text: "Sehr geehrte Damen und Herren,\n\nwir bestätigen Ihren Termin am Dienstag um 9 Uhr.\n\nMit freundlichen Grüßen",
            },
          },
        ],
        "tool_use",
      );
    }
    if (/berechne/i.test(text)) {
      return void streamMessage(
        res,
        request.model,
        [
          {
            type: "tool_use",
            id: `toolu_mock_${counter + 1}`,
            name: "rechner",
            input: { ausdruck: "3480 * 0,2" },
          },
        ],
        "tool_use",
      );
    }
    return void streamMessage(
      res,
      request.model,
      [{ type: "text", text: `Grüß Gott! Sie schrieben: „${text}“` }],
      "end_turn",
    );
  });
}).listen(port, () => console.warn(`mock Anthropic API on http://localhost:${port}`));
