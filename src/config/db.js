import mysql from 'mysql2/promise';
import logger from './logger.js';


 const DB_HOST = 'localhost';
 const DB_USER = 'ian@localhost';
 const DB_PASSWORD= '@Pfdfqm1';
 const DB_NAME = 'diboa_dev';
 const DB_CONNECTION_LIMIT = '10';


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
