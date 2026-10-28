import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "../../src/ui/MarkdownView";

describe("MarkdownView", () => {
  it("never loads pictures or runs HTML from a document", async () => {
    const { container } = render(
      <MarkdownView
        markdown={[
          "# Title",
          "",
          "![Tracking pixel](https://example.com/pixel.png)",
          "",
          '<img src="https://example.com/a.png" onerror="alert(1)"><script>alert(2)</script>',
          "",
          "[A link](https://example.com)",
        ].join("\n")}
      />,
    );
    await waitFor(() => expect(container.querySelector(".prose")).not.toBeNull());
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("[Figure: Tracking pixel]")).toBeInTheDocument();
    expect(container.textContent).toContain('<img src="https://example.com/a.png"');
    expect(screen.getByRole("link", { name: "A link" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });
});
