import { expect, test, type Page } from "@playwright/test";

function trackRuntime(page: Page, baseURL: string) {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  const origin = new URL(baseURL).origin;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^https?:$/u.test(url.protocol) && url.origin !== origin)
      externalRequests.push(request.url());
  });
  return { errors, externalRequests };
}

async function openWelcome(page: Page) {
  await page.goto("./?view=welcome");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Good ideas deserve better words.",
    }),
  ).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const clippedControls = await page
    .locator("a, button")
    .evaluateAll((controls) =>
      controls.flatMap((control) => {
        const rectangle = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        if (
          !rectangle.width ||
          !rectangle.height ||
          style.visibility === "hidden" ||
          control.classList.contains("welcome-skip")
        )
          return [];
        return rectangle.left < -1 || rectangle.right > window.innerWidth + 1
          ? [control.textContent?.trim() || control.getAttribute("aria-label")]
          : [];
      }),
    );
  expect(clippedControls).toEqual([]);
}

test("welcome shows three honest writing examples with usable theme and original controls", async ({
  page,
  baseURL,
}) => {
  const runtime = trackRuntime(page, baseURL!);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWelcome(page);
  const examples = page.getByRole("group", {
    name: "Illustrative writing examples",
  });
  await expect(
    examples.getByRole("button", { name: "Clarity", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("We’re considering our options.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Prewritten examples. No model call.", { exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "output/studio/final-welcome-desktop.png",
    animations: "disabled",
  });
  await examples
    .getByRole("button", { name: "Professional", exact: true })
    .click();
  await expect(
    page.getByText(
      "Have you had a chance to review the proposal I sent last week?",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    examples.getByRole("button", { name: "Clarity", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await examples.getByRole("button", { name: "Academic", exact: true }).click();
  await expect(
    page.getByText(
      "The study found an association between reduced phone use before bedtime and improved sleep.",
      { exact: true },
    ),
  ).toBeVisible();
  const original = page.getByText(
    "The study found that people slept better when they spent less time on their phones before bed.",
    { exact: true },
  );
  await page
    .getByRole("button", { name: "Hide original", exact: true })
    .click();
  await expect(original).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show original", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page
    .getByRole("button", { name: "Show original", exact: true })
    .click();
  await expect(original).toBeVisible();
  await page
    .getByRole("button", { name: "Use light appearance", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use dark appearance", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use dark appearance", exact: true })
    .click();
  expect(runtime).toEqual({ errors: [], externalRequests: [] });
});

test("welcome method, privacy, real workspace image, and studio entry work together", async ({
  page,
  baseURL,
}) => {
  const runtime = trackRuntime(page, baseURL!);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWelcome(page);
  await page.getByRole("link", { name: "The method", exact: true }).click();
  await expect(page).toHaveURL(/#welcome-method$/u);
  await expect(
    page.getByRole("heading", {
      name: "A good rewrite doesn’t skip the thinking.",
    }),
  ).toBeInViewport();
  for (const name of ["Decompose", "Rewrite", "Verify", "Final"])
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  await page.getByRole("link", { name: "Your privacy", exact: true }).click();
  await expect(page).toHaveURL(/#welcome-privacy$/u);
  await expect(
    page.getByRole("heading", { name: "Your words. Your browser. Your call." }),
  ).toBeInViewport();
  const workspaceImage = page.getByRole("img", {
    name: "The reword-nerd writing studio showing a source document beside writing brief controls, with documents on the left.",
  });
  await workspaceImage.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      workspaceImage.evaluate((image) => ({
        loaded: (image as HTMLImageElement).complete,
        width: (image as HTMLImageElement).naturalWidth,
        height: (image as HTMLImageElement).naturalHeight,
      })),
    )
    .toEqual({ loaded: true, width: 1440, height: 900 });
  await expect(workspaceImage).toHaveAttribute(
    "src",
    /\/studio\/workspace-preview\.png$/u,
  );
  await page.screenshot({
    path: "output/studio/final-welcome-page.png",
    fullPage: true,
    animations: "disabled",
  });
  for (const name of [
    "Open studio",
    "Open the writing studio",
    "Take a look around",
    "Make yourself at home",
  ])
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute(
      "href",
      "./",
    );
  await page.getByRole("link", { name: "Open studio", exact: true }).click();
  await expect(
    page.getByRole("main", { name: "reword-nerd writing studio" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Build package", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Prompt workspace", exact: true }),
  ).toBeVisible();
  expect(runtime).toEqual({ errors: [], externalRequests: [] });
});

test("mobile welcome keeps its examples, navigation, and calls to action within reach", async ({
  page,
  baseURL,
}) => {
  const runtime = trackRuntime(page, baseURL!);
  await page.setViewportSize({ width: 390, height: 844 });
  await openWelcome(page);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "output/studio/final-welcome-mobile.png",
    animations: "disabled",
  });
  const examples = page.getByRole("group", {
    name: "Illustrative writing examples",
  });
  await examples
    .getByRole("button", { name: "Professional", exact: true })
    .click();
  await expect(
    page.getByText(
      "Have you had a chance to review the proposal I sent last week?",
      { exact: true },
    ),
  ).toBeVisible();
  await examples.getByRole("button", { name: "Academic", exact: true }).click();
  await expect(
    examples.getByRole("button", { name: "Academic", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("link", { name: "There’s a method to the meaning", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A good rewrite doesn’t skip the thinking.",
    }),
  ).toBeInViewport();
  await page
    .getByRole("heading", { name: "Your words. Your browser. Your call." })
    .scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await page
    .getByRole("link", { name: "Make yourself at home", exact: true })
    .click();
  await expect(
    page.getByRole("main", { name: "reword-nerd writing studio" }),
  ).toBeVisible();
  expect(runtime).toEqual({ errors: [], externalRequests: [] });
});

test("keyboard skip enters the studio and the classic route remains available", async ({
  page,
  baseURL,
}) => {
  const runtime = trackRuntime(page, baseURL!);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWelcome(page);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#welcome-content$/u);
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Open the writing studio", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("main", { name: "reword-nerd writing studio" }),
  ).toBeVisible();
  await page.goto("./?workbench=classic");
  await expect(
    page.getByRole("main", { name: "reword_nerd workbench" }),
  ).toBeVisible();
  expect(runtime).toEqual({ errors: [], externalRequests: [] });
});
