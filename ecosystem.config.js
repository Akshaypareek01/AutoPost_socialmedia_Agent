/**
 * PM2 Ecosystem Config
 * Production process manager — auto-restart on crash, log rotation, etc.
 *
 * Usage:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js
 *   pm2 save           (persist across reboots)
 *   pm2 startup        (auto-start on server boot)
 *   pm2 logs techpage  (view live logs)
 *   pm2 monit          (live dashboard)
 */

module.exports = {
  apps: [
    {
      name: 'techpage-auto',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },
      // Log config
      log_file: 'logs/combined.log',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Restart delay on crash (5 minutes)
      restart_delay: 300000,
      // Exponential backoff restart
      exp_backoff_restart_delay: 100,
    },
  ],
};
