module.exports = {
  apps: [
    {
      name: "abendkasse",
      script: "server/index.js",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3100",
        DATABASE_PATH: "/var/lib/abendkasse/abendkasse.sqlite"
      }
    }
  ]
};
