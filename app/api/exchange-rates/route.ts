import {
  isMenuExchangeRates,
  type ExchangeRateSnapshot,
  type MenuExchangeRates,
} from "@/lib/config/currency";

const UPSTREAM_TIMEOUT_MS = 8_000;
const SERVER_REVALIDATE_SECONDS = 60;

let lastSuccessfulSnapshot: ExchangeRateSnapshot | null = null;

interface ExchangeRateApiResponse {
  result?: string;
  time_last_update_unix?: number;
  conversion_rates?: Partial<Record<"TRY" | "USD" | "EUR", number>>;
}

interface FrankfurterResponse {
  date?: string;
  rates?: Partial<Record<"USD" | "EUR", number>>;
}

function createRates(usd: unknown, eur: unknown): MenuExchangeRates {
  const rates = { TRY: 1, USD: usd, EUR: eur };
  if (!isMenuExchangeRates(rates)) {
    throw new Error("Kur sağlayıcısı geçersiz değer döndürdü.");
  }
  return rates;
}

async function fetchLatestRates(): Promise<ExchangeRateSnapshot> {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY?.trim();
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);

  if (apiKey) {
    const response = await fetch(
      `https://v6.exchangerate-api.com/v6/${encodeURIComponent(apiKey)}/latest/TRY`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: SERVER_REVALIDATE_SECONDS },
        signal,
      },
    );
    if (!response.ok) throw new Error(`Kur sağlayıcısı ${response.status} yanıtı verdi.`);

    const data = await response.json() as ExchangeRateApiResponse;
    if (data.result !== "success") throw new Error("Kur sağlayıcısı isteği başarısız oldu.");

    return {
      rates: createRates(data.conversion_rates?.USD, data.conversion_rates?.EUR),
      updatedAt: new Date().toISOString(),
      sourceUpdatedAt: typeof data.time_last_update_unix === "number"
        ? new Date(data.time_last_update_unix * 1_000).toISOString()
        : undefined,
    };
  }

  const response = await fetch(
    "https://api.frankfurter.dev/v1/latest?base=TRY&symbols=USD,EUR",
    {
      headers: { Accept: "application/json" },
      next: { revalidate: SERVER_REVALIDATE_SECONDS },
      signal,
    },
  );
  if (!response.ok) throw new Error(`Kur sağlayıcısı ${response.status} yanıtı verdi.`);

  const data = await response.json() as FrankfurterResponse;
  return {
    rates: createRates(data.rates?.USD, data.rates?.EUR),
    updatedAt: new Date().toISOString(),
    sourceUpdatedAt: data.date ? new Date(`${data.date}T00:00:00.000Z`).toISOString() : undefined,
  };
}

export async function GET() {
  try {
    const snapshot = await fetchLatestRates();
    lastSuccessfulSnapshot = snapshot;
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    if (lastSuccessfulSnapshot) {
      return Response.json(
        { ...lastSuccessfulSnapshot, stale: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      { error: "Güncel döviz kurları geçici olarak alınamıyor." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
