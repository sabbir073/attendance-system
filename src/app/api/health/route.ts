import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Container healthcheck. Verifies the process is up AND the DB is reachable. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({
      ok: true,
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return Response.json(
      { ok: false, status: "degraded", database: "unreachable" },
      { status: 503 },
    );
  }
}
