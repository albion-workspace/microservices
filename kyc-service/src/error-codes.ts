/**
 * KYC Service Error Codes
 * 
 * Follows the pattern: MS{Service}{ErrorName}
 */

// ═══════════════════════════════════════════════════════════════════
// Profile Errors
// ═══════════════════════════════════════════════════════════════════

export const KYC_ERRORS = {
  // Profile
  ProfileNotFound: 'MSKYCProfileNotFound',
  ProfileAlreadyExists: 'MSKYCProfileAlreadyExists',
  ProfileSuspended: 'MSKYCProfileSuspended',
  ProfileExpired: 'MSKYCProfileExpired',
  
  // Verification
  VerificationNotFound: 'MSKYCVerificationNotFound',
  VerificationAlreadyInProgress: 'MSKYCVerificationAlreadyInProgress',
  VerificationExpired: 'MSKYCVerificationExpired',
  VerificationFailed: 'MSKYCVerificationFailed',
  VerificationCancelled: 'MSKYCVerificationCancelled',
  
  // Tier
  TierNotAvailable: 'MSKYCTierNotAvailable',
  TierPrerequisiteNotMet: 'MSKYCTierPrerequisiteNotMet',
  TierUpgradeNotAllowed: 'MSKYCTierUpgradeNotAllowed',
  TierDowngradeNotAllowed: 'MSKYCTierDowngradeNotAllowed',
  
  // Documents
  DocumentNotFound: 'MSKYCDocumentNotFound',
  DocumentUploadFailed: 'MSKYCDocumentUploadFailed',
  DocumentTypeNotAccepted: 'MSKYCDocumentTypeNotAccepted',
  DocumentExpired: 'MSKYCDocumentExpired',
  DocumentRejected: 'MSKYCDocumentRejected',
  DocumentAlreadyVerified: 'MSKYCDocumentAlreadyVerified',
  DocumentFileTooLarge: 'MSKYCDocumentFileTooLarge',
  DocumentInvalidFormat: 'MSKYCDocumentInvalidFormat',
  
  // Requirements
  RequirementNotSatisfied: 'MSKYCRequirementNotSatisfied',
  RequirementsIncomplete: 'MSKYCRequirementsIncomplete',
  
  // Limits
  LimitExceeded: 'MSKYCLimitExceeded',
  LimitCheckFailed: 'MSKYCLimitCheckFailed',
  InsufficientTierForAmount: 'MSKYCInsufficientTierForAmount',
  
  // AML/Compliance
  AMLCheckFailed: 'MSKYCAMLCheckFailed',
  AMLMatchFound: 'MSKYCAMLMatchFound',
  PEPCheckFailed: 'MSKYCPEPCheckFailed',
  SanctionMatch: 'MSKYCSanctionMatch',
  HighRiskBlocked: 'MSKYCHighRiskBlocked',
  
  // Source of Funds
  SourceOfFundsRequired: 'MSKYCSourceOfFundsRequired',
  SourceOfFundsNotVerified: 'MSKYCSourceOfFundsNotVerified',
  
  // Business KYC
  BusinessKYCRequired: 'MSKYCBusinessKYCRequired',
  BusinessKYCNotVerified: 'MSKYCBusinessKYCNotVerified',
  BeneficialOwnerNotVerified: 'MSKYCBeneficialOwnerNotVerified',
  
  // Provider
  ProviderNotFound: 'MSKYCProviderNotFound',
  ProviderNotAvailable: 'MSKYCProviderNotAvailable',
  ProviderError: 'MSKYCProviderError',
  ProviderSessionExpired: 'MSKYCProviderSessionExpired',
  ProviderWebhookInvalid: 'MSKYCProviderWebhookInvalid',
  
  // Jurisdiction
  JurisdictionNotSupported: 'MSKYCJurisdictionNotSupported',
  JurisdictionRestricted: 'MSKYCJurisdictionRestricted',
  NationalityRestricted: 'MSKYCNationalityRestricted',
  
  // Risk
  RiskAssessmentFailed: 'MSKYCRiskAssessmentFailed',
  RiskLevelTooHigh: 'MSKYCRiskLevelTooHigh',
  
  // Age
  MinimumAgeNotMet: 'MSKYCMinimumAgeNotMet',
  
  // General
  InvalidInput: 'MSKYCInvalidInput',
  OperationNotAllowed: 'MSKYCOperationNotAllowed',
  ConfigurationError: 'MSKYCConfigurationError',
  InternalError: 'MSKYCInternalError',
} as const;

/**
 * All error codes as array (for registration with core-service)
 */
export const KYC_ERROR_CODES = Object.values(KYC_ERRORS) as readonly string[];

/**
 * Error code type
 */
export type KYCErrorCode = typeof KYC_ERRORS[keyof typeof KYC_ERRORS];

/**
 * Error messages (for documentation/reference)
 */
export const KYC_ERROR_MESSAGES: Record<KYCErrorCode, string> = {
  [KYC_ERRORS.ProfileNotFound]: 'KYC profile not found for this user',
  [KYC_ERRORS.ProfileAlreadyExists]: 'KYC profile already exists for this user',
  [KYC_ERRORS.ProfileSuspended]: 'KYC profile is suspended',
  [KYC_ERRORS.ProfileExpired]: 'KYC verification has expired',
  
  [KYC_ERRORS.VerificationNotFound]: 'Verification not found',
  [KYC_ERRORS.VerificationAlreadyInProgress]: 'A verification is already in progress',
  [KYC_ERRORS.VerificationExpired]: 'Verification session has expired',
  [KYC_ERRORS.VerificationFailed]: 'Verification failed',
  [KYC_ERRORS.VerificationCancelled]: 'Verification was cancelled',
  
  [KYC_ERRORS.TierNotAvailable]: 'This KYC tier is not available',
  [KYC_ERRORS.TierPrerequisiteNotMet]: 'Prerequisites for this tier are not met',
  [KYC_ERRORS.TierUpgradeNotAllowed]: 'Tier upgrade is not allowed',
  [KYC_ERRORS.TierDowngradeNotAllowed]: 'Tier downgrade is not allowed',
  
  [KYC_ERRORS.DocumentNotFound]: 'Document not found',
  [KYC_ERRORS.DocumentUploadFailed]: 'Document upload failed',
  [KYC_ERRORS.DocumentTypeNotAccepted]: 'This document type is not accepted',
  [KYC_ERRORS.DocumentExpired]: 'Document has expired',
  [KYC_ERRORS.DocumentRejected]: 'Document was rejected',
  [KYC_ERRORS.DocumentAlreadyVerified]: 'Document is already verified',
  [KYC_ERRORS.DocumentFileTooLarge]: 'Document file is too large',
  [KYC_ERRORS.DocumentInvalidFormat]: 'Document format is not supported',
  
  [KYC_ERRORS.RequirementNotSatisfied]: 'Requirement is not satisfied',
  [KYC_ERRORS.RequirementsIncomplete]: 'Not all requirements are complete',
  
  [KYC_ERRORS.LimitExceeded]: 'Transaction limit exceeded',
  [KYC_ERRORS.LimitCheckFailed]: 'Unable to check transaction limits',
  [KYC_ERRORS.InsufficientTierForAmount]: 'Higher KYC tier required for this amount',
  
  [KYC_ERRORS.AMLCheckFailed]: 'AML check failed',
  [KYC_ERRORS.AMLMatchFound]: 'AML screening found a match',
  [KYC_ERRORS.PEPCheckFailed]: 'PEP screening failed',
  [KYC_ERRORS.SanctionMatch]: 'Sanctions match found',
  [KYC_ERRORS.HighRiskBlocked]: 'Operation blocked due to high risk',
  
  [KYC_ERRORS.SourceOfFundsRequired]: 'Source of funds declaration required',
  [KYC_ERRORS.SourceOfFundsNotVerified]: 'Source of funds not yet verified',
  
  [KYC_ERRORS.BusinessKYCRequired]: 'Business KYC required for this operation',
  [KYC_ERRORS.BusinessKYCNotVerified]: 'Business KYC not yet verified',
  [KYC_ERRORS.BeneficialOwnerNotVerified]: 'Beneficial owner KYC not verified',
  
  [KYC_ERRORS.ProviderNotFound]: 'KYC provider not found',
  [KYC_ERRORS.ProviderNotAvailable]: 'KYC provider is not available',
  [KYC_ERRORS.ProviderError]: 'KYC provider returned an error',
  [KYC_ERRORS.ProviderSessionExpired]: 'Provider session has expired',
  [KYC_ERRORS.ProviderWebhookInvalid]: 'Invalid webhook from provider',
  
  [KYC_ERRORS.JurisdictionNotSupported]: 'This jurisdiction is not supported',
  [KYC_ERRORS.JurisdictionRestricted]: 'This jurisdiction is restricted',
  [KYC_ERRORS.NationalityRestricted]: 'This nationality is restricted',
  
  [KYC_ERRORS.RiskAssessmentFailed]: 'Risk assessment failed',
  [KYC_ERRORS.RiskLevelTooHigh]: 'Risk level is too high for this operation',
  
  [KYC_ERRORS.MinimumAgeNotMet]: 'Minimum age requirement not met',
  
  [KYC_ERRORS.InvalidInput]: 'Invalid input provided',
  [KYC_ERRORS.OperationNotAllowed]: 'This operation is not allowed',
  [KYC_ERRORS.ConfigurationError]: 'KYC configuration error',
  [KYC_ERRORS.InternalError]: 'Internal KYC service error',
};
