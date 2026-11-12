import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/** Either the shared client or a transaction, so services compose inside transactions. */
export type Db = PrismaClient | Prisma.TransactionClient;
