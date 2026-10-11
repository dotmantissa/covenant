/** Exact user decimal parsing. Never pass token amounts through binary floats. */
export class InvalidInput extends Error {}
export function decimalUnits(value: string, decimals = 18, allowZero = false): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > decimals) throw new InvalidInput(`Enter a decimal with at most ${decimals} fractional digits.`);
  const amount = BigInt(match[1]!) * 10n ** BigInt(decimals) + BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
  if ((!allowZero && amount === 0n) || amount >= 1n << 256n) throw new InvalidInput("Amount must be positive and within the contract range.");
  return amount;
}
export function integerInput(value: unknown, label: string, min = 0, max = 2147483647): number {
  if (!/^(0|[1-9]\d*)$/.test(String(value))) throw new InvalidInput(`${label} must be a whole number.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new InvalidInput(`${label} is out of range.`);
  return parsed;
}
export function attoInput(value: unknown, allowZero = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) throw new InvalidInput("amountAtto must be an integer string.");
  const amount = BigInt(value);
  if ((!allowZero && amount === 0n) || amount >= 1n << 256n) throw new InvalidInput("Amount must be positive and within the contract range.");
  return amount;
}
export function exactDecimal(value: string, decimals = 18): string {
  const amount = BigInt(value); const scale = 10n ** BigInt(decimals);
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${amount / scale}${fraction ? `.${fraction}` : ""}`;
}
