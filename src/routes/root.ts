import type { FastifyInstance } from "fastify";

export async function registerRootRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => ({
    name: "wa-commerce-server",
    status: "running",
    docs: {
      health: "/health",
      systemHealth: "/admin/system-health",
    },
  }));
}
