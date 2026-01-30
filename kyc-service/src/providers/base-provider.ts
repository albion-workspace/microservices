/**
 * Base KYC Provider
 * 
 * Abstract base class for KYC providers
 */

import { logger, CircuitBreaker, retry } from 'core-service';
import type {
  KYCProvider,
  ProviderCapabilities,
  CreateApplicantInput,
  CreateApplicantResult,
  UpdateApplicantInput,
  ApplicantDetails,
  UploadDocumentToProviderInput,
  UploadDocumentResult,
  ProviderDocument,
  CreateSessionInput,
  VerificationSession,
  SessionStatus,
  ProviderVerificationResult,
  AMLCheckOptions,
  PEPScreeningOptions,
  SanctionScreeningOptions,
  LivenessCheckOptions,
  LivenessCheckResult,
  FaceMatchResult,
  ProviderWebhookEvent,
  ProviderHealthStatus,
  ProviderConfig,
} from '../types/provider-types.js';
import type {
  DocumentVerificationResult,
  AMLCheck,
  PEPScreening,
  SanctionScreening,
} from '../types/kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// Base Provider Class
// ═══════════════════════════════════════════════════════════════════

export abstract class BaseKYCProvider implements KYCProvider {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly version: string;
  abstract readonly capabilities: ProviderCapabilities;
  
  protected config: ProviderConfig;
  protected circuitBreaker: CircuitBreaker;
  
  constructor(config: ProviderConfig) {
    this.config = config;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 30000,
      monitoringWindow: 60000,
    });
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Protected Helpers
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Execute with circuit breaker and retry
   */
  protected async execute<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.circuitBreaker.execute(async () => {
      const result = await retry(fn, {
        maxRetries: this.config.retryConfig?.maxRetries ?? 3,
        strategy: 'exponential',
        baseDelay: this.config.retryConfig?.initialDelayMs ?? 100,
        maxDelay: this.config.retryConfig?.maxDelayMs ?? 5000,
      });
      return result.result as T;
    });
  }
  
  /**
   * Log provider operation
   */
  protected log(operation: string, data: Record<string, unknown>): void {
    logger.debug(`[${this.name}] ${operation}`, data);
  }
  
  /**
   * Log provider error
   */
  protected logError(operation: string, error: Error, data?: Record<string, unknown>): void {
    logger.error(`[${this.name}] ${operation} failed`, {
      ...data,
      error: error.message,
    });
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Abstract Methods (must be implemented by subclasses)
  // ───────────────────────────────────────────────────────────────────
  
  abstract createApplicant(input: CreateApplicantInput): Promise<CreateApplicantResult>;
  abstract updateApplicant(applicantId: string, input: UpdateApplicantInput): Promise<void>;
  abstract getApplicant(applicantId: string): Promise<ApplicantDetails | null>;
  abstract deleteApplicant(applicantId: string): Promise<void>;
  
  abstract uploadDocument(input: UploadDocumentToProviderInput): Promise<UploadDocumentResult>;
  abstract getDocument(documentId: string): Promise<ProviderDocument | null>;
  abstract verifyDocument(documentId: string): Promise<DocumentVerificationResult>;
  
  abstract createVerificationSession(input: CreateSessionInput): Promise<VerificationSession>;
  abstract getSessionStatus(sessionId: string): Promise<SessionStatus>;
  abstract getVerificationResult(sessionId: string): Promise<ProviderVerificationResult>;
  
  abstract performAMLCheck(applicantId: string, options?: AMLCheckOptions): Promise<AMLCheck>;
  abstract performPEPScreening(applicantId: string, options?: PEPScreeningOptions): Promise<PEPScreening>;
  abstract performSanctionScreening(applicantId: string, options: SanctionScreeningOptions): Promise<SanctionScreening>;
  
  abstract parseWebhook(payload: unknown, signature: string, secret: string): Promise<ProviderWebhookEvent>;
  abstract getWebhookSignatureHeader(): string;
  abstract checkHealth(): Promise<ProviderHealthStatus>;
  
  // ───────────────────────────────────────────────────────────────────
  // Optional Methods (default implementations)
  // ───────────────────────────────────────────────────────────────────
  
  async performLivenessCheck?(applicantId: string, options?: LivenessCheckOptions): Promise<LivenessCheckResult> {
    throw new Error(`Liveness check not supported by ${this.name}`);
  }
  
  async performFaceMatch?(applicantId: string, documentId: string, selfieId: string): Promise<FaceMatchResult> {
    throw new Error(`Face match not supported by ${this.name}`);
  }
}
