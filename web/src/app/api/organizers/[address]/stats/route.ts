import { NextResponse } from "next/server";

import { arcPublicClient } from "@/lib/arc-public-client";
import { SHOWUP_ABI } from "@/lib/showup-abi";
import {
  parseAttendeeAddress,
  serializeUsdc,
  ShowUpApiError,
} from "@/lib/showup-server";
import { SHOWUP_CONTRACT_ADDRESS } from "@/lib/showup-network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The organizer's public, on-chain settlement record from ShowUpV6. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ address: string }> },
) {
  try {
    const { address } = await context.params;
    const organizer = parseAttendeeAddress(address);

    const stats = await arcPublicClient.readContract({
      address: SHOWUP_CONTRACT_ADDRESS,
      abi: SHOWUP_ABI,
      functionName: "getOrganizerStats",
      args: [organizer],
    });

    return NextResponse.json(
      {
        organizer,
        eventsCreated: stats.eventsCreated.toString(),
        eventsCancelled: stats.eventsCancelled.toString(),
        attendanceConfirmed: stats.attendanceConfirmed.toString(),
        selfCheckIns: stats.selfCheckIns.toString(),
        noShowsSettled: stats.noShowsSettled.toString(),
        paymentDefaults: stats.paymentDefaults.toString(),
        noShowAmountCollected: serializeUsdc(stats.noShowAmountCollected),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    const status = error instanceof ShowUpApiError ? error.status : 500;
    return NextResponse.json(
      { error: "Unable to load the organizer record." },
      { status },
    );
  }
}
