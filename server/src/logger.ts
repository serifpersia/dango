import pino from 'pino'

const isDevelopment = process.argv.includes('--dev') || process.env.NODE_ENV === 'development'

const logger = pino({
  level: isDevelopment ? 'debug' : 'info',
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
})

export default logger
