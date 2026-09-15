import pino from 'pino'

const isDevelopment = process.argv.includes('--dev') || process.env.NODE_ENV === 'development'

const logger = isDevelopment
  ? pino({
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    })
  : pino({ level: process.env.LOG_LEVEL || 'info' })

export default logger
