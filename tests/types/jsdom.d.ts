declare module "jsdom" {
  export interface JSDOMOptions {
    runScripts?: "dangerously" | "outside-only";
    url?: string;
  }

  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    readonly window: Window & typeof globalThis & { close(): void };
  }
}
