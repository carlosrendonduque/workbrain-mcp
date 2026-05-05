import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  const h = await headers();
  const userId = h.get("x-user-id");
  return NextResponse.json({
    ok: true,
    data: {
      userId,
      message: "WorkBrain API is alive.",
    },
  });
}
