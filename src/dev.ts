type DevProcessConfig = {
  name: string;
  command: string[];
};

export {};

type ManagedDevProcess = {
  name: string;
  subprocess: ReturnType<typeof Bun.spawn>;
};

const bunExecutable = process.execPath;
const apiArgs = process.argv.slice(2);
const devProcesses: DevProcessConfig[] = [
  {
    name: "api",
    command: [bunExecutable, "--watch", "src/main.ts", ...apiArgs],
  },
  {
    name: "whatsapp-worker",
    command: [bunExecutable, "--watch", "src/workers/whatsapp.main.ts"],
  },
];

const managedProcesses: ManagedDevProcess[] = [];
let isShuttingDown = false;

function startDevProcess(config: DevProcessConfig): void {
  console.info(`[dev] Starting ${config.name}: ${config.command.join(" ")}`);

  const subprocess = Bun.spawn(config.command, {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  managedProcesses.push({
    name: config.name,
    subprocess,
  });

  void subprocess.exited.then((exitCode) => {
    if (isShuttingDown) {
      return;
    }

    console.error(
      `[dev] ${config.name} exited with code ${exitCode}. Stopping dev services.`,
    );
    void shutdown(exitCode === 0 ? 1 : exitCode);
  });
}

async function shutdown(exitCode: number): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  for (const { name, subprocess } of managedProcesses) {
    if (subprocess.exitCode !== null) {
      continue;
    }

    console.info(`[dev] Stopping ${name}`);
    subprocess.kill();
  }

  await Promise.allSettled(
    managedProcesses.map(({ subprocess }) => subprocess.exited),
  );

  process.exit(exitCode);
}

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

for (const devProcess of devProcesses) {
  startDevProcess(devProcess);
}

await new Promise(() => {});
