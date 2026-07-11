// Fails closed instead of silently serving plain HTTP: Nitro's node-server
// runtime already terminates TLS itself when NITRO_SSL_CERT/NITRO_SSL_KEY
// are set (https://nitro.build), but falls back to plain http.createServer
// whenever either is missing. That fallback is exactly what "HTTPS only"
// means to defeat, so refuse to start at all rather than downgrade quietly.
if (!process.env.NITRO_SSL_CERT || !process.env.NITRO_SSL_KEY) {
  console.error(
    "NITRO_SSL_CERT and NITRO_SSL_KEY must both be set -- this image serves HTTPS only, " +
      "there is no plain-HTTP fallback. Supply the deployment's real certificate and private " +
      "key (PEM contents, not file paths) as these two environment variables.",
  );
  process.exit(1);
}

await import("./.output/server/index.mjs");
