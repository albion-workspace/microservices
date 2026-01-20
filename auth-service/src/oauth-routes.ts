/**
 * OAuth Routes for Social Authentication
 * Handles Google, Facebook, LinkedIn, Instagram login flows
 */

import passport from 'passport';
import type { Request, Response } from 'express';
import { createTokenPair, logger } from 'core-service';
import type { User } from './types.js';
import { rolesToArray } from './utils.js';

/**
 * OAuth provider configuration
 */
interface OAuthProviderConfig {
  name: string;
  strategy: string;
  scope: string[];
  failureRedirect: string;
}

/**
 * Common OAuth callback handler
 * Handles token generation and redirect after successful OAuth authentication
 */
async function handleOAuthCallback(
  req: Request,
  res: Response,
  provider: string
): Promise<void> {
  try {
    const user = req.user as User;
    
    if (!user || !user.id) {
      logger.error('OAuth callback: Invalid user object', { provider });
      res.redirect('/login?error=auth_failed&reason=invalid_user');
      return;
    }

    // Normalize roles and permissions
    const roles = rolesToArray(user.roles);
    const permissions = Array.isArray(user.permissions)
      ? user.permissions
      : typeof user.permissions === 'object' && user.permissions !== null
      ? Object.keys(user.permissions as unknown as Record<string, boolean>).filter(key => ((user.permissions as unknown as Record<string, boolean>)[key] === true))
      : [];

    const tokens = createTokenPair({
      userId: user.id,
      tenantId: user.tenantId,
      roles,
      permissions,
    }, {
      secret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
      expiresIn: '1h',
      refreshExpiresIn: '7d',
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectUrl = `${frontendUrl}/auth/callback?` +
      `accessToken=${encodeURIComponent(tokens.accessToken)}&` +
      `refreshToken=${encodeURIComponent(tokens.refreshToken)}&` +
      `userId=${encodeURIComponent(user.id)}`;
    
    logger.info('OAuth authentication successful', { 
      provider, 
      userId: user.id,
      tenantId: user.tenantId 
    });
    
    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('OAuth callback error', { 
      provider, 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    res.redirect(`/login?error=auth_failed&provider=${provider}`);
  }
}

/**
 * Setup OAuth routes
 */
export function setupOAuthRoutes(app: any) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  // OAuth provider configurations
  const providers: Record<string, OAuthProviderConfig> = {
    google: {
      name: 'Google',
      strategy: 'google',
      scope: ['profile', 'email'],
      failureRedirect: '/login?error=google',
    },
    facebook: {
      name: 'Facebook',
      strategy: 'facebook',
      scope: ['email'],
      failureRedirect: '/login?error=facebook',
    },
    linkedin: {
      name: 'LinkedIn',
      strategy: 'linkedin',
      scope: ['r_emailaddress', 'r_liteprofile'],
      failureRedirect: '/login?error=linkedin',
    },
  };

  // Setup routes for each provider
  for (const [key, config] of Object.entries(providers)) {
    // Initiate OAuth flow
    app.get(`/auth/${key}`, (req: Request, res: Response, next: any) => {
      const tenantId = req.query.tenantId || 'default-tenant';
      passport.authenticate(config.strategy, {
        scope: config.scope,
        state: tenantId as string,
      })(req, res, next);
    });

    // OAuth callback
    app.get(`/auth/${key}/callback`,
      passport.authenticate(config.strategy, { 
        session: false, 
        failureRedirect: config.failureRedirect 
      }),
      async (req: Request, res: Response) => {
        await handleOAuthCallback(req, res, key);
      }
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // Instagram OAuth (via Facebook)
  // ═══════════════════════════════════════════════════════════════════
  
  app.get('/auth/instagram', (req: Request, res: Response, next: any) => {
    const tenantId = req.query.tenantId || 'default-tenant';
    // Instagram uses Facebook's OAuth with specific scope
    passport.authenticate('facebook', {
      scope: ['instagram_basic', 'instagram_manage_messages'],
      state: tenantId as string,
    })(req, res, next);
  });

  app.get('/auth/instagram/callback',
    passport.authenticate('facebook', { session: false, failureRedirect: '/login?error=instagram' }),
    async (req: Request, res: Response) => {
      await handleOAuthCallback(req, res, 'instagram');
    }
  );
}
