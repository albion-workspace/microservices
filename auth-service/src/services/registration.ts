/**
 * Registration Service
 * Handles user registration with flexible identifiers (username/email/phone)
 */

import { getDatabase, logger } from 'core-service';
import type { RegisterInput, User, AuthResponse, OTPChannel } from '../types.js';
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
} from '../utils.js';
import type { AuthConfig } from '../types.js';
import type { OTPProviderFactory } from '../providers/otp-provider.js';

export class RegistrationService {
  constructor(
    private config: AuthConfig,
    private otpProviders: OTPProviderFactory
  ) {}
  
  /**
   * Register a new user
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
    
    // Create user
    const user = await this.createUser(input);
    
    // If sendOTP is true and not autoVerify, send OTP
    if (input.sendOTP && !input.autoVerify) {
      const otpResult = await this.sendVerificationOTP(user);
      if (!otpResult.success) {
        logger.warn('Failed to send verification OTP', { userId: user.id });
      }
      
      return {
        success: true,
        message: 'Registration successful. Please verify your account.',
        user,
        requiresOTP: true,
        otpSentTo: otpResult.sentTo,
        otpChannel: otpResult.channel,
      };
    }
    
    logger.info('User registered', { userId: user.id, tenantId: user.tenantId });
    
    return {
      success: true,
      message: 'Registration successful',
      user,
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
      
      // Password (Passport.js handles hashing)
      passwordHash: input.password || undefined,
      
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
      // Generate OTP
      const code = generateOTP(this.config.otpLength);
      const hashedCode = await hashToken(code);
      
      const db = getDatabase();
      const now = new Date();
      
      // Store OTP in database
      await db.collection('otps').insertOne({
        id: crypto.randomUUID(),
        userId: user.id,
        tenantId: user.tenantId,
        code, // Store plain code temporarily for delivery
        hashedCode,
        channel,
        recipient,
        purpose,
        attempts: 0,
        maxAttempts: this.config.otpMaxAttempts,
        isUsed: false,
        createdAt: now,
        expiresAt: addMinutes(now, this.config.otpExpiryMinutes),
      });
      
      // Send OTP via provider (uses notification service)
      const provider = this.otpProviders.getProvider(channel);
      await provider.send(recipient, code, purpose, user.tenantId, user.id);
      
      return { success: true, sentTo: recipient, channel };
    } catch (error) {
      logger.error('Failed to send verification OTP', { error, userId: user.id });
      return { success: false };
    }
  }
}
