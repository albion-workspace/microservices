/**
 * OAuth Routes for Social Authentication
 * Handles Google, Facebook, LinkedIn, Instagram login flows
 */

import passport from 'passport';
import type { Request, Response } from 'express';
import { createTokenPair, logger } from 'core-service';
import type { User } from './types.js';
import { createUserContext } from './utils.js';
import { getAuthConfig } from './config.js';

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

    // Create UserContext using reusable utility
    const userContext = createUserContext(user);

    const authConfig = getAuthConfig();
    const tokens = createTokenPair(userContext, {
      secret: authConfig.jwtSecret,
      expiresIn: authConfig.jwtExpiresIn,
      refreshExpiresIn: authConfig.jwtRefreshExpiresIn ?? '7d',
    });

    const frontendUrl = authConfig.frontendUrl;
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
  const frontendUrl = getAuthConfig().frontendUrl;
  
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
