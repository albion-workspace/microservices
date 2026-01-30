/**
 * Mock KYC Provider
 * 
 * For development and testing
 * Simulates verification flows without external API calls
 */

import { generateId, logger } from 'core-service';

import { BaseKYCProvider } from './base-provider.js';
import type {
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
  DocumentType,
} from '../types/kyc-types.js';

// ═══════════════════════════════════════════════════════════════════
// In-Memory Storage (for mock)
// ═══════════════════════════════════════════════════════════════════

const applicants = new Map<string, ApplicantDetails>();
const documents = new Map<string, ProviderDocument>();
const sessions = new Map<string, {
  session: VerificationSession;
  status: SessionStatus;
  result?: ProviderVerificationResult;
}>();

// ═══════════════════════════════════════════════════════════════════
// Mock Provider Class
// ═══════════════════════════════════════════════════════════════════

export class MockKYCProvider extends BaseKYCProvider {
  readonly name = 'mock';
  readonly displayName = 'Mock Provider';
  readonly version = '1.0.0';
  
  readonly capabilities: ProviderCapabilities = {
    supportedDocuments: [
      'passport',
      'national_id',
      'drivers_license',
      'utility_bill',
      'bank_statement',
      'selfie',
    ],
    checks: {
      aml: true,
      pep: true,
      sanctions: true,
      liveness: true,
      faceMatch: true,
      addressVerification: true,
      phoneVerification: false,
    },
    supportedCountries: [], // All countries
    flows: {
      sdk: true,
      redirect: true,
      api: true,
    },
    features: {
      ocr: true,
      nfc: false,
      videoIdent: false,
      biometric: true,
      addressLookup: false,
      realTimeDecisions: true,
      batchProcessing: false,
      webhooks: true,
    },
    dataRetention: {
      defaultDays: 365,
      maxDays: 365 * 7,
      gdprCompliant: true,
    },
  };
  
  constructor(config: ProviderConfig) {
    super(config);
    logger.info('Mock KYC provider initialized');
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Applicant Management
  // ───────────────────────────────────────────────────────────────────
  
  async createApplicant(input: CreateApplicantInput): Promise<CreateApplicantResult> {
    const applicantId = `mock_${generateId()}`;
    const now = new Date();
    
    const applicant: ApplicantDetails = {
      id: applicantId,
      externalUserId: input.externalUserId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      status: 'active',
      documents: [],
      checks: [],
      createdAt: now,
      updatedAt: now,
    };
    
    applicants.set(applicantId, applicant);
    
    this.log('createApplicant', { applicantId, externalUserId: input.externalUserId });
    
    return {
      applicantId,
      externalUserId: input.externalUserId,
      createdAt: now,
    };
  }
  
  async updateApplicant(applicantId: string, input: UpdateApplicantInput): Promise<void> {
    const applicant = applicants.get(applicantId);
    if (!applicant) {
      throw new Error(`Applicant ${applicantId} not found`);
    }
    
    if (input.firstName) applicant.firstName = input.firstName;
    if (input.lastName) applicant.lastName = input.lastName;
    if (input.email) applicant.email = input.email;
    if (input.phone) applicant.phone = input.phone;
    applicant.updatedAt = new Date();
    
    applicants.set(applicantId, applicant);
    
    this.log('updateApplicant', { applicantId });
  }
  
  async getApplicant(applicantId: string): Promise<ApplicantDetails | null> {
    return applicants.get(applicantId) ?? null;
  }
  
  async deleteApplicant(applicantId: string): Promise<void> {
    applicants.delete(applicantId);
    this.log('deleteApplicant', { applicantId });
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Document Management
  // ───────────────────────────────────────────────────────────────────
  
  async uploadDocument(input: UploadDocumentToProviderInput): Promise<UploadDocumentResult> {
    const documentId = `mock_doc_${generateId()}`;
    const now = new Date();
    
    const document: ProviderDocument = {
      id: documentId,
      applicantId: input.applicantId,
      type: input.type,
      status: 'uploaded',
      files: [{
        id: `file_${generateId()}`,
        side: input.side,
      }],
      createdAt: now,
      updatedAt: now,
    };
    
    documents.set(documentId, document);
    
    // Add to applicant
    const applicant = applicants.get(input.applicantId);
    if (applicant) {
      applicant.documents.push(documentId);
    }
    
    this.log('uploadDocument', { documentId, applicantId: input.applicantId, type: input.type });
    
    return {
      documentId,
      status: 'uploaded',
      uploadedAt: now,
    };
  }
  
  async getDocument(documentId: string): Promise<ProviderDocument | null> {
    return documents.get(documentId) ?? null;
  }
  
  async verifyDocument(documentId: string): Promise<DocumentVerificationResult> {
    const document = documents.get(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }
    
    // Simulate verification (always succeeds in mock)
    const isIdentityDoc = ['passport', 'national_id', 'drivers_license'].includes(document.type);
    
    const result: DocumentVerificationResult = {
      isAuthentic: true,
      isExpired: false,
      confidenceScore: 95,
      fraudScore: 5,
      extractedData: isIdentityDoc ? {
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: new Date('1990-01-15'),
        documentNumber: 'AB123456',
        issuingCountry: 'US',
        expiresAt: new Date('2030-01-15'),
      } : undefined,
      dataMatchScore: 90,
      provider: this.name,
      providerVerificationId: `mock_verify_${generateId()}`,
      verifiedAt: new Date(),
    };
    
    // Update document status
    document.status = 'verified';
    document.verificationResult = result;
    document.updatedAt = new Date();
    documents.set(documentId, document);
    
    this.log('verifyDocument', { documentId, isAuthentic: result.isAuthentic });
    
    return result;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Verification Sessions
  // ───────────────────────────────────────────────────────────────────
  
  async createVerificationSession(input: CreateSessionInput): Promise<VerificationSession> {
    const sessionId = `mock_session_${generateId()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (input.expiresInMinutes ?? 60) * 60 * 1000);
    
    const session: VerificationSession = {
      sessionId,
      applicantId: input.applicantId,
      sdkToken: `mock_sdk_${generateId()}`,
      sessionUrl: `https://mock-kyc.example.com/verify/${sessionId}`,
      expiresAt,
      createdAt: now,
    };
    
    const status: SessionStatus = {
      sessionId,
      status: 'pending',
      completedSteps: [],
      currentStep: 'document',
      remainingSteps: ['document', 'selfie', 'liveness'],
      updatedAt: now,
    };
    
    sessions.set(sessionId, { session, status });
    
    this.log('createVerificationSession', { sessionId, applicantId: input.applicantId, level: input.level });
    
    return session;
  }
  
  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    const data = sessions.get(sessionId);
    if (!data) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return data.status;
  }
  
  async getVerificationResult(sessionId: string): Promise<ProviderVerificationResult> {
    const data = sessions.get(sessionId);
    if (!data) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    // If already has result, return it
    if (data.result) {
      return data.result;
    }
    
    // Simulate successful verification
    const result: ProviderVerificationResult = {
      sessionId,
      applicantId: data.session.applicantId,
      decision: 'approved',
      decisionReasons: ['All checks passed'],
      riskScore: 15,
      verifiedData: {
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: new Date('1990-01-15'),
        nationality: 'US',
      },
      checksPerformed: [
        { type: 'document', result: 'clear' },
        { type: 'liveness', result: 'clear' },
        { type: 'face_match', result: 'clear' },
      ],
      completedAt: new Date(),
    };
    
    // Update session
    data.result = result;
    data.status.status = 'completed';
    data.status.result = 'approved';
    data.status.completedSteps = ['document', 'selfie', 'liveness'];
    data.status.currentStep = undefined;
    data.status.remainingSteps = [];
    data.status.updatedAt = new Date();
    
    sessions.set(sessionId, data);
    
    this.log('getVerificationResult', { sessionId, decision: result.decision });
    
    return result;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Compliance Checks
  // ───────────────────────────────────────────────────────────────────
  
  async performAMLCheck(applicantId: string, options?: AMLCheckOptions): Promise<AMLCheck> {
    this.log('performAMLCheck', { applicantId, options });
    
    // Simulate AML check (always clear in mock)
    const check: AMLCheck = {
      id: generateId(),
      profileId: '', // Will be set by caller
      type: 'initial',
      provider: this.name,
      providerCheckId: `mock_aml_${generateId()}`,
      status: 'clear',
      performedAt: new Date(),
    };
    
    return check;
  }
  
  async performPEPScreening(applicantId: string, options?: PEPScreeningOptions): Promise<PEPScreening> {
    this.log('performPEPScreening', { applicantId, options });
    
    // Simulate PEP screening (not PEP in mock)
    const screening: PEPScreening = {
      id: generateId(),
      profileId: '', // Will be set by caller
      provider: this.name,
      providerCheckId: `mock_pep_${generateId()}`,
      isPEP: false,
      requiresEnhancedDueDiligence: false,
      performedAt: new Date(),
    };
    
    return screening;
  }
  
  async performSanctionScreening(applicantId: string, options: SanctionScreeningOptions): Promise<SanctionScreening> {
    this.log('performSanctionScreening', { applicantId, lists: options.lists });
    
    // Simulate sanction screening (always clear in mock)
    const screening: SanctionScreening = {
      id: generateId(),
      profileId: '', // Will be set by caller
      provider: this.name,
      providerCheckId: `mock_sanction_${generateId()}`,
      listsChecked: options.lists,
      result: 'clear',
      performedAt: new Date(),
    };
    
    return screening;
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Biometric
  // ───────────────────────────────────────────────────────────────────
  
  async performLivenessCheck(applicantId: string, options?: LivenessCheckOptions): Promise<LivenessCheckResult> {
    this.log('performLivenessCheck', { applicantId, options });
    
    return {
      id: `mock_liveness_${generateId()}`,
      passed: true,
      confidence: 98,
      signals: {
        isLive: true,
        spoofingAttempt: false,
      },
      performedAt: new Date(),
    };
  }
  
  async performFaceMatch(applicantId: string, documentId: string, selfieId: string): Promise<FaceMatchResult> {
    this.log('performFaceMatch', { applicantId, documentId, selfieId });
    
    return {
      id: `mock_facematch_${generateId()}`,
      matched: true,
      similarity: 95,
      details: {
        selfieQuality: 90,
        documentPhotoQuality: 85,
        ageEstimate: 34,
        ageEstimateMatch: true,
      },
      performedAt: new Date(),
    };
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Webhooks
  // ───────────────────────────────────────────────────────────────────
  
  async parseWebhook(payload: unknown, signature: string, secret: string): Promise<ProviderWebhookEvent> {
    // In mock, just return the payload as-is
    const data = payload as any;
    
    return {
      id: data.id ?? generateId(),
      type: data.type ?? 'verification.completed',
      applicantId: data.applicantId ?? '',
      entityType: data.entityType,
      entityId: data.entityId,
      data: data.data,
      createdAt: new Date(data.createdAt ?? Date.now()),
      receivedAt: new Date(),
    };
  }
  
  getWebhookSignatureHeader(): string {
    return 'X-Mock-Signature';
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Health
  // ───────────────────────────────────────────────────────────────────
  
  async checkHealth(): Promise<ProviderHealthStatus> {
    return {
      healthy: true,
      services: [
        { name: 'api', status: 'operational', latencyMs: 10 },
        { name: 'verification', status: 'operational', latencyMs: 15 },
        { name: 'aml', status: 'operational', latencyMs: 20 },
      ],
      checkedAt: new Date(),
    };
  }
  
  // ───────────────────────────────────────────────────────────────────
  // Mock-Specific Methods (for testing)
  // ───────────────────────────────────────────────────────────────────
  
  /**
   * Simulate session completion (for testing webhooks)
   */
  simulateSessionCompletion(
    sessionId: string, 
    decision: 'approved' | 'rejected' | 'manual_review' = 'approved'
  ): ProviderWebhookEvent {
    const data = sessions.get(sessionId);
    if (!data) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    data.status.status = 'completed';
    data.status.result = decision;
    data.status.updatedAt = new Date();
    
    if (!data.result) {
      data.result = {
        sessionId,
        applicantId: data.session.applicantId,
        decision,
        decisionReasons: decision === 'approved' ? ['All checks passed'] : ['Verification failed'],
        completedAt: new Date(),
      };
    }
    
    sessions.set(sessionId, data);
    
    return {
      id: generateId(),
      type: 'verification.completed',
      applicantId: data.session.applicantId,
      entityType: 'session',
      entityId: sessionId,
      data: {
        decision,
        sessionId,
      },
      createdAt: new Date(),
      receivedAt: new Date(),
    };
  }
  
  /**
   * Clear all mock data (for testing)
   */
  clearAll(): void {
    applicants.clear();
    documents.clear();
    sessions.clear();
  }
}
