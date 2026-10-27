export function parseNamedArguments(argv, names) {
  const allowed = new Set(names);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error(`Expected ${names.map((name) => `--${name} VALUE`).join(" ")}`);
    const name = flag.slice(2);
    if (!allowed.has(name)) throw new Error(`Unknown argument: ${flag}`);
    result[name] = value;
  }
  for (const name of names) if (!result[name]) throw new Error(`Missing required argument: --${name}`);
  return result;
}

export async function runCommand(command) {
  try {
    const message = await command();
    if (message !== undefined) process.stdout.write(`${message}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
