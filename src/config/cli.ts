function parsePortValue(value: string | undefined, flag: string): number {
  const port = Number(value);

  if (!value || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${flag} must be a port number between 1 and 65535.`);
  }

  return port;
}

export function parsePortArgument(argv: readonly string[] = process.argv): number | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "-p" || argument === "--port") {
      return parsePortValue(argv[index + 1], argument);
    }

    if (argument?.startsWith("--port=")) {
      return parsePortValue(argument.slice("--port=".length), "--port");
    }
  }

  return undefined;
}
