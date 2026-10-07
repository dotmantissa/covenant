"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

export function AppPrivyProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: {
          theme: "light",
          accentColor: "#003748",
          showWalletLoginFirst: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
