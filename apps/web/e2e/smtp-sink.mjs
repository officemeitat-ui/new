// SMTP sink for end-to-end tests: accepts every e-mail the app sends (invitations, agent
// e-mails) and lists them over HTTP, so tests can read links and check what was sent.
// SMTP on E2E_SMTP_PORT (default 2525), HTTP on E2E_MAIL_API_PORT (default 2526).
import { createServer } from "node:http";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";

const smtpPort = Number(process.env.E2E_SMTP_PORT ?? 2525);
const apiPort = Number(process.env.E2E_MAIL_API_PORT ?? 2526);
/** @type {{ to: string[]; subject: string; text: string; receivedAt: string }[]} */
const messages = [];

const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  logger: false,
  onData(stream, session, callback) {
    simpleParser(stream)
      .then((mail) => {
        messages.push({
          to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()),
          subject: mail.subject ?? "",
          text: mail.text ?? "",
          receivedAt: new Date().toISOString(),
        });
        if (messages.length > 500) messages.shift();
        callback();
      })
      .catch(callback);
  },
});
smtp.listen(smtpPort, "127.0.0.1");

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/health") {
    response.end("ok");
    return;
  }
  if (url.pathname === "/messages") {
    const to = url.searchParams.get("to")?.toLowerCase();
    const list = to ? messages.filter((m) => m.to.includes(to)) : messages;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(list));
    return;
  }
  response.statusCode = 404;
  response.end();
}).listen(apiPort, "127.0.0.1", () => {
  console.log(`smtp sink: smtp ${smtpPort}, api http://localhost:${apiPort}`);
});
