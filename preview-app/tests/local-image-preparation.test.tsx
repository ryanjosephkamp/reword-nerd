import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
import { LocalImagePreparation } from "../src/app/platform/LocalImagePreparation";
import { createInitialImagePortalState } from "../src/image/reducer";
import type { ImageBuiltOutput } from "../src/image/export/contracts";
const mock = vi.hoisted(() => ({
  request: vi.fn(),
  available: true,
  error: false,
}));
vi.mock("../src/app/platform/localClient", () => ({
  localRequest: mock.request,
}));
const state = (hash = "a".repeat(64)) => ({
  ...createInitialImagePortalState(),
  builtOutput: {
    packageSha256: hash,
    packageBytes: new Blob(["synthetic UI fixture"]),
    packageByteCount: 20,
    itemCount: 1,
  } as ImageBuiltOutput,
});
const job = {
  jobId: "offline-ui-fixture",
  packageSha256: "a".repeat(64),
  referenceSha256: "b".repeat(64),
  promptSha256: "c".repeat(64),
  location: "/owned/fixture",
  savedConfiguration: { notes: "<script>window.BAD=true</script>" },
  attempts: [
    {
      ticket: { ticketId: "fixture", attempt: 1, revision: 1 },
      status: "unsupported",
    },
  ],
  artifacts: ["reference.png"],
};
beforeEach(() => {
  mock.request.mockReset();
  mock.available = true;
  mock.error = false;
  mock.request.mockImplementation(async (action: string) => ({
    ok: !mock.error,
    json: async () =>
      mock.error
        ? { error: "<script>window.BAD=true</script>" }
        : action === "imageCapabilities"
          ? {
              kind: mock.available
                ? "reword-local-image-preparation"
                : "unknown",
              session: "d".repeat(64),
              reason: "Execution unavailable",
              location: "/owned/fixture",
            }
          : { job: action === "imagePrepare" ? job : null },
  }));
});
it("renders no connection controls when companion capability is absent", async () => {
  mock.available = false;
  const { container } = render(<LocalImagePreparation imageState={state()} />);
  await waitFor(() => expect(mock.request).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  expect(mock.request).toHaveBeenCalledTimes(1);
});
it("requires explicit confirmation of the exact current package and never sends generation", async () => {
  const first = state();
  const { rerender } = render(<LocalImagePreparation imageState={first} />);
  const button = await screen.findByRole("button", {
    name: "Prepare locally — no generation",
  });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(button).toBeEnabled();
  rerender(<LocalImagePreparation imageState={state("e".repeat(64))} />);
  expect(button).toBeDisabled();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(mock.request.mock.calls.map((c) => c[0])).not.toContain(
    "imagePrepare",
  );
});
it("keeps the completed snapshot separate when source changes and escapes saved configuration", async () => {
  const first = state();
  const { rerender, container } = render(
    <LocalImagePreparation imageState={first} />,
  );
  await screen.findByRole("button", {
    name: "Prepare locally — no generation",
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare locally — no generation" }),
  );
  await screen.findByRole("heading", {
    name: "Prepared locally · execution blocked",
  });
  expect(mock.request).toHaveBeenCalledWith(
    "imagePrepare",
    "d".repeat(64),
    first.builtOutput.packageBytes,
  );
  rerender(<LocalImagePreparation imageState={state("e".repeat(64))} />);
  expect(screen.getByText(/prepared job remains independent/)).toBeVisible();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText(/No image was generated or accepted/)).toBeVisible();
  expect(mock.request.mock.calls.map((c) => c[0])).toEqual([
    "imageCapabilities",
    "imageStatus",
    "imagePrepare",
  ]);
});
it("renders validation failures as inert text without retry", async () => {
  const { container } = render(<LocalImagePreparation imageState={state()} />);
  await screen.findByRole("button", {
    name: "Prepare locally — no generation",
  });
  mock.error = true;
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare locally — no generation" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "<script>window.BAD=true</script>",
  );
  expect(container.querySelector("script")).toBeNull();
  expect(
    mock.request.mock.calls.filter((c) => c[0] === "imagePrepare"),
  ).toHaveLength(1);
});
