import { NextResponse } from "next/server";
import { Keypair } from "@stellar/stellar-sdk";

const FRIEND_BOT_URL = "https://friendbot.stellar.org";

export async function GET() {
  try {
    const keypair = Keypair.random();

    const response = await fetch(
      `${FRIEND_BOT_URL}?addr=${encodeURIComponent(keypair.publicKey())}`
    );

    if (!response.ok) {
      throw new Error("Friendbot failed to fund recipient account");
    }

    return NextResponse.json({
      success: true,
      publicKey: keypair.publicKey(),
      funded: true,
    });
  } catch (error) {
    console.error("Recipient creation error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to create recipient account",
      },
      { status: 500 }
    );
  }
}