import { checkDatabaseConnection } from '@trove/db';

export async function getDatabaseHealthStatus() {
  await checkDatabaseConnection();
}
