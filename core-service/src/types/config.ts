/**
 * Default service configuration – common properties shared by all microservices.
 * Each service config interface (PaymentConfig, BonusConfig, etc.) should extend this
 * and add only service-specific properties. See CODING_STANDARDS.md and SERVICE_GENERATOR.md.
 *
 * Optional properties (useMongoTransactions, etc.) are used by some services; others ignore them.
 */

export interface DefaultServiceConfig {
  port: number;
  nodeEnv: string;
  serviceName: string;
  mongoUri?: string;
  redisUrl?: string;
  corsOrigins: string[];
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshSecret?: string;
  jwtRefreshExpiresIn?: string;
  /** Use MongoDB transactions for saga/domain operations; used by payment and bonus, optional elsewhere. */
  useMongoTransactions?: boolean;
}
