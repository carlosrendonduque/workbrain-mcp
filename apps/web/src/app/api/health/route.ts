import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { callerFromHeaders } from "@/lib/caller";

export async function GET(): Promise<NextResponse> {
  const h = await headers();
  const caller = callerFromHeaders(h);
  const userId = caller?.userId ?? null;
  return NextResponse.json({
    ok: true,
    data: {
      userId,
      message: "WorkBrain API is alive.",
    },
  });
}
