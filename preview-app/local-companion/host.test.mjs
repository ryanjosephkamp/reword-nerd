import { test } from "node:test";
import assert from "node:assert/strict";
import { assertThread, hostOverrides } from "./host.mjs";
const valid = {
  model: "m",
  modelProvider: "openai",
  reasoningEffort: "medium",
  approvalPolicy: "never",
  sandbox: { type: "readOnly", networkAccess: false },
  instructionSources: [],
  runtimeWorkspaceRoots: [],
  thread: { path: null, ephemeral: true },
};
test("host boundary rejects model/effort fallback, write/network, inherited instructions and persistence", () => {
  assertThread(valid, "m");
  for (const change of [
    { model: "other" },
    { reasoningEffort: "high" },
    { modelProvider: "other" },
    { approvalPolicy: "on-request" },
    { sandbox: { type: "workspaceWrite", networkAccess: false } },
    { sandbox: { type: "readOnly", networkAccess: true } },
    { instructionSources: ["AGENTS.md"] },
    { runtimeWorkspaceRoots: ["/"] },
    { thread: { path: "/saved", ephemeral: false } },
  ])
    assert.throws(() => assertThread({ ...valid, ...change }, "m"));
});
test("supported suppression controls remain enabled in every launch", () => {
  const flags = hostOverrides("/owned");
  for (const required of [
    "agents.enabled=false",
    "orchestrator.skills.enabled=false",
    "orchestrator.mcp.enabled=false",
    "skills.include_instructions=false",
    "features.code_mode_host=false",
    "features.shell_tool=false",
  ])
    assert.ok(flags.includes(required));
  assert.ok(!flags.some((x) => x.startsWith("sqlite_home=")));
});
