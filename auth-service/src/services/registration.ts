/**
 * Registration Service
 * Handles user registration with flexible identifiers (username/email/phone)
 */

import { getDatabase, logger, generateMongoId, createRegistrationStore, getRedis, createPendingOperationStore } from 'core-service';
import type { RegisterInput, User, AuthResponse, OTPChannel, DeviceInfo } from '../types.js';
import { 
  validatePassword, 
  normalizeEmail, 
  normalizePhone,
  isValidEmail,
  isValidPhone,
  isValidUsername,
  generateOTP,
  hashToken,
  addMinutes,
  hashPassword,
  normalizeUser,
} from '../utils.js';
import type { AuthConfig } from '../types.js';
import type { OTPProviderFactory } from '../providers/otp-provider.js';

export class RegistrationService {
  private registrationStore: ReturnType<typeof createRegistrationStore>;
  private otpStore: ReturnType<typeof createPendingOperationStore>;
  
  constructor(
    private config: AuthConfig,
    private otpProviders: OTPProviderFactory,
    private authenticationService?: any // Optional: for token generation after verification
  ) {
    // Use generic pending operation store for registration
    this.registrationStore = createRegistrationStore(this.config.jwtSecret);
    // Use generic pending operation store for OTPs (unified pattern)
    this.otpStore = createPendingOperationStore({
      backend: 'jwt', // Explicitly use JWT backend for stateless OTP tokens
      jwtSecret: this.config.jwtSecret,
      defaultExpiration: `${this.config.otpExpiryMinutes}m`,
    });
  }
  
  /**
   * Register a new user
   * 
   * If verification is required (sendOTP=true, autoVerify=false):
   * - Creates JWT token with registration data (doesn't save to DB)
   * - Sends OTP for verification
   * - Returns registrationToken instead of user
   * 
   * If autoVerify=true:
   * - Saves user to DB immediately
   * - Returns user and tokens
   */
  async register(input: RegisterInput): Promise<AuthResponse> {
    const db = getDatabase();
    
    // Validate input
    const validation = await this.validateRegistrationInput(input);
    if (!validation.valid) {
      return {
        success: false,
        message: validation.error,
      };
    }
    
    // Check if user already exists
    const existingUser = await this.findExistingUser(input);
    if (existingUser) {
      return {
        success: false,
        message: 'User already exists with this identifier',
      };
    }
    
    // If verification is required, use JWT-based registration (don't save to DB yet)
    if (input.sendOTP && !input.autoVerify) {
      return this.registerWithJWT(input);
    }
    
    // Auto-verify: Create user in DB immediately
    const user = await this.createUser(input);
    
    logger.info('User registered (auto-verified)', { userId: user.id, tenantId: user.tenantId });
    
    return {
      success: true,
      message: 'Registration successful',
      user,
    };
  }
  
  /**
   * Register with pending operation store (unverified registration)
   * Stores registration data temporarily, only saves to DB after verification
   */
  private async registerWithJWT(input: RegisterInput): Promise<AuthResponse> {
    // Hash password before storing
    const passwordHash = input.password ? await hashPassword(input.password) : '';
    
    // Determine recipient and channel for OTP
    let recipient: string;
    let channel: OTPChannel;
    let purpose: 'email_verification' | 'phone_verification';
    
    if (input.email) {
      recipient = normalizeEmail(input.email);
      channel = 'email';
      purpose = 'email_verification';
    } else if (input.phone) {
      recipient = normalizePhone(input.phone);
      channel = this.otpProviders.isChannelAvailable('whatsapp') ? 'whatsapp' : 'sms';
      purpose = 'phone_verification';
    } else {
      return {
        success: false,
        message: 'Email or phone is required for verification',
      };
    }
    
    // Generate OTP code - use "000000" for testing (when providers not configured)
    const code = '000000'; // Test OTP - replace with generateOTP(this.config.otpLength) in production
    const hashedCode = await hashToken(code);
    
    // Create registration data WITH OTP included in JWT token metadata
    // This eliminates the need for a separate OTP database entry for registration
    const registrationData = {
      tenantId: input.tenantId,
      username: input.username,
      email: input.email ? normalizeEmail(input.email) : undefined,
      phone: input.phone ? normalizePhone(input.phone) : undefined,
      passwordHash,
      metadata: input.metadata || {},
      // Store OTP info directly in registration data (will be in JWT token)
      otp: {
        hashedCode,
        channel,
        recipient,
        purpose,
        createdAt: Date.now(),
        // OTP expires in config.otpExpiryMinutes, but JWT expires in 24h
        // We'll check OTP expiration separately during verification
        expiresIn: this.config.otpExpiryMinutes * 60 * 1000, // milliseconds
      },
    };
    
    // Store in pending operation store (JWT-based, expires in 24 hours)
    // OTP is included in the token, so no separate DB write needed
    const registrationToken = await this.registrationStore.create(
      'registration',
      registrationData,
      {
        operationType: 'registration',
        expiresIn: '24h',
      }
    );
    
    // Debug log: Output plain OTP code for testing (check logs to retrieve OTP)
    logger.debug('Registration OTP code (for testing)', {
      recipient,
      channel,
      otpCode: code,
      registrationToken: registrationToken.substring(0, 50) + '...',
    });
    
    // Send OTP via notification service
    // TODO: Uncomment when providers are configured
    // try {
    //   const provider = this.otpProviders.getProvider(channel);
    //   await provider.send(recipient, code, purpose, input.tenantId);
    //   logger.info('Registration OTP sent successfully', { 
    //     recipient,
    //     channel,
    //   });
    // } catch (sendError) {
    //   logger.warn('Failed to send OTP via provider (OTP stored in JWT token)', { 
    //     error: sendError,
    //     recipient,
    //     channel,
    //   });
    // }
    
    logger.info('Registration token created (JWT-based with OTP)', { 
      recipient,
      channel,
      tokenExpiresIn: '24h',
      otpExpiresIn: `${this.config.otpExpiryMinutes} minutes`,
    });
    
    return {
      success: true,
      message: 'Registration initiated. Please verify your account.',
      requiresOTP: true,
      otpSentTo: recipient,
      otpChannel: channel,
      registrationToken, // Return token with OTP included in metadata
    };
  }
  
  /**
   * Verify registration and create user in DB
   * Called after OTP verification succeeds
   */
  async verifyRegistration(
    registrationToken: string,
    otpCode: string,
    tenantId: string
  ): Promise<AuthResponse> {
    // Verify and retrieve registration data from pending operation store
    const operation = await this.registrationStore.verify<{
      tenantId: string;
      username?: string;
      email?: string;
      phone?: string;
      passwordHash: string;
      metadata?: Record<string, any>;
    }>(registrationToken, 'registration');
    
    if (!operation) {
      return {
        success: false,
        message: 'Invalid or expired registration token. Please register again.',
      };
    }
    
    const registrationData = operation.data;
    
    // Verify tenant matches
    if (registrationData.tenantId !== tenantId) {
      return {
        success: false,
        message: 'Tenant mismatch',
      };
    }
    
    // Verify OTP code from JWT token metadata
    const otpInfo = (registrationData as any).otp;
    
    if (!otpInfo) {
      return {
        success: false,
        message: 'No verification code found in registration token. Please register again.',
      };
    }
    
    // Check if OTP has expired (OTP expiration is shorter than JWT expiration)
    const now = Date.now();
    const otpAge = now - otpInfo.createdAt;
    if (otpAge > otpInfo.expiresIn) {
      return {
        success: false,
        message: 'Verification code has expired. Please register again.',
      };
    }
    
    // Verify OTP code
    const hashedCode = await hashToken(otpCode);
    if (otpInfo.hashedCode !== hashedCode) {
      return {
        success: false,
        message: 'Invalid verification code',
      };
    }
    
    logger.info('Registration OTP verified successfully', {
      recipient: otpInfo.recipient,
      channel: otpInfo.channel,
    });
    
    // Check if user already exists (race condition check)
    const existingUser = await this.findExistingUser({
      tenantId: registrationData.tenantId,
      username: registrationData.username,
      email: registrationData.email,
      phone: registrationData.phone,
    });
    
    if (existingUser) {
      return {
        success: false,
        message: 'User already exists',
      };
    }
    
    // Create user in DB (now that verification is complete)
    // CRITICAL: Set status to 'pending' so user cannot perform operations until first login
    // Default role: 'user' - assigned automatically
    const db = getDatabase();
    const createdAt = new Date();
    const user: User = {
      tenantId: registrationData.tenantId,
      username: registrationData.username,
      email: registrationData.email,
      phone: registrationData.phone,
      passwordHash: registrationData.passwordHash,
      status: 'pending',
      emailVerified: !!registrationData.email,
      phoneVerified: !!registrationData.phone,
      twoFactorEnabled: false,
      failedLoginAttempts: 0,
      roles: [{ role: 'user', assignedAt: createdAt, active: true }],
      permissions: [],
      metadata: registrationData.metadata || {},
      createdAt: createdAt,
      updatedAt: createdAt,
    };
    
    const result = await db.collection('users').insertOne(user);
    const createdUser = { ...user, _id: result.insertedId, id: result.insertedId.toString() };
    
    logger.info('User verified and created', { userId: createdUser.id, tenantId });
    
    // Generate tokens for the newly verified user
    // This allows them to immediately use the system without needing to login
    let tokens: any = undefined;
    if (this.authenticationService) {
      try {
        // Create minimal device info for registration
        const deviceInfo: DeviceInfo = {
          deviceId: 'registration',
          deviceType: 'web',
          os: 'unknown',
          browser: 'unknown',
        };
        
        // Normalize user using reusable utility
        const normalizedUser = normalizeUser(createdUser);
        
        tokens = await this.authenticationService.createSessionAndTokens(normalizedUser, deviceInfo);
        logger.info('Tokens generated for verified user', { userId: createdUser.id });
      } catch (error) {
        logger.error('Failed to generate tokens for verified user', { error, userId: createdUser.id });
        // Don't fail registration if token generation fails - user can login later
      }
    }
    
    return {
      success: true,
      message: 'Registration verified successfully',
      user: createdUser,
      tokens, // Return tokens so user can immediately use the system
    };
  }
  
  /**
   * Validate registration input
   */
  private async validateRegistrationInput(input: RegisterInput): Promise<{ valid: boolean; error?: string }> {
    // Check if at least one identifier is provided
    if (!input.username && !input.email && !input.phone) {
      return { valid: false, error: 'At least one identifier (username, email, or phone) is required' };
    }
    
    // Validate username
    if (input.username && !isValidUsername(input.username)) {
      return { valid: false, error: 'Invalid username format. Use 3-30 alphanumeric characters, underscores, or hyphens.' };
    }
    
    // Validate email
    if (input.email && !isValidEmail(input.email)) {
      return { valid: false, error: 'Invalid email format' };
    }
    
    // Validate phone
    if (input.phone && !isValidPhone(input.phone)) {
      return { valid: false, error: 'Invalid phone number format' };
    }
    
    // Validate password if provided
    if (input.password) {
      const passwordValidation = validatePassword(input.password, this.config);
      if (!passwordValidation.valid) {
        return { valid: false, error: passwordValidation.errors.join(', ') };
      }
    } else if (!input.email && !input.phone) {
      // If no social auth identifiers, password is required
      return { valid: false, error: 'Password is required' };
    }
    
    return { valid: true };
  }
  
  /**
   * Check if user already exists
   */
  private async findExistingUser(input: RegisterInput): Promise<User | null> {
    const db = getDatabase();
    
    const conditions: any[] = [];
    
    if (input.username) {
      conditions.push({ username: input.username });
    }
    
    if (input.email) {
      const normalizedEmail = normalizeEmail(input.email);
      conditions.push({ email: normalizedEmail });
    }
    
    if (input.phone) {
      conditions.push({ phone: normalizePhone(input.phone) });
    }
    
    if (conditions.length === 0) {
      return null;
    }
    
    const query = {
      tenantId: input.tenantId,
      $or: conditions,
    };
    
    const result = await db.collection('users').findOne(query) as unknown as User | null;
    
    return result;
  }
  
  /**
   * Create new user in database
   */
  private async createUser(input: RegisterInput): Promise<User> {
    const db = getDatabase();
    
    const now = new Date();
    
    const user: User = {
      // Let MongoDB generate _id automatically - don't set id field
      tenantId: input.tenantId,
      
      // Identifiers
      username: input.username,
      email: input.email ? normalizeEmail(input.email) : undefined,
      phone: input.phone ? normalizePhone(input.phone) : undefined,
      
      // Password - CRITICAL: Hash password before storing (Passport.js does NOT hash automatically)
      passwordHash: input.password ? await hashPassword(input.password) : undefined,
      
      // Status
      status: input.autoVerify ? 'active' : 'pending',
      emailVerified: (input.autoVerify && !!input.email) || false,
      phoneVerified: (input.autoVerify && !!input.phone) || false,
      
      // Security
      twoFactorEnabled: false,
      failedLoginAttempts: 0,
      
      // Roles & Permissions (UserRole[] format)
      roles: [{ role: 'user', assignedAt: now, active: true }],
      permissions: [],
      
      // Metadata (flexible fields)
      metadata: input.metadata || {},
      
      // Timestamps
      createdAt: now,
      updatedAt: now,
    };
    
    const result = await db.collection('users').insertOne(user);
    
    // MongoDB generates _id automatically, use it as the id
    return { ...user, _id: result.insertedId, id: result.insertedId.toString() };
  }
  
  /**
   * Send verification OTP after registration
   * Uses unified JWT-based OTP pattern
   */
  private async sendVerificationOTP(user: User): Promise<{ success: boolean; sentTo?: string; channel?: OTPChannel }> {
    // Determine which channel to use
    let recipient: string;
    let channel: OTPChannel;
    let purpose: 'email_verification' | 'phone_verification';
    
    if (user.email && !user.emailVerified) {
      recipient = user.email;
      channel = 'email';
      purpose = 'email_verification';
    } else if (user.phone && !user.phoneVerified) {
      recipient = user.phone;
      channel = this.otpProviders.isChannelAvailable('whatsapp') ? 'whatsapp' : 'sms';
      purpose = 'phone_verification';
    } else {
      return { success: false };
    }
    
    try {
      // Generate OTP code - use "000000" for testing (when providers not configured)
      const code = '000000'; // Test OTP - replace with generateOTP(this.config.otpLength) in production
      const hashedCode = await hashToken(code);
      
      // Store OTP in JWT token (unified pattern)
      const otpData = {
        userId: user.id,
        tenantId: user.tenantId,
        recipient,
        channel,
        purpose,
        otp: {
          hashedCode,
          channel,
          recipient,
          purpose,
          createdAt: Date.now(),
          expiresIn: this.config.otpExpiryMinutes * 60 * 1000, // milliseconds
        },
      };
      
      // Create OTP token in PendingOperationStore (JWT-based)
      const otpToken = await this.otpStore.create(
        'otp_verification',
        otpData,
        {
          operationType: 'otp_verification',
          expiresIn: `${this.config.otpExpiryMinutes}m`,
        }
      );
      
      // Debug log: Output plain OTP code for testing
      logger.debug('Verification OTP code (for testing)', {
        recipient,
        channel,
        purpose,
        otpCode: code,
        otpToken: otpToken.substring(0, 50) + '...',
      });
      
      // Send OTP via notification service
      // TODO: Uncomment when providers are configured
      // try {
      //   const provider = this.otpProviders.getProvider(channel);
      //   await provider.send(recipient, code, purpose, user.tenantId, user.id);
      //   logger.info('Verification OTP sent', { recipient, channel, purpose });
      // } catch (sendError) {
      //   logger.warn('Failed to send verification OTP via provider (token stored in JWT)', { 
      //     error: sendError,
      //     recipient,
      //   });
      // }
      
      return { success: true, sentTo: recipient, channel };
    } catch (error) {
      logger.error('Failed to send verification OTP', { error, userId: user.id });
      return { success: false };
    }
  }
}
