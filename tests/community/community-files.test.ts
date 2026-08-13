import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const root = process.cwd();

async function readIssueForm(filename: string): Promise<Record<string, unknown>> {
  const path = resolve(root, ".github", "ISSUE_TEMPLATE", filename);
  const program = "const yaml=require('js-yaml'); const fs=require('node:fs'); process.stdout.write(JSON.stringify(yaml.load(fs.readFileSync(process.argv[1], 'utf8'))));";
  const { stdout } = await execFile(process.execPath, ["-e", program, path]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe("community contribution surfaces", () => {
  it("parses public bug and feature forms that require privacy-safe, pre-searched reports without uploads", async () => {
    // This catches a broken GitHub form or a regression that allows source-bearing public reports.
    for (const [filename, expectedLabel] of [["bug_report.yml", "bug"], ["feature_request.yml", "enhancement"]] as const) {
      const form = await readIssueForm(filename);
      const body = form.body as Array<Record<string, unknown>>;
      const serialized = JSON.stringify(form).toLowerCase();

      expect(form.name).toBeTruthy();
      expect(form.labels).toEqual([expectedLabel]);
      expect(body.some((field) => field.type === "input" || field.type === "textarea")).toBe(true);
      expect(body.some((field) => field.type === "markdown" && JSON.stringify(field).toLowerCase().includes("public"))).toBe(true);
      expect(body.some((field) => field.type === "checkboxes" && JSON.stringify(field).toLowerCase().includes("search"))).toBe(true);
      expect(body.some((field) => field.type === "checkboxes" && JSON.stringify(field).toLowerCase().includes("synthetic"))).toBe(true);
      expect(serialized).toMatch(/source document|package|prompt|credential|confidential/iu);
      expect(serialized).not.toMatch(/\bfile\b[^\n]*upload|upload[^\n]*\bfile\b/iu);
    }

    const config = await readIssueForm("config.yml");
    expect(config.blank_issues_enabled).toBe(false);
  });

  it("keeps private security reporting and contribution templates linked to the existing community standards", async () => {
    // This catches public-security guidance or templates that lose their Code of Conduct and contribution links.
    const files = await Promise.all([
      readFile(join(root, "SECURITY.md"), "utf8"),
      readFile(join(root, ".github", "pull_request_template.md"), "utf8"),
      readFile(join(root, "CONTRIBUTING.md"), "utf8"),
      readFile(join(root, "CODE_OF_CONDUCT.md"), "utf8"),
      readFile(join(root, ".github", "FUNDING.yml"), "utf8"),
    ]);
    const [security, pullRequest, contributing, conduct, funding] = files;

    expect(security).toMatch(/private vulnerability reporting|security advisories|synthetic/iu);
    expect(security).toMatch(/do not.*(?:source|package|prompt|credential|confidential)/iu);
    expect(pullRequest).toMatch(/CONTRIBUTING\.md/iu);
    expect(pullRequest).toMatch(/CODE_OF_CONDUCT\.md/iu);
    expect(contributing).toMatch(/SECURITY\.md/iu);
    expect(conduct).toMatch(/CONTRIBUTING\.md/iu);
    expect(funding).toMatch(/github:\s*ryanjosephkamp/iu);
  });
});
