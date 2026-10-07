/**
 * Single place that reads the environment, so a missing value fails with a
 * sentence rather than as `undefined` three layers down.
 *
 * Nothing here is exported as a bare constant. Each value is read through a
 * function so that importing this module never throws at build time, which
 * matters because the frontend bundle imports the public values and must not
 * drag the server side ones into scope.
 */

function read(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. ${hint} Add it to .env.local; see .env.example.`,
    );
  }
  return value;
}

/** Neon connection string. Server only. */
export const databaseUrl = () =>
  read("DATABASE_URL", "This is the Neon Postgres connection string.");

/** Privy application id. Safe in the browser. */
export const privyAppId = () =>
  read("NEXT_PUBLIC_PRIVY_APP_ID", "Find it in the Privy dashboard.");

/** Privy application secret. Server only, never sent to the browser. */
export const privyAppSecret = () =>
  read("PRIVY_APP_SECRET", "Find it in the Privy dashboard under API keys.");

/**
 * Master secret every user's GenLayer key is derived from. Server only.
 *
 * Changing this reassigns every address the app has ever derived, which would
 * orphan every facility already on chain, so it must be set once and kept.
 */
export const signerMasterSecret = () => {
  const value = read(
    "SIGNER_MASTER_SECRET",
    "Generate 32 random bytes as hex and keep it forever.",
  );
  if (value.length < 32) {
    throw new Error(
      "SIGNER_MASTER_SECRET is too short. Use at least 32 bytes of hex.",
    );
  }
  return value;
};

/** GenLayer network alias, matching a key exported by genlayer-js/chains. */
export const genlayerNetwork = () => process.env.GENLAYER_NETWORK ?? "studionet";

export type ContractAddresses = {
  facilityRegistry: `0x${string}`;
  covenantMonitor: `0x${string}`;
  creditVault: `0x${string}`;
};

/** Deployed addresses. Public, so these are readable in the browser too. */
export const contractAddresses = (): ContractAddresses => ({
  facilityRegistry: read(
    "NEXT_PUBLIC_FACILITY_REGISTRY_ADDRESS",
    "Run npm run deploy:contracts.",
  ) as `0x${string}`,
  covenantMonitor: read(
    "NEXT_PUBLIC_COVENANT_MONITOR_ADDRESS",
    "Run npm run deploy:contracts.",
  ) as `0x${string}`,
  creditVault: read(
    "NEXT_PUBLIC_CREDIT_VAULT_ADDRESS",
    "Run npm run deploy:contracts.",
  ) as `0x${string}`,
});
