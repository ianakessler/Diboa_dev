import mysql from 'mysql2/promise';
import logger from './logger.js';


const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;
const DB_CONNECTION_LIMIT = process.env.DB_CONNECTION_LIMIT ?? '10';


if (!DB_USER || !DB_PASSWORD || !DB_NAME) {
  throw new Error('Missing required database environment variables: DB_USER, DB_PASSWORD, DB_NAME');
}

const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(DB_CONNECTION_LIMIT, 10),
  queueLimit: 0,
  timezone: 'Z',
});

pool.on('connection', () => {
  logger.debug('New MySQL connection established');
});

export default pool;
