import { env } from "@/env";

// Liveness must not restart a healthy process because its database is unavailable.
// /healthz/ready remains the database readiness check used before activation.
export async function GET(): Promise<Response> {
  return Response.json(
    { ok: true, build: env.NEXT_PUBLIC_BUILD_ID },
    { headers: { "Cache-Control": "no-store" } },
  );
}
