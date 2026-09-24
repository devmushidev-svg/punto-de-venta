import { prisma } from "../src/lib/prisma.js";
import { seedDemoData } from "../src/lib/demoSeeder.js";

seedDemoData(prisma)
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
