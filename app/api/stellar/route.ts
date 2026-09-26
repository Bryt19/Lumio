import { NextResponse } from "next/server";
import { getLatestLedger } from "@/src/lib/stellar";

export async function GET() {
  try {
    const ledger = await getLatestLedger();

    return NextResponse.json({
      success: true,
      ledger: ledger.sequence,
    });
  } catch (error) {
    console.error("Stellar connection error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to connect to Stellar Testnet",
      },
      { status: 500 }
    );
  }
}