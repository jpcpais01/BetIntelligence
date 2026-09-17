"use client";

import { ClobClient, Side, OrderType, AssetType, type OrderResponse } from "@polymarket/clob-client";
import { createWalletClient, http, type Address } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { SignatureTypeValue } from "./wallet";

// Talks to Polymarket's CLOB (clob.polymarket.com) directly from the browser — the decrypted
// private key passed in here lives only in memory for the duration of this call (see
// lib/realMoney/wallet.ts's unlockWallet), is used purely to sign requests locally via viem, and
// is never sent anywhere itself. This app's own server never sees it, never proxies it, and never
// logs it.
const CLOB_HOST = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;

async function buildClient(privateKey: `0x${string}`, signatureType: SignatureTypeValue, funder: Address): Promise<ClobClient> {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
  // L2 API credentials (key/secret/passphrase) are derived deterministically from one signature
  // by this same wallet — createOrDeriveApiKey returns the existing ones if this wallet already
  // has them, or creates them on first use. Nothing about them is stored by this app: they're
  // re-derived fresh every time Real mode unlocks, one extra signature + request rather than a
  // second secret to keep alongside the private key.
  const bootstrapClient = new ClobClient(CLOB_HOST, POLYGON_CHAIN_ID, walletClient);
  const creds = await bootstrapClient.createOrDeriveApiKey();
  return new ClobClient(CLOB_HOST, POLYGON_CHAIN_ID, walletClient, creds, signatureType, funder);
}

export interface WalletConnection {
  privateKey: `0x${string}`;
  signatureType: SignatureTypeValue;
  funder: Address;
}

// Read-only: confirms the key/signature-type/funder combination is actually accepted by
// Polymarket and reports the real USDC balance sitting behind it — a safe way to verify the setup
// is correct before ever risking it on a real order. Moves no funds and places no order.
export async function checkConnection(wallet: WalletConnection): Promise<{ usdcBalance: number }> {
  const client = await buildClient(wallet.privateKey, wallet.signatureType, wallet.funder);
  const res = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  // Polymarket reports USDC in its own base units (6 decimals), same as the token's own on-chain
  // decimals — not a display convention this app invented.
  return { usdcBalance: Number(res.balance) / 1_000_000 };
}

export interface RealMarketOrderResult {
  orderId: string;
  status: string;
  filled: boolean;
}

export class RealOrderRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealOrderRejectedError";
  }
}

// A single real market BUY, immediate-or-nothing (FOK — Fill Or Kill): either the whole
// `usdcAmount` fills right now at the best available price, or nothing happens and no funds move
// at all. Never leaves a resting limit order on the book, and never partially fills — matching
// "buy this outcome right now" rather than a working order someone could come back to later.
export async function placeRealMarketBuy(
  wallet: WalletConnection,
  params: { tokenId: string; usdcAmount: number }
): Promise<RealMarketOrderResult> {
  const client = await buildClient(wallet.privateKey, wallet.signatureType, wallet.funder);
  const [tickSize, negRisk] = await Promise.all([
    client.getTickSize(params.tokenId),
    client.getNegRisk(params.tokenId),
  ]);
  const signedOrder = await client.createMarketOrder(
    { tokenID: params.tokenId, side: Side.BUY, amount: params.usdcAmount, orderType: OrderType.FOK },
    { tickSize, negRisk }
  );
  const resp = (await client.postOrder(signedOrder, OrderType.FOK)) as Partial<OrderResponse> | undefined;

  if (!resp || resp.success === false) {
    throw new RealOrderRejectedError(resp?.errorMsg || "Polymarket rejected this order.");
  }
  if (!resp.orderID) {
    // The SDK's own response type is typed `any` — a success with no orderID at all is unexpected
    // enough that it shouldn't be reported as a placed order without one to show/verify later.
    throw new RealOrderRejectedError("Polymarket accepted the request but returned no order id.");
  }
  return { orderId: resp.orderID, status: resp.status ?? "unknown", filled: resp.success === true };
}
