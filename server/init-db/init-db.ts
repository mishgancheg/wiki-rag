import { Client } from 'pg';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config.js';

async function ensureDatabaseExists(): Promise<void> {
  const adminClient = new Client({
    host: config.pgHost,
    port: config.pgPort,
    user: config.pgUser,
    password: config.pgPassword,
    database: 'postgres',
  });

  await adminClient.connect();
  try {
    const dbCheckResult = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [config.pgDatabase]
    );

    if (dbCheckResult.rows.length === 0) {
      console.log(`Creating database ${config.pgDatabase}...`);
      await adminClient.query(`CREATE DATABASE "${config.pgDatabase}"`);
    }
  } finally {
    await adminClient.end();
  }
}

async function runSqlFilesInDir(client: Client, dirPath: string): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.sql'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    console.log(`Executing SQL: ${path.relative(process.cwd(), fullPath)}`);
    const sql = await fs.readFile(fullPath, 'utf8');
    if (sql.trim().length === 0) continue;
    await client.query(sql);
  }
}

export async function initializeDatabase(): Promise<void> {
  console.log('Initializing database (from SQL files)...');

  await ensureDatabaseExists();

  const client = new Client({
    host: config.pgHost,
    port: config.pgPort,
    user: config.pgUser,
    password: config.pgPassword,
    database: config.pgDatabase,
  });

  await client.connect();
  try {
    const ddlDir = path.join(__dirname, 'DDL');
    await runSqlFilesInDir(client, ddlDir);

    console.log('Database initialization completed successfully!');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  initializeDatabase()
    .then(() => {
      console.log('Database setup completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Database setup failed:', error);
      process.exit(1);
    });
}
