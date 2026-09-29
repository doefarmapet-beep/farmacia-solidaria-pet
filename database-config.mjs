function sslOptions() {
  const ca = process.env.MYSQL_SSL_CA?.replaceAll('\\n', '\n');
  if (process.env.MYSQL_SSL !== 'true' && !ca) return undefined;
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

export function mysqlConfig() {
  const ssl = sslOptions();
  const common = { charset: 'utf8mb4', ...(ssl ? { ssl } : {}) };

  if (process.env.MYSQL_URL) {
    const url = new URL(process.env.MYSQL_URL);
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      ...common,
    };
  }

  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'farmacia',
    password: process.env.MYSQL_PASSWORD || 'dev-only-farmacia-password',
    database: process.env.MYSQL_DATABASE || 'farmacia_solidaria',
    ...common,
  };
}