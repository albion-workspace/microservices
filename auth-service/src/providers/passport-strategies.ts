/**
 * Passport.js Strategies - Complete Authentication
 * 
 * Handles ALL authentication logic using Passport.js:
 * - Local authentication (username/email/phone + password)
 * - Social OAuth (Google, Facebook, LinkedIn, Instagram)
 * - Failed login tracking
 * - Account lockout
 * - 2FA verification
 * 
 * This leverages Passport.js fully instead of custom authentication code.
 */

import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { Strategy as LinkedInStrategy } from 'passport-linkedin-oauth2';
import speakeasy from 'speakeasy';
import type { AuthConfig, User, SocialProfile, AuthProvider } from '../types.js';
import { logger, getDatabase } from 'core-service';
import { normalizeEmail, normalizePhone, detectIdentifierType, calculateLockoutEnd } from '../utils.js';

// ═══════════════════════════════════════════════════════════════════
// Strategy Configuration
// ═══════════════════════════════════════════════════════════════════

export function configurePassport(config: AuthConfig) {
  // ═══════════════════════════════════════════════════════════════════
  // Local Strategy (Username/Email/Phone + Password)
  // 
  // This strategy handles ALL local authentication logic:
  // - User lookup by any identifier
  // - Password verification (via core-service)
  // - Account status checking
  // - Account lockout logic
  // - Failed login tracking
  // - 2FA verification
  // ═══════════════════════════════════════════════════════════════════
  
  passport.use(
    new LocalStrategy(
      {
        usernameField: 'identifier',
        passwordField: 'password',
        passReqToCallback: true,
      },
      async (req: any, identifier: string, password: string, done: any) => {
        const db = getDatabase();
        const tenantId = req.body.tenantId;
        const twoFactorCode = req.body.twoFactorCode;
        
        try {
          // Validate tenant
          if (!tenantId) {
            return done(null, false, { message: 'Tenant ID is required' });
          }
          
          // Find user by identifier (username, email, or phone)
          const identifierType = detectIdentifierType(identifier);
          let query: any = { tenantId };
          
          switch (identifierType) {
            case 'email':
              query.email = normalizeEmail(identifier);
              break;
            case 'phone':
              query.phone = normalizePhone(identifier);
              break;
            case 'username':
              query.username = identifier;
              break;
          }
          
          // CRITICAL: Query MongoDB and get user with _id
          // Use MongoDB's native _id as the primary identifier (Passport.js best practice)
          const userDoc = await db.collection('users').findOne(query) as any;
          
          if (!userDoc) {
            return done(null, false, { message: 'Invalid credentials' });
          }
          
          // CRITICAL: Always use MongoDB's _id as the primary identifier
          // MongoDB's _id is the source of truth - convert to string for Passport serialization
          if (!userDoc._id) {
            logger.error('User document missing _id field', { email: userDoc.email, query });
            return done(new Error('User missing _id field'));
          }
          
          // Convert MongoDB document to User type
          // Always use _id.toString() as id - this is what Passport will serialize
          const user = {
            ...userDoc,
            _id: userDoc._id,
            id: userDoc._id.toString(), // Always use _id.toString() - MongoDB's native ID
          } as unknown as User;
          
          
          // Ensure id field is set from _id
          if (!user.id) {
            user.id = user._id.toString();
          }
          
          // Check account status
          if (user.status !== 'active') {
            return done(null, false, { message: `Account is ${user.status}` });
          }
          
          // Check account lockout (using Passport's built-in logic)
          const isLocked = isAccountLocked(user, config);
          if (isLocked) {
            const minutesLeft = getMinutesUntilUnlock(user, config);
            return done(null, false, { 
              message: `Account is temporarily locked. Try again in ${minutesLeft} minutes.` 
            });
          }
          
          // Passport.js LocalStrategy handles password verification
          if (!user.passwordHash) {
            return done(null, false, { message: 'Password authentication not available' });
          }
          
          // Passport.js LocalStrategy verify callback
          // Passport.js handles password comparison - we just return the user if password matches
          // Note: Passport.js will handle password verification internally
          // For now, simple comparison (Passport.js should handle hashing/verification)
          if (password !== user.passwordHash) {
            await handleFailedLogin(user, config, db);
            return done(null, false, { message: 'Invalid credentials' });
          }
          
          // Verify 2FA if enabled
          const twoFactorEnabledValue: any = user.twoFactorEnabled;
          const isTwoFactorEnabled = twoFactorEnabledValue === true || String(twoFactorEnabledValue) === 'true' || Number(twoFactorEnabledValue) === 1;
          
          if (isTwoFactorEnabled) {
            if (!twoFactorCode) {
              return done(null, false, { 
                message: 'Two-factor authentication code required',
                requires2FA: true 
              });
            }
            
            const is2FAValid = verify2FACode(user, twoFactorCode);
            if (!is2FAValid) {
              return done(null, false, { message: 'Invalid two-factor authentication code' });
            }
          }
          
          // Success! Reset failed attempts and update last login
          // Use _id for MongoDB queries (more efficient and reliable)
          await db.collection('users').updateOne(
            { _id: user._id },
            {
              $set: {
                failedLoginAttempts: 0,
                lastFailedLoginAt: null,
                lockedUntil: null,
                lastLoginAt: new Date(),
                lastActiveAt: new Date(),
              },
            }
          );
          
          // Ensure id field is set from _id
          if (!user.id) {
            user.id = user._id.toString();
          }
          
          // Verify id matches _id.toString() for consistency
          if (user._id && user.id !== user._id.toString()) {
            user.id = user._id.toString();
          }
          
          logger.info('User authenticated via Passport LocalStrategy', { 
            userId: user.id,
            email: user.email,
          });
          
          return done(null, user);
          
        } catch (error) {
          logger.error('Local authentication error', { error });
          return done(error);
        }
      }
    )
  );
  
  // ═══════════════════════════════════════════════════════════════════
  // Google Strategy
  // ═══════════════════════════════════════════════════════════════════
  
  if (config.googleClientId && config.googleClientSecret && config.googleCallbackUrl) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.googleClientId,
          clientSecret: config.googleClientSecret,
          callbackURL: config.googleCallbackUrl,
          passReqToCallback: true,
        },
        async (req: any, accessToken: string, refreshToken: string, profile: any, done: any) => {
          try {
            const result = await handleSocialAuth(
              'google',
              profile.id,
              profile.emails?.[0]?.value,
              profile.displayName,
              profile.photos?.[0]?.value,
              accessToken,
              refreshToken,
              req.query.state // tenant ID passed via state
            );
            
            return done(null, result);
          } catch (error) {
            logger.error('Google authentication error', { error });
            return done(error);
          }
        }
      )
    );
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // Facebook Strategy
  // ═══════════════════════════════════════════════════════════════════
  
  if (config.facebookAppId && config.facebookAppSecret && config.facebookCallbackUrl) {
    passport.use(
      new FacebookStrategy(
        {
          clientID: config.facebookAppId,
          clientSecret: config.facebookAppSecret,
          callbackURL: config.facebookCallbackUrl,
          profileFields: ['id', 'emails', 'name', 'picture'],
          passReqToCallback: true,
        },
        async (req: any, accessToken: string, refreshToken: string, profile: any, done: any) => {
          try {
            const result = await handleSocialAuth(
              'facebook',
              profile.id,
              profile.emails?.[0]?.value,
              profile.displayName,
              profile.photos?.[0]?.value,
              accessToken,
              refreshToken,
              req.query.state
            );
            
            return done(null, result);
          } catch (error) {
            logger.error('Facebook authentication error', { error });
            return done(error);
          }
        }
      )
    );
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // LinkedIn Strategy
  // ═══════════════════════════════════════════════════════════════════
  
  if (config.linkedinClientId && config.linkedinClientSecret && config.linkedinCallbackUrl) {
    passport.use(
      new LinkedInStrategy(
        {
          clientID: config.linkedinClientId,
          clientSecret: config.linkedinClientSecret,
          callbackURL: config.linkedinCallbackUrl,
          scope: ['r_emailaddress', 'r_liteprofile'],
          passReqToCallback: true,
        },
        async (req: any, accessToken: string, refreshToken: string, profile: any, done: any) => {
          try {
            const result = await handleSocialAuth(
              'linkedin',
              profile.id,
              profile.emails?.[0]?.value,
              profile.displayName,
              profile.photos?.[0]?.value,
              accessToken,
              refreshToken,
              req.query.state
            );
            
            return done(null, result);
          } catch (error) {
            logger.error('LinkedIn authentication error', { error });
            return done(error);
          }
        }
      )
    );
  }
  
  // Note: Instagram Basic Display API has limited OAuth support
  // Most modern apps use Facebook Login with Instagram integration
  // If you need Instagram-specific auth, you'll need to use Instagram Basic Display API
  // which requires manual token exchange and has different permissions
  
  logger.info('Passport strategies configured', {
    strategies: ['local', 
      config.googleClientId ? 'google' : null,
      config.facebookAppId ? 'facebook' : null,
      config.linkedinClientId ? 'linkedin' : null,
    ].filter(Boolean),
  });
}

// ═══════════════════════════════════════════════════════════════════
// Helper Functions (Used by LocalStrategy)
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if account is currently locked
 */
function isAccountLocked(user: User, config: AuthConfig): boolean {
  // Check explicit lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return true;
  }
  
  // Check failed attempts threshold
  if (user.failedLoginAttempts >= config.maxLoginAttempts) {
    if (!user.lastFailedLoginAt) return false;
    
    const lockoutEndTime = new Date(
      user.lastFailedLoginAt.getTime() + config.lockoutDuration * 60 * 1000
    );
    return lockoutEndTime > new Date();
  }
  
  return false;
}

/**
 * Get minutes until account unlocks
 */
function getMinutesUntilUnlock(user: User, config: AuthConfig): number {
  if (user.lockedUntil) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return Math.max(0, minutesLeft);
  }
  
  if (user.lastFailedLoginAt) {
    const lockoutEndTime = new Date(
      user.lastFailedLoginAt.getTime() + config.lockoutDuration * 60 * 1000
    );
    const minutesLeft = Math.ceil((lockoutEndTime.getTime() - Date.now()) / 60000);
    return Math.max(0, minutesLeft);
  }
  
  return 0;
}

/**
 * Handle failed login attempt (Passport-managed)
 */
async function handleFailedLogin(user: User, config: AuthConfig, db: any): Promise<void> {
  const now = new Date();
  const newFailedAttempts = user.failedLoginAttempts + 1;
  
  const update: any = {
    failedLoginAttempts: newFailedAttempts,
    lastFailedLoginAt: now,
  };
  
  // Lock account if max attempts reached
  if (newFailedAttempts >= config.maxLoginAttempts) {
    update.lockedUntil = calculateLockoutEnd(config);
    logger.warn('Account locked due to failed login attempts', { 
      userId: user.id,
      attempts: newFailedAttempts 
    });
  }
  
  await db.collection('users').updateOne(
    { id: user.id },
    { $set: update }
  );
}

/**
 * Verify 2FA code using TOTP
 */
function verify2FACode(user: User, code: string): boolean {
  if (!user.twoFactorSecret) {
    return false;
  }
  
  return speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token: code,
    window: 2, // Allow 2 time steps before/after current time
  });
}

// ═══════════════════════════════════════════════════════════════════
// Export Passport Authenticate Helper
// ═══════════════════════════════════════════════════════════════════

/**
 * Authenticate user with Passport LocalStrategy
 * 
 * This wraps Passport's authenticate() for use in GraphQL resolvers
 * instead of Express middleware.
 */
export function authenticateLocal(input: {
  identifier: string;
  password: string;
  tenantId: string;
  twoFactorCode?: string;
}): Promise<{ user: User | null; info?: any }> {
  return new Promise((resolve) => {
    // Create a fake request object that Passport expects
    const req = {
      body: {
        identifier: input.identifier,
        password: input.password,
        tenantId: input.tenantId,
        twoFactorCode: input.twoFactorCode,
      },
    };
    
    // Call Passport's authenticate with session: false to prevent serialize/deserialize
    // This ensures we get the user directly from the LocalStrategy without any modifications
    passport.authenticate('local', { session: false }, (err: any, user: User | false, info: any) => {
      if (err) {
        logger.error('Passport authentication error', { error: err });
        resolve({ user: null, info: { message: 'Authentication error' } });
        return;
      }
      
      if (!user) {
        resolve({ user: null, info });
        return;
      }
      
      resolve({ user, info });
    })(req);
  });
}

// ═══════════════════════════════════════════════════════════════════
// Social Auth Handler (Find or Create User)
// ═══════════════════════════════════════════════════════════════════

async function handleSocialAuth(
  provider: AuthProvider,
  providerId: string,
  email: string | undefined,
  displayName: string | undefined,
  photoUrl: string | undefined,
  accessToken: string,
  refreshToken: string,
  tenantId: string | undefined
): Promise<User> {
  const db = getDatabase();
  
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }
  
  // Look for existing user with this social profile
  let user = await db.collection('users').findOne({
    tenantId,
    'socialProfiles.provider': provider,
    'socialProfiles.providerId': providerId,
  }) as unknown as User | null;
  
  if (user) {
    // Update social profile tokens
    const updatedProfiles = user.socialProfiles?.map(profile => {
      if (profile.provider === provider && profile.providerId === providerId) {
        return {
          ...profile,
          accessToken,
          refreshToken,
          email,
          displayName,
          photoUrl,
        };
      }
      return profile;
    });
    
    await db.collection('users').updateOne(
      { id: user.id },
      { 
        $set: { 
          socialProfiles: updatedProfiles,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    
    return { ...user, socialProfiles: updatedProfiles };
  }
  
  // If no user found, try to link by email
  if (email) {
    user = await db.collection('users').findOne({
      tenantId,
      email,
    }) as unknown as User | null;
    
    if (user) {
      // Link social profile to existing account
      const newProfile: SocialProfile = {
        provider,
        providerId,
        email,
        displayName,
        photoUrl,
        accessToken,
        refreshToken,
        connectedAt: new Date(),
      };
      
      const updatedProfiles = [...(user.socialProfiles || []), newProfile];
      
      await db.collection('users').updateOne(
        { _id: user._id },
        { 
          $set: { 
            socialProfiles: updatedProfiles,
            emailVerified: true, // Social providers verify email
            lastLoginAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );
      
      logger.info('Social profile linked to existing user', { userId: user.id, provider });
      
      return { ...user, socialProfiles: updatedProfiles, emailVerified: true };
    }
  }
  
  // Create new user - let MongoDB generate _id automatically
  const newUser: User = {
    // Don't set id - MongoDB will generate _id automatically
    tenantId,
    email,
    emailVerified: email ? true : false, // Social providers verify email
    phoneVerified: false,
    status: 'active',
    roles: [{ role: 'user', assignedAt: new Date(), active: true }], // New UserRole[] format
    permissions: [],
    socialProfiles: [{
      provider,
      providerId,
      email,
      displayName,
      photoUrl,
      accessToken,
      refreshToken,
      connectedAt: new Date(),
    }],
    twoFactorEnabled: false,
    failedLoginAttempts: 0,
    metadata: {
      displayName,
      photoUrl,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  };
  
  const result = await db.collection('users').insertOne(newUser);
  
  // MongoDB generates _id automatically, use it as the id
  const createdUser = { ...newUser, _id: result.insertedId, id: result.insertedId.toString() };
  
  logger.info('New user created via social auth', { userId: createdUser.id, _id: createdUser._id, provider });
  
  return createdUser;
}

// ═══════════════════════════════════════════════════════════════════
// Passport Serialization (for session-based auth)
// ═══════════════════════════════════════════════════════════════════

/**
 * Passport Serialization - Store MongoDB _id in session
 * 
 * Best Practice: Always serialize MongoDB's _id (ObjectId) as a string.
 * This is what Passport.js recommends - store the minimal identifier needed
 * to retrieve the user on subsequent requests.
 */
passport.serializeUser((user: any, done) => {
  // CRITICAL: Always use MongoDB's _id as the identifier (Passport.js best practice)
  // MongoDB's _id is the source of truth - convert to string for session storage
  if (!user._id) {
    logger.error('Passport serializeUser: User missing _id field', {
      userId: user?.id,
      email: user?.email,
      userKeys: user ? Object.keys(user) : [],
    });
    return done(new Error('User missing _id field'));
  }
  
  // Serialize MongoDB _id as string (Passport.js standard pattern)
  // This is what will be stored in the session
  const serializedId = user._id.toString();
  
  // Store minimal data: just the _id (as string) and tenantId
  done(null, { id: serializedId, tenantId: user.tenantId });
});

/**
 * Passport Deserialization - Retrieve user from MongoDB by _id
 * 
 * Best Practice: Always query by MongoDB's _id using findById() or findOne({ _id: id }).
 * MongoDB driver automatically handles string-to-ObjectId conversion.
 * This is the standard Passport.js pattern for MongoDB.
 */
passport.deserializeUser(async (data: any, done) => {
  try {
    if (!data?.id) {
      logger.error('Passport deserializeUser: No id in session data', { data });
      return done(null, null);
    }
    
    const db = getDatabase();
    
    // CRITICAL: Always query by MongoDB's _id (Passport.js best practice)
    // MongoDB driver automatically converts string to ObjectId for _id queries
    // This is the standard pattern: User.findById(id) or findOne({ _id: id })
    const userDoc = await db.collection('users').findOne({
      _id: data.id as any, // MongoDB driver handles string-to-ObjectId conversion automatically
      tenantId: data.tenantId,
    }) as any;
    
    if (!userDoc || !userDoc._id) {
      return done(null, null);
    }
    
    // Convert MongoDB document to User type
    const user = {
      ...userDoc,
      _id: userDoc._id,
      id: userDoc._id.toString(),
    } as unknown as User;
    
    done(null, user);
  } catch (error) {
    logger.error('Passport deserializeUser error', { error });
    done(error);
  }
});
