type Environment = Record<string, string | undefined>;

export type DemoSeedCredentials = {
  adminPassword: string;
  cashierPassword: string;
  normalPassword: string;
};

function requireCredential(env: Environment, key: "DEMO_ADMIN_PASSWORD" | "DEMO_CASHIER_PASSWORD" | "DEMO_NORMAL_PASSWORD", localFallback: string): string {
  const value = env[key]?.trim();
  if (value) return value;
  if (env.NODE_ENV === "production") {
    throw new Error(`${key} is required when seeding demo data in production.`);
  }
  return localFallback;
}

export function demoSeedCredentials(env: Environment = process.env): DemoSeedCredentials {
  return {
    adminPassword: requireCredential(env, "DEMO_ADMIN_PASSWORD", "admin"),
    cashierPassword: requireCredential(env, "DEMO_CASHIER_PASSWORD", "cajero"),
    normalPassword: requireCredential(env, "DEMO_NORMAL_PASSWORD", "usuario"),
  };
}
