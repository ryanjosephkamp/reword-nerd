import { JSDOM } from "jsdom";

function normalizedSelector(selector: string): string {
  return selector.replaceAll(/\s+/gu, "");
}

export function cssRuleProperty(css: string, selector: string, property: string): string | undefined {
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body></body></html>`);
  const sheet = dom.window.document.querySelector("style")?.sheet;
  const expectedSelector = normalizedSelector(selector);
  const rule = Array.from(sheet?.cssRules ?? []).find((candidate) => {
    const styleRule = candidate as CSSRule & { selectorText?: string };
    return styleRule.selectorText !== undefined
      && normalizedSelector(styleRule.selectorText) === expectedSelector;
  }) as (CSSRule & { style?: CSSStyleDeclaration }) | undefined;
  return rule?.style?.getPropertyValue(property).trim() || undefined;
}

export function inlineCssRuleProperty(html: string, selector: string, property: string): string | undefined {
  const dom = new JSDOM(html);
  const css = dom.window.document.querySelector("style")?.textContent;
  return css === null || css === undefined ? undefined : cssRuleProperty(css, selector, property);
}

function relativeLuminance(hex: string): number {
  const channels = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu)?.slice(1);
  if (!channels) throw new Error(`Expected a six-digit hex color, received ${hex}`);
  const linear = channels.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}
