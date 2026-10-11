/**
 * Shared response and error handling helpers for API routes.
 */
import { NextResponse } from "next/server";
import { NotSignedIn } from "@/lib/auth";
import { InvalidInput } from "@/lib/amounts";
import { ContractRevert } from "@/lib/chain";

export function jsonResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof InvalidInput) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof NotSignedIn) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof ContractRevert) {
    return NextResponse.json(
      { error: error.message, revert: true, label: error.label },
      { status: 400 },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error("API route error:", error);
  return NextResponse.json({ error: message }, { status: 500 });
}
