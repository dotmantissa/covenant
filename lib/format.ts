/**
 * Formatting helpers for numbers, basis points, addresses, and dates.
 *
 * Keeps all arithmetic integer-exact and output typography clean.
 */

export function formatAddress(addr?: string | null): string {
  if (!addr) return "";
  const clean = addr.trim();
  if (clean.length < 10) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

export function formatBp(bp: number, asMultiplier = false): string {
  if (asMultiplier) {
    return `${(bp / 10000).toFixed(2)}x`;
  }
  return `${(bp / 100).toFixed(2)}%`;
}

export function formatAtto(attoStr?: string | null, unit = "GEN"): string {
  if (!attoStr || attoStr === "0") return `0 ${unit}`;
  try {
    const raw = BigInt(attoStr);
    const divisor = 10n ** 18n;
    const whole = raw / divisor;
    const remainder = raw % divisor;
    const fraction = (remainder / 10n ** 14n).toString().padStart(4, "0");
    const formattedWhole = Number(whole).toLocaleString("en-US");
    return `${formattedWhole}.${fraction.slice(0, 2)} ${unit}`;
  } catch {
    return `${attoStr} ${unit}`;
  }
}

export function formatIsoDate(isoStr?: string | null): string {
  if (!isoStr) return "Never";
  try {
    const date = new Date(isoStr);
    if (isNaN(date.getTime())) return isoStr;
    return date.toISOString().replace("T", " ").replace("Z", " UTC").slice(0, 19);
  } catch {
    return isoStr;
  }
}
